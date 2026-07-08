// parser.js — turns raw player input into a structured command:
//   { verb, noun, prep, noun2, raw }
// e.g. "use rusty key on cellar door" -> { verb: 'use', noun: 'rusty key', prep: 'on', noun2: 'cellar door' }

const ARTICLES = new Set(['a', 'an', 'the', 'some', 'my']);

export const DIRECTIONS = {
  north: 'north', n: 'north',
  south: 'south', s: 'south',
  east: 'east', e: 'east',
  west: 'west', w: 'west',
  northeast: 'northeast', ne: 'northeast',
  northwest: 'northwest', nw: 'northwest',
  southeast: 'southeast', se: 'southeast',
  southwest: 'southwest', sw: 'southwest',
  up: 'up', u: 'up',
  down: 'down', d: 'down',
  in: 'in', inside: 'in',
  out: 'out', outside: 'out',
};

const PREPOSITIONS = new Set([
  'on', 'onto', 'with', 'to', 'at', 'in', 'into', 'from', 'about', 'using', 'under', 'behind',
]);

// Canonical verb -> synonyms the player may type.
export const VERB_SYNONYMS = {
  look: ['look', 'l'],
  examine: ['examine', 'x', 'inspect', 'check'],
  go: ['go', 'walk', 'run', 'travel', 'head', 'enter', 'exit'],
  take: ['take', 'get', 'grab', 'pick'],
  drop: ['drop', 'discard'],
  inventory: ['inventory', 'i', 'inv'],
  use: ['use'],
  open: ['open'],
  close: ['close', 'shut'],
  talk: ['talk', 'speak', 'greet'],
  give: ['give', 'offer', 'hand'],
  read: ['read'],
  search: ['search', 'rummage'],
  push: ['push', 'press', 'shove'],
  pull: ['pull', 'drag'],
  climb: ['climb'],
  wait: ['wait', 'z'],
  help: ['help', '?', 'commands'],
  score: ['score'],
  quests: ['quests', 'quest', 'journal', 'j', 'tasks'],
  save: ['save'],
  load: ['load', 'restore'],
  restart: ['restart'],
  quit: ['quit', 'q'],
};

// Builds a Map of every accepted word -> canonical verb, merging in custom verbs.
export function buildVerbLookup(customVerbs = new Map()) {
  const lookup = new Map();
  for (const [canonical, synonyms] of Object.entries(VERB_SYNONYMS)) {
    for (const s of synonyms) lookup.set(s, canonical);
  }
  for (const [name, def] of customVerbs) {
    lookup.set(name, name);
    for (const alias of def.aliases || []) lookup.set(alias, name);
  }
  return lookup;
}

export function parse(raw, verbLookup) {
  const words = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s'-]/g, '')
    .split(/\s+/)
    .filter((w) => w && !ARTICLES.has(w));

  if (!words.length) return null;

  // A bare direction ("north", "n", "in") means "go <direction>".
  if (words.length === 1 && DIRECTIONS[words[0]]) {
    return { verb: 'go', noun: DIRECTIONS[words[0]], prep: null, noun2: '', raw };
  }

  let verb = verbLookup.get(words[0]);
  if (!verb) return { verb: null, noun: '', prep: null, noun2: '', raw, unknown: words[0] };

  let rest = words.slice(1);

  // "enter"/"exit" used bare act as directions.
  if ((words[0] === 'enter' || words[0] === 'exit') && rest.length === 0) {
    return { verb: 'go', noun: DIRECTIONS[words[0]], prep: null, noun2: '', raw };
  }

  // "go north" / "walk n"
  if (verb === 'go' && rest.length && DIRECTIONS[rest[0]]) {
    return { verb: 'go', noun: DIRECTIONS[rest[0]], prep: null, noun2: '', raw };
  }

  // Phrasal verbs: "pick up rope", "put down lamp", "look at chest"
  if (verb === 'take' && rest[0] === 'up') rest = rest.slice(1);
  if (verb === 'drop' && rest[0] === 'down') rest = rest.slice(1);
  if (verb === 'look' && rest[0] === 'at') { verb = 'examine'; rest = rest.slice(1); }
  if (verb === 'look' && rest.length && rest[0] !== 'at') verb = 'examine';

  // Split remaining words on the first preposition: "<noun> <prep> <noun2>"
  let prep = null;
  const noun = [];
  const noun2 = [];
  let target = noun;
  for (const w of rest) {
    if (!prep && PREPOSITIONS.has(w)) {
      prep = w;
      target = noun2;
      continue;
    }
    target.push(w);
  }

  return { verb, noun: noun.join(' '), prep, noun2: noun2.join(' '), raw };
}
