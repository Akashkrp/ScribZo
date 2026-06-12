// ============ SCRIBZO chat/name filter ============
// Lightweight profanity masking with basic leetspeak normalization.
// Not exhaustive — extend BAD as your audience grows.

const BAD = [
  'fuck', 'shit', 'bitch', 'asshole', 'dick', 'pussy', 'cunt', 'bastard',
  'slut', 'whore', 'fag', 'faggot', 'nigger', 'nigga', 'retard', 'rapist',
  'nazi', 'cock', 'wank', 'twat', 'hoe',
  // hindi/hinglish
  'chutiya', 'chutiye', 'bhosdi', 'bhosdike', 'madarchod', 'behenchod',
  'bhenchod', 'lund', 'gandu', 'gaand', 'randi', 'harami', 'kamina'
];

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

function normalize(word) {
  return word
    .toLowerCase()
    .split('')
    .map(ch => LEET[ch] || ch)
    .join('')
    .replace(/[^a-z]/g, '');
}

function isBad(word) {
  const n = normalize(word);
  if (!n) return false;
  return BAD.some(b => n === b || (b.length >= 4 && n.includes(b)));
}

// masks bad words: "what the f***"
function clean(text) {
  return String(text)
    .split(/(\s+)/)
    .map(part => {
      if (!/\S/.test(part)) return part;
      if (!isBad(part)) return part;
      return part[0] + '*'.repeat(Math.max(2, part.length - 1));
    })
    .join('');
}

module.exports = { clean, isBad };
