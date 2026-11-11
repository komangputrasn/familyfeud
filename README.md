# Survey Showdown

A survey-guessing party game for a projector, with three screens that stay in sync:

| Screen | Address | Who uses it |
|---|---|---|
| Board | `http://localhost:3000/` | Shown on the projector |
| Admin | `http://localhost:3000/admin` | The operator: types answers, has Claude judge them, reveals and strikes |
| Presenter | `http://localhost:3000/presenter` | The host: sees every answer, what is revealed, and the judge's verdict |

## Setup

1. Open `.env` and paste your Anthropic API key after `ANTHROPIC_API_KEY=`.
2. Start the server:

   ```
   npm start
   ```

   It prints the three addresses, the PIN, and the address other devices on the same Wi-Fi should use.
   The first time, Windows may ask whether to allow Node through the firewall. Allow it, or phones and other laptops cannot connect.
3. Test the judge with your key (three tiny API calls):

   ```
   npm run check
   ```

The admin and presenter pages ask for the PIN from `.env`. The board needs no PIN and never receives hidden answers.

## Running the show

- Open the board in **its own browser window** on the projector, click it once (browsers block sound until a click) and press **F** for fullscreen. Keep that window visible: a browser pauses animations in a hidden tab.
- In Admin > Play, pick a question and press **Start this question**.
- Type what the contestant said and press **Enter**. When the verdict appears, press **Enter** again to accept it (reveal or strike), or use the buttons to overrule it. If the guess isn't on the board but is still a sensible answer, the judge says **Good answer, not on the board**. Accepting that costs no strike and gives no points. The board cheers the guess and adds it as a green ✔ row under the survey answers, up to 10 rows in total. The hidden answers stay hidden. **Remove** in Admin takes the row off again.
- Every answer also has manual buttons, which work without the judge:
  - **Reveal** plays the big-text reveal. On the top answer it plays the drum roll first.
  - **Drum roll / No drum roll** switches the drum roll on or off for that one reveal.
  - **Quiet** flips the answer open with no fanfare.
- **Reveal all remaining answers** opens what nobody guessed, bottom to top. It gives no points.

### Groups and scores

Three groups play: Group 1, Group 2 and Group 3. Below the answers, the board shows each group's points on the first row and its wrong answers (✖) on the second.

- Before every reveal or strike, Admin asks **Which group?** Press **1**, **2** or **3**, or **0** to reveal with no points. **Esc** cancels.
- Points go by rank: on a board with 6 answers, #1 is worth 6 points and #6 is worth 1.
- Points and wrong answers add up over the whole game. There is no strike limit.
- **Hide again** on an answer takes its points back. The Groups card in Admin has a ✖ and an **Undo ✖** button for each group, and **Reset scores** sets everything back to 0. **Reset the game** keeps the scores.

## Questions

Edit them in Admin > Questions: one answer per line, most popular first, up to 8 per question. The first line is the top answer. They are stored in `data/questions.json`, which you can also edit by hand or swap using Import and Export. The four questions that ship with the game are samples.

## Your own sounds

Put files in `public/audio/` with these names (`.mp3`, `.wav`, `.ogg` or `.m4a`):

| File | Plays |
|---|---|
| `drumroll.mp3` | Before the top answer is revealed |
| `tease.mp3` | Fake-out drum roll on a regular answer; stops at the same **Reveal at** time as the real one (optional, falls back to the drum roll) |
| `reveal.mp3` | When an answer is revealed (optional) |
| `strike.mp3` | On a wrong answer (optional) |

For variety on strikes, drop any number of audio files (any names) into `data/wrong/`. Each strike then plays one of them at random, never the same one twice in a row, and `strike.mp3` is ignored.

Anything missing uses a built-in synthesized sound. The top answer appears when the drum roll track ends. To reveal earlier, set **Reveal at** in Admin > Settings to a time in seconds: the answer appears there. Set it just before the beat drop: on the top answer the track plays on so the drop lands with the reveal, while a fake-out roll stops there and never plays the drop. Admin > Settings also has a sound check.

## Settings in `.env`

| Name | Meaning |
|---|---|
| `ANTHROPIC_API_KEY` | Key used by the server for the judge. It is never sent to a browser. |
| `PIN` | PIN for the admin and presenter pages. Empty means no PIN. |
| `JUDGE_MODEL` | Model that judges answers. Default `claude-opus-5-5`. |
| `PORT` | Port the server listens on. Default `3000`. |

Restart the server after changing `.env`. The game title and the other board options are in Admin > Settings.
