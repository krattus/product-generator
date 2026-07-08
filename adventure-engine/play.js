#!/usr/bin/env node
// play.js — terminal player for adventure-engine games.
//
//   node play.js                          # plays games/crystal-crown
//   node play.js ./games/my-game/game.js  # plays your own adventure

import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const COLORS = {
  title: '\x1b[1;33m',
  'room-name': '\x1b[1;36m',
  text: '\x1b[0m',
  exits: '\x1b[32m',
  error: '\x1b[31m',
  system: '\x1b[2m',
  dialogue: '\x1b[37m',
  choice: '\x1b[33m',
  quest: '\x1b[35m',
  score: '\x1b[32m',
  death: '\x1b[1;31m',
  win: '\x1b[1;32m',
};
const RESET = '\x1b[0m';

function wrap(text, width = 78) {
  return text
    .split('\n')
    .map((line) => {
      const words = line.split(' ');
      const out = [];
      let cur = '';
      for (const w of words) {
        if (cur && (cur + ' ' + w).length > width) { out.push(cur); cur = w; }
        else cur = cur ? `${cur} ${w}` : w;
      }
      if (cur) out.push(cur);
      return out.join('\n');
    })
    .join('\n');
}

const gamePath = process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), 'games/crystal-crown/game.js');
const module_ = await import(pathToFileURL(path.resolve(gamePath)).href);
const game = module_.game || module_.default;
if (!game) {
  console.error(`${gamePath} must export a Game instance as "game" (or default).`);
  process.exit(1);
}

const saveFile = path.resolve(
  `${game.config.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.save.json`,
);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

game.start({
  print(text, style = 'text') {
    const color = COLORS[style] || COLORS.text;
    console.log(`${color}${wrap(String(text))}${RESET}`);
    if (style === 'room-name') console.log('');
  },
  save(json) {
    fs.writeFileSync(saveFile, json);
  },
  load() {
    try { return fs.readFileSync(saveFile, 'utf8'); } catch { return null; }
  },
  onQuit() {
    console.log('\nFarewell, adventurer.');
    rl.close();
    process.exit(0);
  },
});

function prompt() {
  rl.question('\n> ', (answer) => {
    console.log('');
    game.command(answer);
    prompt();
  });
}
prompt();
