import './env.js';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { askJudge, describeJudgeError, hasCredentials, JUDGE_MODEL } from './judge.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3000;
const PIN = process.env.PIN?.trim() || '';

const DATA_DIR = path.join(here, 'data');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const AUDIO_DIR = path.join(here, 'public', 'audio');
const WRONG_DIR = path.join(DATA_DIR, 'wrong'); // any audio here plays at random on a strike
const CORRECT_DIR = path.join(DATA_DIR, 'correct'); // correct.* here plays on every reveal
const AUDIO_NAMES = ['drumroll', 'tease', 'reveal', 'strike'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a'];
const MAX_ANSWERS = 8;
const GROUP_COUNT = 3;
const MAX_ROWS = 10; // survey answers plus accepted off-board answers

// ---------------------------------------------------------------- storage

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function cleanQuestions(input) {
  if (!Array.isArray(input)) throw new Error('The question list must be an array.');
  const seen = new Set();
  return input
    .map((q) => {
      let id = typeof q?.id === 'string' && q.id.trim() ? q.id.trim() : '';
      if (!id || seen.has(id)) id = crypto.randomUUID().slice(0, 8);
      seen.add(id);
      const answers = (Array.isArray(q?.answers) ? q.answers : [])
        .map((a) => String(a && typeof a === 'object' ? (a.text ?? '') : (a ?? '')).trim())
        .filter(Boolean);
      return { id, question: String(q?.question ?? '').trim(), answers };
    })
    .filter((q) => q.question && q.answers.length);
}

const DEFAULT_SETTINGS = {
  title: 'Survey Showdown',
  subtitle: 'Office Edition',
  topLabel: 'Top Answer',
  drumrollOnTop: true,
  drumrollCue: 0, // seconds into the drum-roll track at which the reveal fires; 0 = when it ends
  drumrollTease: 25, // % chance a regular answer also gets the drum roll while the top answer is still hidden
};

let questions = cleanQuestions(readJson(QUESTIONS_FILE, []));

const saved = readJson(STATE_FILE, {});
const state = {
  settings: { ...DEFAULT_SETTINGS, ...(saved.settings || {}) },
  phase: saved.phase === 'round' && saved.round ? 'round' : 'title',
  round: saved.round ? { extras: [], ...saved.round } : null,
  groups: cleanGroups(saved.groups), // scores for the whole game, kept across questions
  judge: null, // a verdict from before a restart is stale
};

function persist() {
  writeJson(STATE_FILE, { settings: state.settings, phase: state.phase, round: state.round, groups: state.groups });
}

// ---------------------------------------------------------------- groups

function cleanGroups(input) {
  return Array.from({ length: GROUP_COUNT }, (_, i) => {
    const g = Array.isArray(input) ? input[i] : null;
    const count = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
    return { points: count(g?.points), wrong: count(g?.wrong) };
  });
}

function groupAt(group) {
  if (!Number.isInteger(group) || group < 0 || group >= GROUP_COUNT) throw new Error('Pick a group first.');
  return state.groups[group];
}

// Points by rank: with 6 answers, #1 is worth 6 and #6 is worth 1.
function pointsFor(round, index) {
  return round.answers.length - index;
}

// ---------------------------------------------------------------- views

function audioManifest() {
  const found = {};
  let files = [];
  try {
    files = fs.readdirSync(AUDIO_DIR);
  } catch {
    return found;
  }
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const name = path.basename(file, path.extname(file)).toLowerCase();
    if (!AUDIO_NAMES.includes(name) || !AUDIO_EXTENSIONS.includes(ext) || found[name]) continue;
    const stamp = Math.round(fs.statSync(path.join(AUDIO_DIR, file)).mtimeMs);
    found[name] = `/audio/${encodeURIComponent(file)}?v=${stamp}`;
  }
  const wrong = wrongSounds();
  if (wrong.length) found.strike = wrong;
  const correct = correctSound();
  if (correct) found.reveal = correct;
  return found;
}

