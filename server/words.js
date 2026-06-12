// ============ SCRIBZO topic word banks ============
// "AI word generator" — topic-aware word pools with light combinatorial remixing
// so rooms rarely see the same words twice. Runs fully offline.

const TOPICS = {
  classic: [
    'pizza', 'rainbow', 'volcano', 'castle', 'pirate', 'wizard', 'dragon', 'robot',
    'guitar', 'penguin', 'octopus', 'giraffe', 'pancake', 'firework', 'campfire',
    'lighthouse', 'tornado', 'mermaid', 'skateboard', 'roller coaster', 'haunted house',
    'time machine', 'treasure hunt', 'pillow fight', 'air guitar', 'brain freeze',
    'umbrella', 'snowman', 'beehive', 'cactus', 'jellyfish', 'windmill', 'telescope'
  ],
  anime: [
    'kamehameha', 'shadow clone', 'titan wall', 'death note', 'sharingan', 'super saiyan',
    'pokeball', 'pikachu', 'totoro', 'spirited away', 'one piece', 'straw hat',
    'demon slayer', 'water breathing', 'rasengan', 'chidori', 'gear five', 'bankai',
    'sailor moon', 'dragon ball', 'mecha robot', 'magical girl', 'sensei', 'ramen bowl',
    'cherry blossom', 'katana', 'ninja village', 'anime protagonist hair', 'plot armor',
    'tournament arc', 'beach episode', 'power of friendship'
  ],
  movies: [
    'titanic', 'jurassic park', 'star wars', 'lightsaber', 'avengers', 'infinity gauntlet',
    'batman', 'joker', 'spiderman', 'harry potter', 'golden snitch', 'lord of the rings',
    'minions', 'frozen', 'toy story', 'shrek', 'godzilla', 'king kong', 'terminator',
    'matrix', 'red pill', 'inception', 'interstellar', 'black hole', 'wakanda',
    'jaws', 'ghostbusters', 'transformers', 'avatar', 'pirates of the caribbean',
    'movie theater popcorn', 'plot twist', 'post credit scene'
  ],
  engineering: [
    'suspension bridge', 'gear', 'circuit board', 'robot arm', 'blueprint', 'crane',
    'rocket launch', 'satellite', 'wind turbine', 'solar panel', 'dam', 'tunnel',
    'screwdriver', 'wrench', 'bulldozer', 'excavator', 'microchip', 'soldering iron',
    '3d printer', 'drone', 'jet engine', 'piston', 'conveyor belt', 'transformer',
    'skyscraper', 'elevator', 'escalator', 'hydraulic press', 'lab coat', 'safety helmet',
    'all nighter before deadline', 'duct tape fix'
  ],
  startups: [
    'unicorn startup', 'pitch deck', 'angel investor', 'burn rate', 'hockey stick growth',
    'garage office', 'ramen profitable', 'venture capital', 'ipo bell', 'stock chart',
    'hustle culture', 'standing desk', 'ping pong office', 'whiteboard brainstorm',
    'mvp launch', 'pivot', 'crypto crash', 'app store', 'food delivery app', 'cab booking app',
    'coworking space', 'networking event', 'elevator pitch', 'series a funding',
    'startup founder hoodie', 'work from home', 'zoom meeting', 'linkedin influencer',
    'side hustle', 'product launch rocket'
  ],
  cricket: [
    'cover drive', 'helicopter shot', 'googly', 'yorker', 'hat trick', 'third umpire',
    'drs review', 'silly point', 'wicketkeeper', 'leg spin', 'reverse sweep', 'free hit',
    'super over', 'world cup trophy', 'ipl auction', 'cheerleader', 'stadium wave',
    'rain delay', 'duckworth lewis', 'golden duck', 'sixer', 'boundary rope',
    'cricket bat', 'stumps flying', 'slip catch', 'pitch report', 'night match floodlights',
    'commentary box', 'scoreboard', 'last ball thriller'
  ],
  memes: [
    'rickroll', 'doge', 'stonks', 'this is fine dog', 'distracted boyfriend',
    'galaxy brain', 'crying cat', 'sus imposter', 'touch grass', 'no cap',
    'side eye', 'skull emoji moment', 'npc behavior', 'main character energy',
    'gigachad', 'shrek wazowski', 'sigma grindset', 'monke flip', 'vibe check',
    'caught in 4k', 'ratio', 'down bad', 'goblin mode', 'it is wednesday my dudes',
    'surprised pikachu', 'sad hamster', 'screaming cat at table', 'dancing coffin',
    'keyboard warrior', 'wifi goes down'
  ]
};

// light remix layer — prefixes/suffixes that still make drawable prompts
const REMIX = {
  anime: ['angry ', 'chibi ', 'giant '],
  movies: ['lego ', 'zombie ', 'baby '],
  memes: ['cursed ', 'ultra ', 'tiny '],
  classic: ['flying ', 'giant ', 'tiny '],
  engineering: ['broken ', 'giant '],
  startups: ['failed ', 'viral '],
  cricket: ['slow motion ', 'dramatic ']
};

function topicList() {
  return Object.keys(TOPICS);
}

function getRandomWords(count = 3, exclude = new Set(), topic = 'mix') {
  let pool;
  if (topic === 'mix' || !TOPICS[topic]) {
    pool = Object.values(TOPICS).flat();
  } else {
    pool = TOPICS[topic].slice();
    // ~20% chance per pick to remix a word for freshness
    const remixes = REMIX[topic] || [];
    if (remixes.length) {
      pool = pool.map(w =>
        Math.random() < 0.2 ? remixes[Math.floor(Math.random() * remixes.length)] + w : w
      );
    }
  }
  pool = pool.filter(w => !exclude.has(w));
  const picked = [];
  const used = new Set();
  while (picked.length < count && used.size < pool.length) {
    const idx = Math.floor(Math.random() * pool.length);
    if (!used.has(idx)) { used.add(idx); picked.push(pool[idx]); }
  }
  return picked;
}

module.exports = { TOPICS, topicList, getRandomWords };
