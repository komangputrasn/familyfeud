import { connect, pinGate, escapeHtml as h } from './net.js';

const $ = (selector) => document.querySelector(selector);

let state = null;
let selectedId = null; // question picked in the dropdown
let lastRunId = null;
let lastJudgeMark = '';

// ------------------------------------------------------------ helpers

// Only touches the DOM when the markup changed, so focus and open dropdowns survive updates.
const htmlCache = new WeakMap();
function setHtml(node, html) {
  if (htmlCache.get(node) === html) return false;
  htmlCache.set(node, html);
  node.innerHTML = html;
  return true;
}

let toastTimer = null;
function toast(message, ok = false) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.toggle('ok', ok);
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.hidden = true), 4500);
}

function roundInProgress() {
  const round = state?.round;
  if (!round) return false;
  const revealed = round.answers.filter((a) => a.revealed).length;
  return revealed < round.answers.length && (revealed > 0 || round.strikes > 0);
}

function drumByDefault(index) {
  return index === 0 && state.settings.drumrollOnTop;
}

// ------------------------------------------------------------ play tab

function renderRound() {
  const { round, position } = state;
  if (!round) {
    setHtml($('#round-card'), '<h2>On the board now</h2><p class="muted">No question started yet. Pick one on the right and press Start.</p>');
    return;
  }
  const where = position.index >= 0 ? `Question ${position.index + 1} of ${position.total}` : 'Question';
  setHtml(
    $('#round-card'),
    `<h2>On the board now · ${where}</h2>
     <div class="now-question">${h(round.question)}</div>
     <div class="row-line">
       <button type="button" class="small" data-act="toggleQuestion">${round.questionVisible ? 'Hide the question on the board' : 'Show the question on the board'}</button>
       ${round.questionVisible ? '' : '<span class="chip gold">Question is hidden on the board</span>'}
       ${state.phase === 'title' ? '<span class="chip gold">Title screen is showing</span>' : ''}
     </div>`,
  );
}

function verdictHtml() {
  const { judge, round, settings } = state;
  if (!judge || !round) return '';
  const guess = `<div class="guess">Contestant said: “${h(judge.guess)}”</div>`;
  const outOfStrikes = round.strikes >= settings.maxStrikes;
  const strikeButton = (extra, label, primary = false) =>
    `<button type="button" class="stop ${extra}" ${primary ? 'data-primary' : ''} data-act="strike" ${outOfStrikes ? 'disabled' : ''}>${label}</button>`;
  const dismiss = (primary = false) =>
    `<button type="button" data-act="clearJudge" ${primary ? 'data-primary' : ''}>Dismiss</button>`;

  if (judge.status === 'pending') {
    return `<div class="verdict">${guess}
      <div class="headline"><span class="spinner"></span>Asking the judge…</div>
      <div class="reason">You can still reveal or strike by hand below.</div>
      <div class="row-line"><button type="button" class="small" data-act="clearJudge">Cancel</button></div>
    </div>`;
  }

  if (judge.status === 'error') {
    return `<div class="verdict warn">${guess}
      <div class="headline">The judge could not answer</div>
      <div class="reason">${h(judge.error)}</div>
      <div class="row-line">
        <button type="button" class="primary" data-act="retryJudge" data-primary>Try again</button>
        ${dismiss()}
      </div>
    </div>`;
  }

  const confidence = `<span class="chip">${h(judge.confidence)} confidence</span>`;

  if (judge.match === null && judge.extra) {
    const full = round.answers.length >= (state.info?.maxAnswers ?? 8);
    const add = full
      ? '<span class="chip gold">The board is full</span>'
      : `<button type="button" class="go big" data-primary data-act="addAnswer">Add “${h(judge.extra)}” to the board</button>`;
    return `<div class="verdict extra">${guess}
      <div class="headline">✔ Good answer, not on the board</div>
      <div class="reason">${h(judge.reason)} ${confidence}</div>
      <div class="row-line">
        ${add}
        ${strikeButton(full ? 'big' : '', full ? 'Strike ✖' : 'Strike instead', full)}
        ${dismiss()}
      </div>
    </div>`;
  }

  if (judge.match === null) {
    return `<div class="verdict miss">${guess}
      <div class="headline">✖ Not on the board</div>
      <div class="reason">${h(judge.reason)} ${confidence}</div>
      <div class="row-line">
        ${strikeButton('big', 'Strike ✖', true)}
        ${dismiss()}
      </div>
    </div>`;
  }

  const number = judge.match + 1;
  const answer = round.answers[judge.match];
  const name = `#${number} ${h(answer?.text ?? judge.matchText)}`;

  if (answer?.revealed) {
    return `<div class="verdict warn">${guess}
      <div class="headline">Already on the board: ${name}</div>
      <div class="reason">${h(judge.reason)} ${confidence}</div>
      <div class="row-line">${dismiss(true)}${strikeButton('', 'Strike anyway')}</div>
    </div>`;
  }

  const drum = drumByDefault(judge.match);
  return `<div class="verdict match">${guess}
    <div class="headline">✔ Matches ${name}</div>
    <div class="reason">${h(judge.reason)} ${confidence}</div>
    <div class="row-line">
      <button type="button" class="go big" data-primary data-act="reveal" data-i="${judge.match}" data-mode="auto">Reveal #${number}${drum ? ' with drum roll' : ''}</button>
      ${strikeButton('', 'Strike instead')}
      ${dismiss()}
    </div>
  </div>`;
}