// data/correct/correct.* is the "correct answer" sound; it replaces public/audio/reveal.*.
function correctSound() {
  for (const ext of AUDIO_EXTENSIONS) {
    const file = path.join(CORRECT_DIR, `correct${ext}`);
    if (fs.existsSync(file)) return `/correct/correct${ext}?v=${Math.round(fs.statSync(file).mtimeMs)}`;
  }
  return null;
}

// Every audio file in data/wrong; the board picks one at random for each strike.
function wrongSounds() {
  let files = [];
  try {
    files = fs.readdirSync(WRONG_DIR);
  } catch {
    return [];
  }
  return files
    .filter((file) => AUDIO_EXTENSIONS.includes(path.extname(file).toLowerCase()))
    .sort()
    .map((file) => {
      const stamp = Math.round(fs.statSync(path.join(WRONG_DIR, file)).mtimeMs);
      return `/wrong/${encodeURIComponent(file)}?v=${stamp}`;
    });
}

function lanUrls() {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) urls.push(`http://${net.address}:${PORT}`);
    }
  }
  return urls;
}

function currentIndex() {
  return state.round ? questions.findIndex((q) => q.id === state.round.qid) : -1;
}

// The board is open to anyone on the network, so it never receives hidden answers.
function viewFor(role) {
  const { settings, phase, round, groups } = state;
  if (role === 'board') {
    return {
      settings,
      phase,
      groups,
      round: round && {
        runId: round.runId,
        question: round.questionVisible ? round.question : '',
        questionVisible: round.questionVisible,
        strikes: round.strikes,
        answers: round.answers.map((a) => (a.revealed ? { revealed: true, text: a.text } : { revealed: false })),
        extras: round.extras,
      },
    };
  }
  const index = currentIndex();
  const view = {
    settings,
    phase,
    round,
    groups,
    judge: state.judge,
    position: { index, total: questions.length },
    next: questions[index + 1] || null,
  };
  if (role === 'admin') {
    view.questions = questions;
    view.info = {
      model: JUDGE_MODEL,
      hasKey: hasCredentials(),
      urls: lanUrls(),
      pinSet: Boolean(PIN),
      audio: audioManifest(),
      maxAnswers: MAX_ANSWERS,
    };
  }
  return view;
}

// ---------------------------------------------------------------- judge

let judgeCounter = 0;

function startJudging(guess) {
  const round = state.round;
  if (!round) throw new Error('Start a question first.');
  const id = ++judgeCounter;
  const runId = round.runId;
  state.judge = { id, status: 'pending', guess };

  // Ignore the answer if the operator cancelled or moved on while Claude was thinking.
  const stillWanted = () => state.judge?.id === id && state.round?.runId === runId;

  askJudge(round.question, round.answers.map((a) => a.text), guess)
    .then((verdict) => {
      if (!stillWanted()) return;
      state.judge = {
        id,
        status: 'done',
        guess,
        ...verdict,
        matchText: verdict.match === null ? null : state.round.answers[verdict.match].text,
      };
      broadcast();
    })
    .catch((err) => {
      console.error('Judge error:', err?.message || err);
      if (!stillWanted()) return;
      state.judge = { id, status: 'error', guess, error: describeJudgeError(err) };
      broadcast();
    });
}

// ---------------------------------------------------------------- actions

function requireRound() {
  if (!state.round) throw new Error('Start a question first.');
  return state.round;
}

function startRound(question) {
  state.round = {
    qid: question.id,
    runId: crypto.randomUUID().slice(0, 8),
    question: question.question,
    answers: question.answers.slice(0, MAX_ANSWERS).map((text) => ({ text, revealed: false })),
    strikes: 0,
    extras: [], // accepted good answers that weren't on the survey board
    questionVisible: true,
  };
  state.phase = 'round';
  state.judge = null;
  return { kind: 'round' };
}

function answerAt(round, index) {
  const answer = round.answers[index];
  if (!answer) throw new Error('That answer does not exist.');
  return answer;
}

