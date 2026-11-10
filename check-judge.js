// Quick test of the judge from the command line:  npm run check
// Makes three small API calls with your key and prints what the judge decided.
import './env.js';
import { askJudge, describeJudgeError, hasCredentials, JUDGE_MODEL } from './judge.js';

const question = 'Name an excuse people give for being late to work.';
const answers = ['Traffic', 'Overslept', 'Heavy rain', 'Vehicle trouble', 'Family emergency'];
const guesses = [
  { guess: 'macet', expect: 1 },
  { guess: 'ban motor bocor', expect: 4 },
  { guess: 'my boss is on holiday', expect: 0 },
];

console.log(`\nJudge model: ${JUDGE_MODEL}`);
if (!hasCredentials()) console.log('No ANTHROPIC_API_KEY found in .env.');
console.log(`Question: ${question}`);
console.log(`Board: ${answers.map((a, i) => `${i + 1}. ${a}`).join('  ')}\n`);

let passed = 0;
for (const { guess, expect } of guesses) {
  const started = Date.now();
  try {
    const verdict = await askJudge(question, answers, guess);
    const got = verdict.match === null ? 0 : verdict.match + 1;
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const ok = got === expect;
    if (ok) passed += 1;
    console.log(`${ok ? 'OK  ' : 'DIFF'} "${guess}" -> ${got ? `#${got} ${answers[got - 1]}` : 'not on the board'} (${verdict.confidence}, ${seconds}s)`);
    console.log(`      ${verdict.reason}`);
    if (!ok) console.log(`      expected ${expect ? `#${expect}` : 'not on the board'}`);
  } catch (err) {
    console.log(`FAIL "${guess}" -> ${describeJudgeError(err)}`);
  }
}

console.log(`\n${passed} of ${guesses.length} verdicts as expected.`);
process.exit(passed === guesses.length ? 0 : 1);
