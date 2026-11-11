// Quick test of the judge from the command line:  npm run check
// Makes a few small API calls with your key and prints what the judge decided.
import './env.js';
import { askJudge, describeJudgeError, hasCredentials, JUDGE_MODEL } from './judge.js';

const late = {
  question: 'Name an excuse people give for being late to work.',
  answers: ['Traffic', 'Overslept', 'Heavy rain', 'Vehicle trouble', 'Family emergency'],
};
const food = {
  question: 'Name a food people order when they work overtime.',
  answers: ['Fried rice', 'Pizza', 'Fried chicken', 'Noodles'],
};

// expect: board number, 0 = not on the board. extra: whether it should be offered as a new answer.
const cases = [
  { ...late, guess: 'macet', expect: 1 },
  { ...late, guess: 'ban motor bocor', expect: 4 },
  { ...food, guess: 'ramen', expect: 4 },
  { ...late, guess: 'sakit perut', expect: 0, extra: true },
  { ...late, guess: 'my boss is on holiday', expect: 0, extra: false },
];

console.log(`\nJudge model: ${JUDGE_MODEL}`);
if (!hasCredentials()) console.log('No ANTHROPIC_API_KEY found in .env.');

let passed = 0;
for (const { question, answers, guess, expect, extra } of cases) {
  const started = Date.now();
  try {
    const verdict = await askJudge(question, answers, guess);
    const got = verdict.match === null ? 0 : verdict.match + 1;
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const ok = got === expect && (extra === undefined || Boolean(verdict.extra) === extra);
    if (ok) passed += 1;
    const result = got
      ? `#${got} ${answers[got - 1]}`
      : verdict.extra
        ? `not on the board, good answer to add: "${verdict.extra}"`
        : 'not on the board';
    console.log(`${ok ? 'OK  ' : 'DIFF'} "${guess}" -> ${result} (${verdict.confidence}, ${seconds}s)`);
    console.log(`      ${verdict.reason}`);
    if (!ok) console.log(`      expected ${expect ? `#${expect}` : extra ? 'a good answer to add' : 'a wrong answer'}`);
  } catch (err) {
    console.log(`FAIL "${guess}" -> ${describeJudgeError(err)}`);
  }
}

console.log(`\n${passed} of ${cases.length} verdicts as expected.`);
process.exit(passed === cases.length ? 0 : 1);