function renderVerdict() {
  const judge = state.judge;
  const changed = setHtml($('#verdict'), verdictHtml());
  const mark = judge ? `${judge.id}:${judge.status}` : '';
  const input = $('#guess');

  if (mark !== lastJudgeMark) {
    if (!judge && lastJudgeMark) {
      // The guess was settled: get ready for the next one.
      input.value = '';
      input.focus();
    } else if (judge && judge.status !== 'pending' && changed) {
      // Verdict is in: one more Enter confirms it.
      $('#verdict [data-primary]')?.focus();
    }
    lastJudgeMark = mark;
  }
}

function renderAnswers() {
  const { round, judge } = state;
  if (!round) {
    setHtml($('#answers'), '<p class="muted">Answers appear here once a question is started.</p>');
    return;
  }
  const rows = round.answers
    .map((answer, i) => {
      const suggested = judge?.status === 'done' && judge.match === i;
      const drum = drumByDefault(i);
      const buttons = answer.revealed
        ? `<span class="chip green">On the board</span>
           <button type="button" class="small" data-act="hide" data-i="${i}">Hide again</button>`
        : `<button type="button" class="small go" data-act="reveal" data-i="${i}" data-mode="auto">Reveal${drum ? ' + drum roll' : ''}</button>
           <button type="button" class="small ${drum ? '' : 'drum'}" data-act="reveal" data-i="${i}" data-mode="${drum ? 'normal' : 'drum'}">${drum ? 'No drum roll' : 'Drum roll'}</button>
           <button type="button" class="small" data-act="reveal" data-i="${i}" data-mode="quiet" title="Flip it open with no fanfare">Quiet</button>`;
      return `<div class="ans ${answer.revealed ? 'shown' : ''} ${suggested ? 'suggested' : ''}">
        <span class="num">${i + 1}</span>
        <span class="txt">${h(answer.text)} ${i === 0 ? '<span class="chip gold">Top answer</span>' : ''}${answer.added ? ' <span class="chip">Added</span>' : ''}</span>
        <span class="btns">${buttons}</span>
      </div>`;
    })
    .join('');
  const anyHidden = round.answers.some((a) => !a.revealed);
  setHtml(
    $('#answers'),
    `${rows}<div class="row-line" style="margin-top:12px">
      <button type="button" data-act="revealAll" ${anyHidden ? '' : 'disabled'}>Reveal all remaining answers</button>
    </div>`,
  );
}

function renderStrikes() {
  const { round, settings } = state;
  const strikes = round?.strikes ?? 0;
  const marks = Array.from({ length: settings.maxStrikes }, (_, i) => `<span class="${i < strikes ? 'on' : ''}">✖</span>`).join('');
  setHtml(
    $('#strike-card'),
    `<h2>Strikes</h2>
     <div class="row-line"><div class="strike-marks">${marks}</div></div>
     <div class="row-line">
       <button type="button" class="stop" data-act="strike" ${!round || strikes >= settings.maxStrikes ? 'disabled' : ''}>Strike ✖</button>
       <button type="button" data-act="unstrike" ${strikes ? '' : 'disabled'}>Undo</button>
       <button type="button" data-act="clearStrikes" ${strikes ? '' : 'disabled'}>Clear</button>
     </div>`,
  );
}

