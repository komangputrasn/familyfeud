import { Sound } from './audio.js';
import { Sparkles } from './sparkles.js';
import { connect } from './net.js';

const W = 1920;
const H = 1080;

const $ = (selector) => document.querySelector(selector);
const stage = $('#stage');
const fx = $('#fx');
const rowsEl = $('#rows');
const groupsEl = $('#groups');
const dimEl = $('#dim');
const flashEl = $('#flash');
const questionEl = $('#question');
const questionText = $('#question-text');
const roundScreen = $('#round-screen');
const titleScreen = $('#title-screen');

const X_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <defs><linearGradient id="xg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ff9a8a"/><stop offset=".45" stop-color="#ff2a1a"/><stop offset="1" stop-color="#b80000"/>
  </linearGradient></defs>
  <path d="M18 6 50 38 82 6 94 18 62 50 94 82 82 94 50 62 18 94 6 82 38 50 6 18Z"
    fill="url(#xg)" stroke="#5e0000" stroke-width="9" stroke-linejoin="round"/>
  <path d="M18 6 50 38 82 6 94 18 62 50 94 82 82 94 50 62 18 94 6 82 38 50 6 18Z"
    fill="url(#xg)" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>
</svg>`;

const sound = new Sound();
const sparkles = new Sparkles($('#sparkles-back'), $('#sparkles-front'));

let scale = 1;
let shown = null; // the state currently drawn
let rowEls = [];
let extraEls = [];
let groupCells = null; // { points: [cell x3], wrong: [cell x3] }
let rowsKey = '';
let rowH = 90;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

// ------------------------------------------------------------ geometry

function resize() {
  scale = Math.min(window.innerWidth / W, window.innerHeight / H);
  stage.style.setProperty('--s', scale);
  sparkles.resize();
}
window.addEventListener('resize', resize);
resize();

// Position of an element in stage units (the stage is 1920x1080 and CSS-scaled to the window).
function rel(node) {
  const r = node.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  return { x: (r.left - s.left) / scale, y: (r.top - s.top) / scale, w: r.width / scale, h: r.height / scale };
}

function toViewport(x, y) {
  const s = stage.getBoundingClientRect();
  return [s.left + x * scale, s.top + y * scale];
}

function burstAt(box, count, options = {}) {
  const [x, y] = toViewport(box.x + box.w / 2, box.y + box.h / 2);
  sparkles.burst(x, y, count, { spreadX: box.w * scale, spreadY: box.h * scale, ...options });
}

// ------------------------------------------------------------ text fitting

// Shrinks a single line until it fits; squeezes it sideways as a last resort.
function fitLine(span, maxWidth, base, min) {
  span.style.transform = '';
  let size = base;
  span.style.fontSize = `${size}px`;
  let width = span.offsetWidth;
  if (width > maxWidth) {
    size = Math.max(min, Math.floor((size * maxWidth) / width));
    span.style.fontSize = `${size}px`;
    width = span.offsetWidth;
  }
  if (width > maxWidth) span.style.transform = `scaleX(${maxWidth / width})`;
}

// Shrinks a wrapping block until it fits its box.
function fitBlock(node, maxWidth, maxHeight, base, min) {
  let size = base;
  node.style.fontSize = `${size}px`;
  while (size > min && (node.scrollHeight > maxHeight || node.scrollWidth > maxWidth)) {
    size -= 2;
    node.style.fontSize = `${size}px`;
  }
}

function fitRow(row) {
  const box = row.querySelector('.row-text');
  fitLine(box.firstElementChild, box.clientWidth, rowH * 0.56, rowH * 0.3);
}

// ------------------------------------------------------------ rendering (no animation)

let titleKey = '';
function drawTitle(settings) {
  const key = `${settings.title}|${settings.subtitle}`;
  if (key === titleKey) return;
  titleKey = key;
  const title = $('#logo-title');
  title.textContent = settings.title;
  $('#logo-sub').textContent = settings.subtitle || '';
  fitBlock(title, 1104, 440, 200, 60);
}

// Accepted off-board answers sit under the survey answers, always open, marked ✔.
const extrasOf = (round) => round.extras || [];
const rowsKeyOf = (round) => `${round.runId}:${extrasOf(round).length}`;

function buildRows(round) {
  const count = round.answers.length + extrasOf(round).length;
  const gap = count <= 4 ? 26 : count <= 6 ? 18 : 12;
  rowH = Math.min(112, Math.floor((740 - gap * (count - 1)) / count));
  rowsEl.style.setProperty('--row-h', `${rowH}px`);
  rowsEl.style.setProperty('--gap', `${gap}px`);
  rowsEl.replaceChildren();
  rowEls = round.answers.map((answer, i) => {
    const row = el('div', i === 0 ? 'row top' : 'row');
    row.style.setProperty('--i', i);
    row.innerHTML = `<div class="bar"><div class="badge">${i + 1}</div><div class="row-text"><span></span></div></div>`;
    rowsEl.append(row);
    return row;
  });
  extraEls = extrasOf(round).map(() => {
    const row = el('div', 'row extra');
    row.innerHTML = '<div class="bar"><div class="badge">✔</div><div class="row-text"><span></span></div></div>';
    rowsEl.append(row);
    return row;
  });
  rowsKey = rowsKeyOf(round);
}

function drawRow(row, answer) {
  const span = row.querySelector('.row-text span');
  row.classList.toggle('revealed', answer.revealed);
  span.textContent = answer.revealed ? answer.text : '';
  if (answer.revealed) fitRow(row);
}

// A column to the right of the answers: one card per group, "Group N: points" over "N: ✖ wrong answers".
function buildGroups() {
  groupsEl.replaceChildren();
  const make = (card, kind, i) => {
    const cell = el('div', `g-cell g-${kind}`);
    cell.innerHTML =
      kind === 'points'
        ? `<span class="g-name">Group ${i + 1}:</span><b class="g-num">0</b>`
        : `<span class="g-name">${i + 1}:</span><span class="g-x">${X_SVG}</span><b class="g-num">0</b>`;
    card.append(cell);
    return cell;
  };
  const points = [];
  const wrong = [];
  for (const i of [0, 1, 2]) {
    const card = el('div', 'g-group');
    points.push(make(card, 'points', i));
    wrong.push(make(card, 'wrong', i));
    groupsEl.append(card);
  }
  groupCells = { points, wrong };
}

function setCount(cell, value) {
  cell.querySelector('.g-num').textContent = String(value);
}

function drawGroups(groups) {
  if (!groupCells) buildGroups();
  (groups || []).forEach((g, i) => {
    setCount(groupCells.points[i], g.points);
    setCount(groupCells.wrong[i], g.wrong);
  });
}

function bump(cell) {
  cell.animate([{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.3,1)' });
}

// "+N" floats up out of the group's points, and the total ticks over.
async function awardPoints(group, points, total) {
  const cell = groupCells?.points[group];
  if (!cell || !points) return;
  const box = rel(cell);
  const plus = el('div', 'g-plus');
  plus.textContent = `+${points}`;
  plus.style.left = `${box.x + box.w / 2}px`;
  plus.style.top = `${box.y}px`;
  fx.append(plus);
  setCount(cell, total);
  cell.classList.add('scored');
  bump(cell);
  burstAt(box, 26, { gold: true, power: 0.5 });
  await plus.animate(
    [
      { transform: 'translate(-50%, 0) scale(.6)', opacity: 0 },
      { transform: 'translate(-50%, -50px) scale(1.1)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%, -90px) scale(1)', opacity: 0 },
    ],
    { duration: 1000, easing: 'ease-out' },
  ).finished;
  plus.remove();
  cell.classList.remove('scored');
}

let questionKey = '';
function drawQuestion(round) {
  questionEl.classList.toggle('concealed', !round.questionVisible);
  if (!round.questionVisible || round.question === questionKey) return;
  questionKey = round.question;
  questionText.textContent = round.question;
  fitBlock(questionText, 1552, 160, 58, 26);
}

function render(state) {
  shown = state;
  drawTitle(state.settings);
  const inRound = state.phase === 'round' && Boolean(state.round);
  titleScreen.classList.toggle('on', !inRound);
  roundScreen.classList.toggle('on', inRound);
  if (!state.round) return;
  if (rowsKeyOf(state.round) !== rowsKey) buildRows(state.round);
  state.round.answers.forEach((answer, i) => drawRow(rowEls[i], answer));
  extrasOf(state.round).forEach((text, i) => drawRow(extraEls[i], { revealed: true, text }));
  drawQuestion(state.round);
  drawGroups(state.groups);
}

// ------------------------------------------------------------ effects

function dim(amount) {
  dimEl.style.opacity = amount;
}

function flash(background, peak, duration) {
  flashEl.style.background = background;
  flashEl.animate([{ opacity: peak }, { opacity: 0 }], { duration, easing: 'ease-out' });
}

function introRound() {
  sound.whoosh();
  questionEl.animate(
    [
      { transform: 'translateY(-280px)', opacity: 0 },
      { transform: 'translateY(14px)', opacity: 1, offset: 0.7 },
      { transform: 'none', opacity: 1 },
    ],
    { duration: 650, easing: 'cubic-bezier(.2,.8,.3,1)' },
  );
  rowEls.forEach((row, i) => {
    const delay = 260 + i * 110;
    row.querySelector('.bar').animate(
      [
        { transform: 'rotateX(-92deg)', opacity: 0 },
        { transform: 'rotateX(14deg)', opacity: 1, offset: 0.7 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 520, delay, fill: 'backwards', easing: 'ease-out' },
    );
    setTimeout(() => sound.tick(), delay + 160);
  });
  groupsEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 400, fill: 'backwards' });
  return wait(260 + rowEls.length * 110 + 520);
}

// Plain flip, used for the answers nobody guessed.
async function quietReveal(row, text) {
  const bar = row.querySelector('.bar');
  await bar.animate([{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(90deg)' }], { duration: 170, easing: 'ease-in' }).finished;
  drawRow(row, { revealed: true, text });
  sound.tock();
  await bar.animate([{ transform: 'rotateX(-90deg)' }, { transform: 'rotateX(0deg)' }], { duration: 240, easing: 'ease-out' }).finished;
}

// Dims the whole board and sweeps the beams while the drum roll plays. No row is
// singled out, so the audience can't tell which answer is about to appear.
// Resolves with how many ms of the track are still playing after the reveal fires.
async function drumRoll(cueSeconds, tease = false) {
  const beams = [el('div', 'beam l'), el('div', 'beam r')];
  fx.append(...beams);
  dim(0.82);
  void fx.offsetWidth;
  beams.forEach((beam) => beam.classList.add('on'));

  const { ms, synthesized, reached, left } = await sound.drumroll(cueSeconds, { tease });
  const started = performance.now();
  const centre = { x: W * 0.2, y: H * 0.3, w: W * 0.6, h: H * 0.4 };
  const twinkle = setInterval(() => {
    const progress = Math.min(1, (performance.now() - started) / ms);
    burstAt(centre, 1 + Math.round(progress * 5), { gold: true, power: 0.25 + progress * 0.4 });
  }, 90);
  await (reached || wait(ms));
  clearInterval(twinkle);

  beams.forEach((beam) => beam.classList.remove('on'));
  setTimeout(() => beams.forEach((beam) => beam.remove()), 600);
  if (synthesized) sound.crash();
  flash('#fff', 0.9, 700);
  return left ? left() : 0;
}

// The reveal: the answer slams in huge at the centre of the screen, holds,
// then shrinks into its bar on the board.
async function bigReveal(row, index, text, settings, withDrumRoll) {
  const isTop = index === 0;
  const span = row.querySelector('.row-text span');

  // Lift the row above the dimmer only after the drum roll, so it doesn't give the answer away.
  let musicLeft = 0;
  if (withDrumRoll) musicLeft = await drumRoll(settings.drumrollCue, !isTop);
  else dim(0.5);
  row.classList.add('lifted');

  // Lay the answer out at its final size inside the bar, hidden for now.
  span.textContent = text;
  row.classList.add('revealed', 'revealing');
  fitRow(row);
  const target = rel(span);

  const fly = el('div', isTop ? 'fly gold' : 'fly');
  const inner = el('div', 'fly-inner');
  const hot = el('span', 'fly-hot');
  const cool = el('span', 'fly-cool');
  hot.textContent = cool.textContent = text;
  inner.append(hot, cool);
  fly.append(inner);
  fx.append(fly);

  // Blow it up as far as the screen allows.
  const maxW = W * (withDrumRoll ? 0.9 : 0.84);
  const maxH = withDrumRoll ? 340 : 250;
  let size = parseFloat(span.style.fontSize) * Math.max(1.6, maxH / target.h);
  inner.style.fontSize = `${size}px`;
  if (inner.offsetWidth > maxW) {
    size *= maxW / inner.offsetWidth;
    inner.style.fontSize = `${size}px`;
  }
  const bigW = inner.offsetWidth;
  const bigH = inner.offsetHeight;
  const centreY = withDrumRoll ? 510 : 540; // leaves room for the label underneath
  const left = (W - bigW) / 2;
  const top = centreY - bigH / 2;
  fly.style.left = `${left}px`;
  fly.style.top = `${top}px`;

  const dx = target.x + target.w / 2 - (left + bigW / 2);
  const dy = target.y + target.h / 2 - (top + bigH / 2);
  const landing = `translate(${dx}px, ${dy}px) scale(${target.w / bigW}, ${target.h / bigH})`;

  // Timeline in ms: slam in, hold at the centre, then shrink into the bar. On the top
  // answer the hold lasts until the drum-roll track (the beat drop) has finished playing.
  const base = withDrumRoll ? 3300 : 1700;
  const slamMs = base * (withDrumRoll ? 0.08 : 0.15);
  const baseHoldMs = base * (withDrumRoll ? 0.68 : 0.54);
  const holdMs = Math.max(baseHoldMs, musicLeft);
  const total = holdMs + (base - baseHoldMs);
  const slam = slamMs / total; // fraction of the timeline where the text lands at full size
  const hold = holdMs / total; // ...and where it starts to shrink
  const timing = { duration: total, fill: 'both' };

  inner.animate(
    [
      { transform: 'scale(2.6)', opacity: 0, offset: 0, easing: 'cubic-bezier(.2,.9,.3,1.3)' },
      { transform: 'scale(1)', opacity: 1, offset: slam, easing: 'ease-in-out' },
      { transform: 'scale(1.05)', opacity: 1, offset: hold },
      { transform: 'scale(1)', opacity: 1, offset: 1 },
    ],
    timing,
  );
  const flight = fly.animate(
    [
      { transform: 'translate(0px, 0px) scale(1, 1)', offset: 0 },
      { transform: 'translate(0px, 0px) scale(1, 1)', offset: hold, easing: 'cubic-bezier(.7,0,.2,1)' },
      { transform: landing, offset: 1 },
    ],
    timing,
  );
  const blend = hold + (1 - hold) * 0.4;
  hot.animate([{ opacity: 1, offset: 0 }, { opacity: 1, offset: blend }, { opacity: 0, offset: 1 }], timing);
  cool.animate([{ opacity: 0, offset: 0 }, { opacity: 0, offset: blend }, { opacity: 1, offset: 1 }], timing);

  let label = null;
  if (withDrumRoll && isTop && settings.topLabel) {
    label = el('div', 'toplabel');
    label.textContent = `★ ${settings.topLabel} ★`;
    label.style.top = `${top + bigH + 36}px`;
    fx.append(label);
    label.animate(
      [
        { transform: 'scale(.3)', opacity: 0, offset: 0 },
        { transform: 'scale(.3)', opacity: 0, offset: slam },
        { transform: 'scale(1)', opacity: 1, offset: slam + 230 / total },
        { transform: 'scale(1)', opacity: 1, offset: hold - 200 / total },
        { transform: 'scale(.8)', opacity: 0, offset: hold },
        { transform: 'scale(.8)', opacity: 0, offset: 1 },
      ],
      timing,
    );
  }

  const centre = { x: left, y: top, w: bigW, h: bigH };
  setTimeout(() => {
    // On the top answer the drum roll's beat drop is the reveal sound, so no ding over it.
    if (!(isTop && withDrumRoll)) sound.ding();
    burstAt(centre, withDrumRoll ? 190 : 50, { gold: isTop, power: withDrumRoll ? 1.25 : 0.8 });
  }, slamMs * 0.8);
  if (withDrumRoll) {
    // Keep the confetti going for as long as the text holds at the centre.
    for (let at = base * 0.3; at < holdMs - 300; at += base * 0.2) {
      setTimeout(() => burstAt(centre, 70, { gold: true, power: 0.7 }), at);
    }
  }
  setTimeout(() => {
    sound.whoosh();
    dim(0);
  }, holdMs);

  await flight.finished;

  fly.remove();
  label?.remove();
  row.classList.remove('revealing', 'lifted');
  row.querySelector('.bar').animate([{ transform: 'scale(1.05)' }, { transform: 'scale(1)' }], {
    duration: 420,
    easing: 'cubic-bezier(.2,.8,.3,1)',
  });
  burstAt(rel(row), withDrumRoll ? 90 : 32, { gold: isTop, power: 0.55 });
  await wait(withDrumRoll ? 500 : 250);
}

// A good answer that isn't on the board: it pops up in the middle, gets a cheer,
// and fades away without touching the rows or the strikes.
async function acceptedGuess(text) {
  const fly = el('div', 'fly accepted');
  const inner = el('div', 'fly-inner');
  const hot = el('span', 'fly-hot');
  hot.textContent = `✔ ${text}`;
  inner.append(hot);
  const note = el('div', 'accepted-note');
  note.textContent = 'Good answer!';
  fly.append(inner, note);
  fx.append(fly);

  inner.style.fontSize = '110px';
  if (inner.offsetWidth > W * 0.84) inner.style.fontSize = `${110 * ((W * 0.84) / inner.offsetWidth)}px`;
  const left = (W - fly.offsetWidth) / 2;
  const top = (H - fly.offsetHeight) / 2;
  fly.style.left = `${left}px`;
  fly.style.top = `${top}px`;

  dim(0.5);
  setTimeout(() => {
    sound.ding();
    burstAt({ x: left, y: top, w: fly.offsetWidth, h: fly.offsetHeight }, 60, { power: 0.8 });
  }, 180);
  await fly.animate(
    [
      { transform: 'scale(2.2)', opacity: 0, offset: 0, easing: 'cubic-bezier(.2,.9,.3,1.3)' },
      { transform: 'scale(1)', opacity: 1, offset: 0.12 },
      { transform: 'scale(1.04)', opacity: 1, offset: 0.8 },
      { transform: 'scale(.9)', opacity: 0, offset: 1 },
    ],
    { duration: 2200, fill: 'both' },
  ).finished;
  fly.remove();
  dim(0);
}

async function strike(group, count) {
  const slot = groupCells?.wrong[group]?.querySelector('.g-x');
  const size = 620;
  const left = (W - size) / 2;
  const top = (H - size) / 2;
  const big = el('div', 'bigx');
  big.innerHTML = X_SVG;
  big.style.cssText = `left:${left}px;top:${top}px;width:${size}px;height:${size}px`;
  fx.append(big);

  sound.buzzer();
  flash('radial-gradient(circle, rgba(255,60,40,.25), rgba(200,0,0,.85))', 0.75, 700);
  dim(0.6);
  roundScreen.animate(
    [0, 14, -12, 9, -6, 3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
    { duration: 420, easing: 'ease-out' },
  );
  await big.animate(
    [
      { transform: 'scale(2.8) rotate(-10deg)', opacity: 0 },
      { transform: 'scale(.94) rotate(0deg)', opacity: 1, offset: 0.6 },
      { transform: 'scale(1.04)', opacity: 1, offset: 0.8 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: 330, easing: 'ease-out' },
  ).finished;
  await wait(800);
  dim(0);

  if (slot) {
    const box = rel(slot);
    const dx = box.x + box.w / 2 - (left + size / 2);
    const dy = box.y + box.h / 2 - (top + size / 2);
    await big.animate(
      [{ transform: 'translate(0px, 0px) scale(1)' }, { transform: `translate(${dx}px, ${dy}px) scale(${box.w / size})` }],
      { duration: 460, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' },
    ).finished;
    const cell = groupCells.wrong[group];
    setCount(cell, count);
    bump(cell);
  }
  big.remove();
  await wait(150);
}

async function testSound(name, settings) {
  if (name === 'ding') sound.ding();
  else if (name === 'buzzer') sound.buzzer();
  else if (name === 'drumroll') {
    const { ms, synthesized } = await sound.drumroll(settings.drumrollCue);
    await wait(ms);
    if (synthesized) sound.crash();
    sound.ding();
  }
}

// ------------------------------------------------------------ events from the server

async function play(event, state) {
  const round = state.round;
  // Only animate if this event belongs to the board that is on screen right now.
  const sameBoard = Boolean(round) && shown?.round?.runId === round.runId && state.phase === 'round' && shown.phase === 'round';

  switch (event.kind) {
    case 'round':
      sound.loadFiles();
      render(state);
      await introRound();
      break;

    case 'reveal': {
      const row = rowEls[event.index];
      if (!sameBoard || !row || row.classList.contains('revealed')) break;
      const text = round.answers[event.index].text;
      if (event.mode === 'quiet') await quietReveal(row, text);
      else await bigReveal(row, event.index, text, state.settings, event.mode === 'drum');
      if (Number.isInteger(event.group)) await awardPoints(event.group, event.points, state.groups[event.group].points);
      break;
    }

    case 'revealAll':
      if (!sameBoard) break;
      // Bottom of the board first, so the top answer comes last.
      for (const index of [...event.indices].sort((a, b) => b - a)) {
        const row = rowEls[index];
        if (!row || row.classList.contains('revealed')) continue;
        await quietReveal(row, round.answers[index].text);
        await wait(380);
      }
      break;

    case 'strike':
      if (sameBoard) await strike(event.group, event.count);
      break;

    case 'accepted':
      if (!sameBoard) break;
      await acceptedGuess(event.text);
      if (event.added) {
        // Make room for the new row, then flip it in at the bottom.
        render(state);
        const bar = extraEls[extraEls.length - 1]?.querySelector('.bar');
        await bar?.animate(
          [
            { transform: 'rotateX(-92deg)', opacity: 0 },
            { transform: 'rotateX(14deg)', opacity: 1, offset: 0.7 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: 520, easing: 'ease-out' },
        ).finished;
      }
      break;

    case 'sound':
      await testSound(event.name, state.settings);
      break;

    default:
      break;
  }
}

// Messages are handled strictly one after another so animations never overlap.
let queue = Promise.resolve();

connect({
  role: 'board',
  onState({ state, event }) {
    queue = queue
      .then(async () => {
        if (event) await play(event, state);
        render(state);
      })
      .catch((err) => {
        // An animation failed part-way: drop the effects and snap to the real state.
        console.error(err);
        fx.replaceChildren();
        dim(0);
        rowEls.forEach((row) => row.classList.remove('revealing', 'lifted', 'spot'));
        render(state);
      });
  },
  onStatus(online) {
    $('#offline').classList.toggle('show', !online);
  },
});

// ------------------------------------------------------------ sound unlock + fullscreen

const startButton = $('#start');
function unlock() {
  sound.unlock();
  startButton.classList.add('gone');
}
startButton.addEventListener('click', unlock);
window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  unlock();
});

sound.loadFiles();
