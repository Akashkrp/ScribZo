# SCRIBZO ✦ draw guess flex

The multiplayer drawing game where your friends watch you fail **live on camera**. Draw, guess, earn coins, spend them on chaos, and let the AI judge roast whoever cooked the worst.

---

## 🚀 Getting in

```bash
npm install
npm start
```

Open **http://localhost:3000**. Playing with friends? They open the same address on your network (or each open a tab to test solo-squad).

> 📹 Camera needs `localhost` or HTTPS — browsers block cams on plain http over LAN. The game itself works fine either way.

Three ways into a game:

- **PLAY NOW ⚡** — throws you into a public room with randoms (or makes one if empty)
- **+ make room** — private room; you get a 5-letter code, click it to copy and send to the gc
- **join w/ code** — paste your friend's code, you're in

Pick your avatar (tap it to cycle), drop a name, go.

---

## 🎮 How a game works

1. **Lobby** — the host sets rounds (2/3/5), draw time (60/80/120s), and the **word topic**. Trash-talk chat is open the whole time.
2. Every round, **each player gets one turn to draw**. The drawer picks 1 of 3 words (15s to choose or one gets picked for you).
3. Everyone else types guesses in chat. Spelling matters-ish — if you're one letter off, the game whispers *"sooo close 👀"* to you only.
4. Letters of the word get revealed as hints while the clock runs down.
5. Once you guess correctly, your chat goes **whisper mode** — only the drawer and other correct guessers can see your messages. No spoiling.
6. Turn ends when everyone guesses or time runs out. After all rounds: podium, confetti, bragging rights.

**📹 Face cams:** hit the camera button (top right) anytime to go live, Google Meet style. Mute button appears once you're on. Watching someone realize mid-drawing that they can't draw is the whole point of this game.

---

## 🧮 The point system (exact math, for the min-maxers)

**Guessing a word:**

```
points = 200 + (300 × time-remaining %) + order bonus
```

- Guess instantly → ~500 pts. Guess at the buzzer → ~200 pts.
- **Order bonus:** 1st correct guess +50, 2nd +40, 3rd +30… speed is everything.

**Drawing:** you earn **¼ of each guesser's points**. More people guessing = more points for you. If nobody guesses, you get nothing (unless the AI judge shows mercy — see below).

**🪙 Coins** (separate from points — points win games, coins buy power-ups):

| Action | Coins |
|---|---|
| Starting stack | 🪙 30 |
| Correct guess | +15 |
| Per player who guesses your drawing | +8 |
| Completing a daily challenge | +20 |
| AI judge partial credit | +5 |

---

## 🤖 How the AI Judge works

The judge only wakes up when a turn ends with **zero correct guesses**. Then three things happen:

1. **It rates the drawing /10.** The judge analyzes the actual artwork — stroke count, how much was drawn, how many colors were used, whether the fill bucket got involved — and produces a verdict from *"gallery worthy 🤯"* down to *"AI judge has filed a complaint 💀"*. The score is cosmetic; the roast is the point.

2. **It awards partial credit.** Every wrong guess you made during the turn is scored for similarity against the real word (letter-distance + word-overlap). Your *best* near-miss counts. If it's ≥55% similar, you're in the running:

   ```
   partial points = 120 × similarity    (so up to ~119 pts)
   ```

   Only the **top 3 closest guessers** get paid, plus 🪙5 each. Guessed "titanic ship" when the word was "titanic"? That's basically a win.

3. **Hints were already working for you.** Throughout every turn, the judge reveals letters automatically — roughly one letter per third of the word, spread across the timer. The longer you wait, the easier it gets (but the fewer points you earn — that's the tension).

No API keys, no internet calls — the judge runs instantly on the server for every player.

---

## 🪙 Power-ups (spend those coins)

Buy mid-turn. Drawer-only unless marked:

| Power-up | Cost | What it does |
|---|---|---|
| ⏪ Undo Boost | 🪙 5 | erases your last 3 strokes in one hit |
| 🖌️ Mega Brush | 🪙 10 | unlocks a comically large XXL brush size |
| ✨ Glow Pen | 🪙 15 | neon glow strokes for the rest of your turn |
| 🌈 Rainbow Pen | 🪙 20 | color auto-cycles as you draw |
| 🧊 Time Freeze | 🪙 25 | **anyone can use** — freezes the clock for 5 seconds |

Pro moves: guessers can freeze time when they're *thiiis* close. Drawers can freeze it when the masterpiece needs 5 more seconds. Glow + Rainbow toggle off for free if you change your mind.

---

## 🎯 Word topics

The host picks in the lobby — words come from that universe:

🎲 mix · 🎨 classic · ⛩️ anime · 🎬 movies · ⚙️ engineering · 🦄 startups · 🏏 cricket · 💀 memes

The generator also remixes words randomly (~20% of the time) — expect "chibi totoro", "zombie titanic", "failed unicorn startup". No two games feel the same.

---

## ⚡ Daily Challenges

One challenge rotates in **every day** (shown on the home screen). When it's your turn to draw, you'll see a checkbox in the word picker — accept it for **2x drawer points + 🪙20**:

| Challenge | The deal |
|---|---|
| ⭕ Circle Szn | you can ONLY draw circles (click-drag to size them) |
| 〰️ One-Line Wonder | one stroke. lift the brush = done forever |
| 🪞 Mirror Mode | your brush is horizontally flipped. left is right. suffer |
| ⚡ Speedrun | you draw only in the first 20 seconds, then hands off |

These aren't honor system — the canvas engine enforces them. Everyone sees a banner showing you're on a challenge run, so the pressure is real.

---

## 💬 Chat rules

- **Lobby chat:** anything goes, warm up the trash talk
- **Game chat:** every message is treated as a guess; non-guesses just show as chat
- Already guessed? You're in whisper mode — spoiler-proof
- Close guesses nudge you privately, so watch for the 👀

---

## 🏆 Winning

Highest **points** (not coins) after the final round. Top 3 get the podium, everyone else gets listed in shame order. Hit **RUN IT BACK 🔁** to rematch with the same lobby.

---

## 🛠️ For the devs

```
server/
  index.js    — express + socket.io events, WebRTC signaling, /api/daily
  game.js     — Room: rounds, scoring, coins, power-ups, AI judge hook
  judge.js    — AI judge: similarity scoring + drawing verdicts
  powerups.js — power-up definitions + daily challenge rotation
  words.js    — topic word banks + remix generator
public/
  index.html  — home / lobby / game screens + modals
  css/        — base.css (home, lobby, shared) · game.css (game screen)
  js/
    main.js   — screens, lobby, topic chips, video buttons
    game.js   — game UI: timer, power-up bar, AI judge box, leaderboard
    canvas.js — drawing engine: glow/rainbow pens, challenge modes
    video.js  — WebRTC P2P mesh video (no API keys)
```

All files under 1000 lines, zero build step, two dependencies (`express`, `socket.io`).
