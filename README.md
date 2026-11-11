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
- Type what the contestant said and press **Enter**. When the verdict appears, press **Enter** again to accept it (reveal or strike), or use the buttons to overrule it.
- The judge is generous: a specific kind of an answer counts, so "ramen" matches "Noodles".
- When a guess is not on the board but is still a good answer, the verdict says **Good answer, not on the board** and offers **Add to the board**. That puts it on the bottom row and reveals it, for this round only; the saved question is not changed. The board fits 8 answers at most.
- Every answer also has manual buttons, which work without the judge:
  - **Reveal** plays the big-text reveal. On the top answer it plays the drum roll first.
  - **Drum roll / No drum roll** switches the drum roll on or off for that one reveal.
  - **Quiet** flips the answer open with no fanfare.
- **Reveal all remaining answers** opens what nobody guessed, bottom to top.

## Questions

Edit them in Admin > Questions: one answer per line, most popular first, up to 8 per question. The first line is the top answer. 

**✨ Ask Claude** on a question writes its answers for you, ranked by how popular Claude thinks they are, in the question's language. Leave the question blank and Claude writes a new question as well. Claude's answers go into the editor without being saved: check and edit them, then press **Save changes**. They are Claude's estimate, not a real survey.

They are stored in `data/questions.json`, which you can also edit by hand or swap using Import and Export. The four questions that ship with the game are samples.

## Your own sounds

Put files in `public/audio/` with these names (`.mp3`, `.wav`, `.ogg` or `.m4a`):

| File | Plays |
|---|---|
| `drumroll.mp3` | Before the top answer is revealed |
| `reveal.mp3` | When an answer is revealed (optional) |
| `strike.mp3` | On a wrong answer (optional) |

Anything missing uses a built-in synthesized sound. The top answer appears when the drum roll track ends. If the big hit in your track comes earlier, set **Reveal at** in Admin > Settings to that time in seconds. Admin > Settings also has a sound check.

## Settings in `.env`

| Name | Meaning |
|---|---|
| `ANTHROPIC_API_KEY` | Key used by the server for the judge. It is never sent to a browser. |
| `PIN` | PIN for the admin and presenter pages. Empty means no PIN. |
| `JUDGE_MODEL` | Model that judges answers. Default `claude-opus-5-5`. |
| `PORT` | Port the server listens on. Default `3000`. |

Restart the server after changing `.env`. The game title and the other board options are in Admin > Settings.