// Each action mutates state and may return an event for the board to animate.
const actions = {
  showTitle() {
    state.phase = 'title';
  },

  showBoard() {
    if (!state.round) {
      if (!questions.length) throw new Error('Add a question first.');
      return startRound(questions[0]);
    }
    state.phase = 'round';
  },

  startRound({ id }) {
    const question = questions.find((q) => q.id === id);
    if (!question) throw new Error('That question no longer exists.');
    return startRound(question);
  },

  nextRound() {
    const next = questions[currentIndex() + 1];
    if (!next) throw new Error('That was the last question.');
    return startRound(next);
  },

  setQuestionVisible({ visible }) {
    requireRound().questionVisible = Boolean(visible);
  },

  // group: who guessed it (0-2), or null to reveal without points (e.g. answers nobody got).
  reveal({ index, mode, group = null }) {
    const round = requireRound();
    const answer = answerAt(round, index);
    if (answer.revealed) return;
    const scorer = group === null ? null : groupAt(group);
    let resolved = mode;
    if (!['normal', 'drum', 'quiet'].includes(resolved)) {
      const { drumrollOnTop, drumrollTease } = state.settings;
      const fakeOut = index !== 0 && !round.answers[0].revealed && Math.random() * 100 < drumrollTease;
      resolved = (index === 0 && drumrollOnTop) || fakeOut ? 'drum' : 'normal';
    }
    answer.revealed = true;
    answer.by = null;
    answer.points = 0;
    if (scorer) {
      answer.by = group;
      answer.points = pointsFor(round, index);
      scorer.points += answer.points;
    }
    state.phase = 'round';
    state.judge = null;
    return { kind: 'reveal', index, mode: resolved, group: answer.by, points: answer.points };
  },

  // Hiding an answer takes its points back from the group that got them.
  hide({ index }) {
    const answer = answerAt(requireRound(), index);
    if (answer.revealed && Number.isInteger(answer.by) && state.groups[answer.by]) {
      state.groups[answer.by].points = Math.max(0, state.groups[answer.by].points - (answer.points || 0));
    }
    answer.revealed = false;
    answer.by = null;
    answer.points = 0;
  },

  revealAll() {
    const round = requireRound();
    const indices = [];
    round.answers.forEach((answer, i) => {
      if (!answer.revealed) {
        answer.revealed = true;
        indices.push(i);
      }
    });
    if (!indices.length) return;
    state.phase = 'round';
    state.judge = null;
    return { kind: 'revealAll', indices };
  },

  // Wrong answers are counted per group for the whole game, with no limit.
  strike({ group }) {
    const round = requireRound();
    const target = groupAt(group);
    target.wrong += 1;
    round.strikes += 1;
    state.phase = 'round';
    state.judge = null;
    return { kind: 'strike', group, count: target.wrong };
  },

  unstrike({ group }) {
    const target = groupAt(group);
    target.wrong = Math.max(0, target.wrong - 1);
    if (state.round) state.round.strikes = Math.max(0, state.round.strikes - 1);
  },

  resetScores() {
    state.groups = cleanGroups([]);
    if (state.round) {
      state.round.strikes = 0;
      for (const answer of state.round.answers) {
        answer.by = null;
        answer.points = 0;
      }
    }
  },

  judge({ guess }) {
    const text = String(guess ?? '').trim().slice(0, 200);
    if (!text) throw new Error('Type an answer to judge.');
    startJudging(text);
  },

  clearJudge() {
    state.judge = null;
  },

  // A good answer that isn't on the board: no strike, nothing revealed, the board just cheers it.
  // The guess also gets its own row under the survey answers (no points), while there is room.
  acceptOffBoard() {
    const round = requireRound();
    const judge = state.judge;
    if (!judge || judge.status !== 'done') throw new Error('There is no verdict to accept.');
    const text = judge.guess;
    const already = round.extras.some((t) => t.toLowerCase() === text.toLowerCase());
    const room = round.answers.length + round.extras.length < MAX_ROWS;
    const added = !already && room;
    if (added) round.extras.push(text);
    state.phase = 'round';
    state.judge = null;
    return { kind: 'accepted', text, added };
  },

  removeExtra({ index }) {
    const round = requireRound();
    if (!round.extras[index]) throw new Error('That answer is not on the board.');
    round.extras.splice(index, 1);
  },

  saveQuestions({ questions: incoming }) {
    const cleaned = cleanQuestions(incoming);
    const tooLong = cleaned.find((q) => q.answers.length > MAX_ANSWERS);
    if (tooLong) throw new Error(`"${tooLong.question}" has more than ${MAX_ANSWERS} answers.`);
    questions = cleaned;
    writeJson(QUESTIONS_FILE, questions);
  },

  saveSettings({ settings }) {
    const s = settings || {};
    const text = (value, fallback, max) => (typeof value === 'string' ? value.trim().slice(0, max) : fallback);
    const number = (value, fallback, min, max) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };
    const current = state.settings;
    state.settings = {
      title: text(s.title, current.title, 60) || DEFAULT_SETTINGS.title,
      subtitle: text(s.subtitle, current.subtitle, 60),
      topLabel: text(s.topLabel, current.topLabel, 30),
      drumrollOnTop: typeof s.drumrollOnTop === 'boolean' ? s.drumrollOnTop : current.drumrollOnTop,
      drumrollCue: number(s.drumrollCue, current.drumrollCue, 0, 120),
      drumrollTease: Math.round(number(s.drumrollTease, current.drumrollTease, 0, 100)),
    };
  },

  testSound({ name }) {
    if (!['ding', 'buzzer', 'drumroll'].includes(name)) throw new Error('Unknown sound.');
    return { kind: 'sound', name };
  },

  reset() {
    state.round = null;
    state.phase = 'title';
    state.judge = null;
  },
};

