import { connect, pinGate, escapeHtml as h } from './net.js';

const $ = (selector) => document.querySelector(selector);

function verdictHtml(judge, round) {
  if (!judge) return '';
  const guess = `<div class="guess">Contestant said: “${h(judge.guess)}”</div>`;
  if (judge.status === 'pending') {
    return `<div class="verdict">${guess}<div class="headline"><span class="spinner"></span>Judging…</div></div>`;
  }
  if (judge.status === 'error') {
    return `<div class="verdict warn">${guess}<div class="headline">The judge could not answer</div>
      <div class="reason">The operator will decide this one.</div></div>`;
  }
  if (judge.match === null && judge.extra) {
    return `<div class="verdict extra">${guess}<div class="headline">✔ Good answer, not on the board: ${h(judge.extra)}</div>
      <div class="reason">${h(judge.reason)} The operator can add it to the board.</div></div>`;
  }
  if (judge.match === null) {
    return `<div class="verdict miss">${guess}<div class="headline">✖ Not on the board</div>
      <div class="reason">${h(judge.reason)}</div></div>`;
  }
  const answer = round.answers[judge.match];
  const name = `#${judge.match + 1} ${h(answer?.text ?? judge.matchText)}`;
  if (answer?.revealed) {
    return `<div class="verdict warn">${guess}<div class="headline">Already on the board: ${name}</div>
      <div class="reason">${h(judge.reason)}</div></div>`;
  }
  return `<div class="verdict match">${guess}<div class="headline">✔ Matches ${name}</div>
    <div class="reason">${h(judge.reason)}</div></div>`;
}

function nextHtml(next, label) {
  if (!next) return '<div class="card next-up muted">This is the last question.</div>';
  return `<details class="card next-up">
    <summary>${label}: ${h(next.question)}</summary>
    <ol>${next.answers.map((a) => `<li>${h(a)}</li>`).join('')}</ol>
  </details>`;
}

function render(state) {
  const { round, judge, settings, position, next, phase } = state;

  if (!round) {
    $('#where').textContent = 'Title screen';
    $('#content').innerHTML = `
      <div class="card"><div class="question">${h(settings.title)}</div>
        <p class="muted">The title screen is showing. No question has been started yet.</p></div>
      ${nextHtml(next, 'First question')}`;
    return;
  }

  $('#where').textContent = position.index >= 0 ? `Question ${position.index + 1} of ${position.total}` : 'Question';

  const answers = round.answers
    .map((answer, i) => {
      const suggested = judge?.status === 'done' && judge.match === i && !answer.revealed;
      return `<div class="p-ans ${answer.revealed ? 'shown' : ''} ${suggested ? 'suggested' : ''}">
        <span class="num">${i + 1}</span>
        <span class="txt">${h(answer.text)}</span>
        ${i === 0 ? '<span class="chip gold">Top</span>' : ''}
        ${answer.revealed ? '<span class="chip green">On board</span>' : ''}
      </div>`;
    })
    .join('');

  const marks = Array.from({ length: settings.maxStrikes }, (_, i) => `<span class="${i < round.strikes ? 'on' : ''}">✖</span>`).join('');
  const left = round.answers.filter((a) => !a.revealed).length;

  $('#content').innerHTML = `
    <div class="card">
      <div class="question">${h(round.question)}</div>
      <div class="row-line">
        ${phase === 'title' ? '<span class="chip gold">Title screen is showing</span>' : ''}
        ${round.questionVisible ? '' : '<span class="chip gold">Question hidden on the board</span>'}
      </div>
    </div>
    ${verdictHtml(judge, round)}
    <div class="card">
      <h2>Answers · ${left} still hidden</h2>
      ${answers}
    </div>
    <div class="card p-strikes"><h2 style="margin:0">Strikes</h2><div class="strike-marks">${marks}</div></div>
    ${nextHtml(next, 'Up next')}`;
}

const pin = pinGate();
const net = connect({
  role: 'presenter',
  getPin: pin.get,
  onState: (message) => render(message.state),
  onStatus(online) {
    const node = $('#status');
    node.classList.toggle('online', online);
    node.textContent = online ? 'Live' : 'Offline';
  },
  onAuthFail() {
    pin.ask(() => net.retry());
  },
});
