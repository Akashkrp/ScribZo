// ============ SCRIBZO AI Judge ============
// Offline heuristic judge: scores near-miss guesses with string similarity
// and roasts/praises the drawing based on stroke statistics.

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return prev[n];
}

function similarity(guess, target) {
  const a = guess.toLowerCase().trim();
  const b = target.toLowerCase().trim();
  if (!a || !b) return 0;
  if (a === b) return 1;
  // word-overlap bonus for multi-word answers
  const wordsA = new Set(a.split(/\s+/));
  const wordsB = b.split(/\s+/);
  const overlap = wordsB.filter(w => wordsA.has(w)).length / wordsB.length;
  const lev = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return Math.max(lev, overlap * 0.9);
}

// analyse draw history -> playful verdict about the artwork
function drawingVerdict(history) {
  const strokes = history.filter(d => d.type === 'start' || d.type === 'circle').length;
  const moves = history.filter(d => d.type === 'move').length;
  const fills = history.filter(d => d.type === 'fill').length;
  const colors = new Set(history.map(d => d.color).filter(Boolean)).size;

  if (history.length === 0) {
    return { score: 0, text: 'the canvas is... empty?? bold artistic statement, zero points 💀' };
  }
  let score = Math.min(10, Math.round(
    Math.min(4, strokes / 5) + Math.min(3, moves / 120) + Math.min(2, colors / 2) + Math.min(1, fills)
  ));
  let text;
  if (score >= 8) text = `the AI judge is SHOOK 🤯 ${strokes} strokes, ${colors} colors — gallery worthy. ${score}/10`;
  else if (score >= 6) text = `solid effort, lowkey ate that 🎨 ${score}/10 from the AI judge`;
  else if (score >= 4) text = `the AI judge squints... it's giving abstract art 🧐 ${score}/10`;
  else if (score >= 2) text = `AI judge says: "i see... lines" 😭 ${score}/10`;
  else text = `AI judge has filed a complaint 💀 ${score}/10`;
  return { score, text };
}

// when nobody guessed: award partial credit for closest guesses
function judgeTurn(word, guessLog, drawHistory) {
  const verdict = drawingVerdict(drawHistory);
  const awards = [];
  for (const [playerId, g] of guessLog) {
    if (g.sim >= 0.55) {
      const pts = Math.round(120 * g.sim);
      awards.push({ playerId, guess: g.text, sim: g.sim, points: pts, coins: 5 });
    }
  }
  awards.sort((a, b) => b.sim - a.sim);
  return { verdict, awards: awards.slice(0, 3) }; // top 3 near-misses get credit
}

module.exports = { similarity, judgeTurn, drawingVerdict };
