// ============ SCRIBZO power-ups & daily challenges ============

const POWERUPS = {
  megabrush: { cost: 10, label: 'Mega Brush', emoji: '🖌️', who: 'drawer', desc: 'unlock XXL brush size' },
  glow:      { cost: 15, label: 'Glow Pen', emoji: '✨', who: 'drawer', desc: 'neon glow strokes' },
  rainbow:   { cost: 20, label: 'Rainbow Pen', emoji: '🌈', who: 'drawer', desc: 'taste the rainbow' },
  undoboost: { cost: 5,  label: 'Undo Boost', emoji: '⏪', who: 'drawer', desc: 'undo last 3 strokes' },
  freeze:    { cost: 25, label: 'Time Freeze', emoji: '🧊', who: 'any', desc: 'freeze the clock 5s' }
};

// rotating daily challenges (drawer can accept for 2x points + bonus coins)
const CHALLENGES = [
  { id: 'circles', emoji: '⭕', title: 'Circle Szn', desc: 'draw using ONLY circles' },
  { id: 'oneline', emoji: '〰️', title: 'One-Line Wonder', desc: 'draw without lifting the brush — one stroke only!' },
  { id: 'mirror', emoji: '🪞', title: 'Mirror Mode', desc: 'your brush is horizontally flipped. good luck lol' },
  { id: 'speedrun', emoji: '⚡', title: 'Speedrun', desc: 'finish your drawing in the first 20 seconds, then hands off!' }
];

function dailyChallenge(date = new Date()) {
  const dayKey = Math.floor(date.getTime() / 86400000); // days since epoch (UTC)
  return CHALLENGES[dayKey % CHALLENGES.length];
}

module.exports = { POWERUPS, CHALLENGES, dailyChallenge };