function renderScreen() {
  const { questions, round, phase, position } = state;

  // After a question starts, line the dropdown up on the one that follows.
  const runId = round?.runId ?? null;
  if (runId !== lastRunId) {
    lastRunId = runId;
    selectedId = (questions[position.index + 1] || questions[position.index] || questions[0])?.id ?? null;
  }
  if (!questions.some((q) => q.id === selectedId)) selectedId = questions[0]?.id ?? null;

  const options = questions
    .map((q, i) => `<option value="${h(q.id)}" ${q.id === selectedId ? 'selected' : ''}>${i + 1}. ${h(q.question)}</option>`)
    .join('');
  const hasNext = Boolean(questions[position.index + 1]);

  setHtml(
    $('#screen-card'),
    `<h2>Screen</h2>
     <div class="row-line">
       <button type="button" data-act="showTitle" ${phase === 'title' ? 'disabled' : ''}>Title screen</button>
       <button type="button" data-act="showBoard" ${phase === 'round' || !questions.length ? 'disabled' : ''}>Game board</button>
     </div>
     <h2 style="margin-top:20px">Questions</h2>
     ${
       questions.length
         ? `<div class="field"><select id="pick" aria-label="Question to start">${options}</select></div>
            <div class="row-line">
              <button type="button" class="primary" data-act="start">Start this question</button>
              <button type="button" data-act="next" ${round && hasNext ? '' : 'disabled'}>Next ▶</button>
            </div>`
         : '<p class="muted">No questions yet. Add some in the Questions tab.</p>'
     }`,
  );
}

// ------------------------------------------------------------ questions tab

let draft = []; // [{ id, question, answersText }]
let draftSource = '';
let dirty = false;
let pendingSave = null; // signature of the list we asked the server to save

// Ids are assigned by the server, so saved lists are compared on their content.
const signature = (list) => JSON.stringify(list.map((q) => [q.question, q.answers]));

function answersOf(item) {
  return item.answersText.split('\n').map((line) => line.trim()).filter(Boolean);
}

function noteFor(item) {
  const count = answersOf(item).length;
  const max = state?.info?.maxAnswers ?? 8;
  if (count > max) return { bad: true, text: `${count} answers: the board fits ${max} at most.` };
  if (!count) return { bad: false, text: 'One answer per line. Put the most popular answer first.' };
  return { bad: false, text: `${count} answer${count === 1 ? '' : 's'} · the first line is the top answer.` };
}

function renderEditor() {
  $('#q-list').innerHTML = draft.length
    ? draft
        .map((item, i) => {
          const note = noteFor(item);
          return `<div class="card q-edit" data-q="${i}">
            <div class="q-head">
              <span class="q-num">${i + 1}</span>
              <input type="text" class="q-text" value="${h(item.question)}" placeholder="Question" aria-label="Question ${i + 1}">
              ${writeButton(item)}
              <button type="button" class="small" data-act="moveUp" title="Move up" ${i === 0 ? 'disabled' : ''}>▲</button>
              <button type="button" class="small" data-act="moveDown" title="Move down" ${i === draft.length - 1 ? 'disabled' : ''}>▼</button>
              <button type="button" class="small stop" data-act="deleteQuestion">Delete</button>
            </div>
            <textarea class="q-answers" rows="8" placeholder="One answer per line, most popular first" aria-label="Answers for question ${i + 1}">${h(item.answersText)}</textarea>
            <div class="q-note ${note.bad ? 'bad' : ''}">${note.text}</div>
          </div>`;
        })
        .join('')
    : '<p class="muted">No questions yet. Press “Add question” to write the first one.</p>';
  renderEditorStatus();
}

const writing = new Set(); // draft items Claude is writing answers for

function writeButton(item) {
  if (writing.has(item)) return '<button type="button" class="small" disabled><span class="spinner"></span> Thinking…</button>';
  const noKey = !state?.info?.hasKey;
  const title = noKey
    ? 'Add ANTHROPIC_API_KEY to .env to use this.'
    : item.question.trim()
      ? 'Claude writes the most popular answers for this question.'
      : 'Leave the question blank and Claude writes a new question with its answers.';
  return `<button type="button" class="small" data-act="writeAnswers" title="${title}" ${noKey ? 'disabled' : ''}>✨ Ask Claude</button>`;
}