// ---------------------------------------------------------------- http + ws

const app = express();
app.get('/api/audio', (req, res) => res.json(audioManifest()));
app.use('/wrong', express.static(WRONG_DIR, { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.use('/correct', express.static(CORRECT_DIR, { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.use(
  express.static(path.join(here, 'public'), {
    extensions: ['html'],
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }),
);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
let eventCounter = 0;

function send(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function broadcast(event = null) {
  if (event) event.seq = ++eventCounter;
  for (const ws of wss.clients) {
    if (ws.role) send(ws, { type: 'state', state: viewFor(ws.role), event });
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const role = ['admin', 'presenter'].includes(url.searchParams.get('role')) ? url.searchParams.get('role') : 'board';
  if (role !== 'board' && PIN && url.searchParams.get('pin') !== PIN) {
    send(ws, { type: 'auth', ok: false });
    ws.close(4001, 'wrong pin');
    return;
  }
  ws.role = role;
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  send(ws, { type: 'state', state: viewFor(role), event: null });

  ws.on('message', (raw) => {
    if (ws.role !== 'admin') return;
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const action = Object.hasOwn(actions, message?.action) ? actions[message.action] : null;
    if (!action) return;
    try {
      const event = action(message.payload || {}) || null;
      persist();
      broadcast(event);
    } catch (err) {
      send(ws, { type: 'error', message: err.message });
    }
  });
});

// Drop connections that went away without closing (laptop lid, Wi-Fi drop).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
}, 30_000).unref();

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Close the other program or set PORT in .env.`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  const local = `http://localhost:${PORT}`;
  const lan = lanUrls();
  console.log('\n  Game server is running.\n');
  console.log(`  Board (projector):   ${local}/`);
  console.log(`  Admin (operator):    ${local}/admin`);
  console.log(`  Presenter (host):    ${local}/presenter`);
  if (lan.length) {
    console.log('\n  From other devices on the same Wi-Fi, replace "localhost" with:');
    for (const url of lan) console.log(`    ${url}`);
  }
  console.log(`\n  PIN for admin and presenter: ${PIN || '(none set)'}`);
  console.log(`  Judge model: ${JUDGE_MODEL}`);
  if (!hasCredentials()) {
    console.log('  No ANTHROPIC_API_KEY in .env yet: the judge will not work until you add one.');
  }
  console.log(`  Questions loaded: ${questions.length}\n`);
});