async function writeAnswers(button) {
  const item = draft[Number(button.closest('.q-edit').dataset.q)];
  if (answersOf(item).length && !confirm('Replace the answers on this question with ones Claude writes?')) return;
  writing.add(item);
  renderEditor();
  try {
    const response = await fetch('/api/write-answers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Pin': pin.get() },
      body: JSON.stringify({ question: item.question, existing: draft.map((q) => q.question.trim()).filter(Boolean) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `The server answered ${response.status}.`);
    if (!draft.includes(item)) return; // deleted while Claude was writing
    if (!item.question.trim()) item.question = result.question;
    item.answersText = result.answers.join('\n');
    markDirty();
    toast('Claude wrote the answers. Check them, then press Save changes.', true);
  } catch (err) {
    toast(err.message || 'Claude could not write answers.');
  } finally {
    writing.delete(item);
    renderEditor();
  }
}

function renderEditorStatus() {
  $('#q-status').textContent = dirty ? 'Unsaved changes' : `${draft.length} question${draft.length === 1 ? '' : 's'} saved`;
}

function syncEditor() {
  if (pendingSave !== null && signature(state.questions) === pendingSave) {
    pendingSave = null;
    dirty = false;
    toast('Questions saved.', true);
  }
  if (dirty || writing.size) return;
  const source = JSON.stringify(state.questions);
  if (source === draftSource) return;
  draftSource = source;
  draft = state.questions.map((q) => ({ id: q.id, question: q.question, answersText: q.answers.join('\n') }));
  renderEditor();
}

function markDirty() {
  dirty = true;
  renderEditorStatus();
}

$('#q-list').addEventListener('input', (e) => {
  const card = e.target.closest('.q-edit');
  if (!card) return;
  const item = draft[Number(card.dataset.q)];
  if (e.target.classList.contains('q-text')) item.question = e.target.value;
  if (e.target.classList.contains('q-answers')) {
    item.answersText = e.target.value;
    const note = noteFor(item);
    const node = card.querySelector('.q-note');
    node.textContent = note.text;
    node.classList.toggle('bad', note.bad);
  }
  markDirty();
});

function saveQuestions() {
  const max = state.info.maxAnswers;
  const payload = [];
  for (const [i, item] of draft.entries()) {
    const question = item.question.trim();
    const answers = answersOf(item);
    if (!question && !answers.length) continue; // an untouched blank card
    if (!question) return toast(`Question ${i + 1} has answers but no question text.`);
    if (!answers.length) return toast(`Question ${i + 1} needs at least one answer.`);
    if (answers.length > max) return toast(`Question ${i + 1} has ${answers.length} answers. The board fits ${max} at most.`);
    payload.push({ id: item.id, question, answers });
  }
  pendingSave = signature(payload);
  net.send('saveQuestions', { questions: payload });
}

function exportQuestions() {
  const blob = new Blob([JSON.stringify(state.questions, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'questions.json';
  link.click();
  URL.revokeObjectURL(link.href);
}

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const list = JSON.parse(await file.text());
    if (!Array.isArray(list)) throw new Error('not a list');
    draft = list.map((q) => ({
      id: typeof q.id === 'string' ? q.id : '',
      question: String(q.question ?? ''),
      answersText: (Array.isArray(q.answers) ? q.answers : []).map((a) => (a && typeof a === 'object' ? a.text : a) ?? '').join('\n'),
    }));
    markDirty();
    renderEditor();
    toast(`Loaded ${draft.length} questions. Check them, then press Save changes.`, true);
  } catch {
    toast('That file is not a question list this game can read.');
  }
});

// ------------------------------------------------------------ settings tab

let settingsDirty = false;
const settingsForm = $('#settings-form');
const fields = settingsForm.elements;

function syncSettings() {
  if (!settingsDirty) {
    const s = state.settings;
    fields.title.value = s.title;
    fields.subtitle.value = s.subtitle;
    fields.topLabel.value = s.topLabel;
    fields.maxStrikes.value = s.maxStrikes;
    fields.drumrollOnTop.checked = s.drumrollOnTop;
    fields.drumrollCue.value = s.drumrollCue;
  }

  const { info } = state;
  const audioRow = (name, label) =>
    `<dt>${label}</dt><dd>${info.audio[name] ? `your file (${h(decodeURIComponent(info.audio[name].split('/').pop().split('?')[0]))})` : 'built-in sound'}</dd>`;
  setHtml($('#audio-info'), audioRow('drumroll', 'Drum roll') + audioRow('reveal', 'Reveal') + audioRow('strike', 'Strike'));

  const hosts = info.urls.length ? info.urls : [location.origin];
  setHtml(
    $('#conn-info'),
    `<dt>Judge model</dt><dd>${h(info.model)}</dd>
     <dt>API key</dt><dd>${info.hasKey ? 'found' : '<span class="chip red">missing</span> add ANTHROPIC_API_KEY to .env and restart'}</dd>
     <dt>PIN</dt><dd>${info.pinSet ? 'required for admin and presenter' : 'none set'}</dd>
     <dt>Board</dt><dd>${hosts.map((u) => h(`${u}/`)).join('<br>')}</dd>
     <dt>Presenter</dt><dd>${hosts.map((u) => h(`${u}/presenter`)).join('<br>')}</dd>
     <dt>Admin</dt><dd>${hosts.map((u) => h(`${u}/admin`)).join('<br>')}</dd>`,
  );
}

settingsForm.addEventListener('input', () => (settingsDirty = true));
settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  settingsDirty = false;
  net.send('saveSettings', {
    settings: {
      title: fields.title.value,
      subtitle: fields.subtitle.value,
      topLabel: fields.topLabel.value,
      maxStrikes: Number(fields.maxStrikes.value),
      drumrollOnTop: fields.drumrollOnTop.checked,
      drumrollCue: Number(fields.drumrollCue.value) || 0,
    },
  });
  toast('Settings saved.', true);
});

// ------------------------------------------------------------ wiring

function render() {
  renderRound();
  renderVerdict();
  renderAnswers();
  renderStrikes();
  renderScreen();
  syncEditor();
  syncSettings();
}

const pin = pinGate();
const net = connect({
  role: 'admin',
  getPin: pin.get,
  onState(message) {
    state = message.state;
    render();
  },
  onStatus(online) {
    const node = $('#status');
    node.classList.toggle('online', online);
    node.textContent = online ? 'Connected' : 'Offline';
  },
  onAuthFail() {
    pin.ask(() => net.retry());
  },
  onError(message) {
    pendingSave = null;
    toast(message);
  },
});

const handlers = {
  showTitle: () => net.send('showTitle'),
  showBoard: () => net.send('showBoard'),
  start() {
    if (roundInProgress() && !confirm('Start a new question? The current board will be cleared.')) return;
    net.send('startRound', { id: $('#pick').value });
  },
  next() {
    if (roundInProgress() && !confirm('Move to the next question? The current board will be cleared.')) return;
    net.send('nextRound');
  },
  toggleQuestion: () => net.send('setQuestionVisible', { visible: !state.round.questionVisible }),
  reveal: (button) => net.send('reveal', { index: Number(button.dataset.i), mode: button.dataset.mode }),
  hide: (button) => net.send('hide', { index: Number(button.dataset.i) }),
  revealAll: () => net.send('revealAll'),
  strike: () => net.send('strike'),
  unstrike: () => net.send('unstrike'),
  clearStrikes: () => net.send('clearStrikes'),
  clearJudge: () => net.send('clearJudge'),
  retryJudge: () => net.send('judge', { guess: state.judge.guess }),
  addAnswer: () => net.send('addAnswer', { text: state.judge.extra }),
  testSound: (button) => net.send('testSound', { name: button.dataset.name }),
  reset() {
    if (confirm('Go back to the title screen and clear the current board?')) net.send('reset');
  },

  saveQuestions,
  writeAnswers,
  exportQuestions,
  importQuestions: () => $('#import-file').click(),
  addQuestion() {
    draft.push({ id: '', question: '', answersText: '' });
    markDirty();
    renderEditor();
    $('#q-list .q-edit:last-child .q-text').focus();
  },
  deleteQuestion(button) {
    const index = Number(button.closest('.q-edit').dataset.q);
    if (draft[index].question.trim() && !confirm(`Delete question ${index + 1}?`)) return;
    draft.splice(index, 1);
    markDirty();
    renderEditor();
  },
  moveUp: (button) => moveQuestion(button, -1),
  moveDown: (button) => moveQuestion(button, 1),
};

function moveQuestion(button, step) {
  const index = Number(button.closest('.q-edit').dataset.q);
  const target = index + step;
  if (target < 0 || target >= draft.length) return;
  [draft[index], draft[target]] = [draft[target], draft[index]];
  markDirty();
  renderEditor();
}

document.addEventListener('click', (e) => {
  const button = e.target.closest('[data-act]');
  if (button && state && !button.disabled) handlers[button.dataset.act]?.(button);

  const tab = e.target.closest('[data-tab]');
  if (tab) {
    for (const other of document.querySelectorAll('[data-tab]')) other.classList.toggle('on', other === tab);
    for (const name of ['play', 'questions', 'settings']) $(`#tab-${name}`).hidden = name !== tab.dataset.tab;
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'pick') selectedId = e.target.value;
});

$('#judge-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!state?.round) return toast('Start a question first.');
  if (state.judge?.status === 'pending') return;
  const guess = $('#guess').value.trim();
  if (guess) net.send('judge', { guess });
});

window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});
