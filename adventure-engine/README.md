# adventure-engine

A zero-dependency JavaScript framework for crafting **King's Quest / Space Quest**
style adventure games — typed commands, explorable rooms, items, NPCs with
branching dialogue, quests, scoring, glorious Sierra-style deaths, and save/restore.

A complete example game, **The Crystal Crown**, ships with the engine and is the
best reference for every feature: [`games/crystal-crown/game.js`](games/crystal-crown/game.js).

## Playing

**In the browser** (recommended) — serve this folder and open `index.html`:

```bash
cd adventure-engine
python3 -m http.server 8000     # or: npx serve
# open http://localhost:8000/
```

**In the terminal:**

```bash
node adventure-engine/play.js                          # plays The Crystal Crown
node adventure-engine/play.js path/to/your/game.js     # plays your adventure
```

Typical commands: `north/south/east/west/up/down/in/out`, `look`, `examine <thing>`,
`take/drop <item>`, `inventory`, `open/close <thing>`, `use <item> on <thing>`,
`talk to <person>`, `give <item> to <person>`, `read`, `search`, `quests`, `score`,
`save`, `restore`, `restart`, `help`.

## Crafting your own adventure

Create a file that builds and exports a `Game`, then point `play.js` or
`index.html` at it:

```js
import { Game } from '../../src/index.js';

export const game = new Game({
  title: 'MY QUEST',
  byline: 'An adventure by Me',
  intro: 'Long ago, in a kingdom of...',
  startRoom: 'meadow',
  maxScore: 100,
});
```

Everything below is authored with four registration calls — `game.room()`,
`game.item()`, `game.character()`, `game.quest()` — plus optional custom verbs,
events and daemons. Every callback receives a `ctx` object (API reference at the
bottom).

### Rooms

```js
game.room('meadow', {
  name: 'Sunny Meadow',
  description: 'Wildflowers nod in the breeze...',   // string or (ctx) => string
  exits: {
    north: 'castle',                                  // simple exit
    east: {                                           // conditional exit
      to: 'cave',
      condition: (ctx) => ctx.hasFlag('troll-paid'),
      blockedMessage: 'The troll bars your way.',
    },
    down: {                                           // locked exit
      to: 'cellar',
      locked: true,                                   // open with ctx.unlockExit('meadow', 'down')
      lockedMessage: 'The trapdoor is bolted shut.',
    },
  },
  dark: true,                        // needs an item with light: true to see
  onEnter(ctx, { firstVisit }) {},   // runs before the room is described (good place for traps)
  onExit(ctx, { direction }) {},
  onLook(ctx) {},                    // runs after the room is described
});
```

### Items

```js
game.item('lantern', {
  name: 'brass lantern',
  aliases: ['lamp', 'light'],        // extra words the player may type
  article: 'a',                      // 'a'/'an' auto-detected; use 'some', '' etc. to override
  location: 'meadow',                // roomId | 'inventory' | 'nowhere' | a container's itemId
  description: 'A sturdy lantern.',  // string or (ctx) => string
  light: true,                       // lights up dark rooms while carried/visible

  scenery: true,                     // not listed, can't be taken (fountains, doors...)
  fixed: true,                       // listed but too heavy/attached to take
  fixedMessage: 'Far too heavy.',

  container: true, open: false,      // openable container; items with location: <this id>
  locked: true,                      // are revealed when opened
  lockedMessage: 'It needs a key.',  // unlock with ctx.setItemState(id, { locked: false })

  text: 'Property of Odo.',          // shown for "read lantern"

  onTake(ctx) {}, onDrop(ctx) {}, onExamine(ctx) {},   // replace defaults (return false to
  onUse(ctx) {},                                       // fall through to the default)
  useOn: {                           // "use lantern on X" — keys are target entity ids
    'cave-door': (ctx, target) => { ctx.unlockExit('cliff', 'in'); },
    '*': 'That accomplishes nothing.',                 // strings are simply printed
  },
  verbs: {                           // any other verb: push, pull, climb, eat, kiss...
    rub: (ctx) => ctx.print('A genie fails to appear.'),
    eat: 'It tastes of brass.',
  },
});
```

### Characters & dialogue

```js
game.character('wizard', {
  name: 'Crespo the Wizard',
  aliases: ['wizard', 'crespo'],
  location: 'tower',
  presence: 'Crespo the Wizard stirs a cauldron here.',  // line shown in the room
  description: 'Tall hat, longer beard.',
  dialogue: {
    start: 'root',
    nodes: {
      root: {
        text: (ctx) => ctx.hasFlag('met-wizard') ? 'You again!' : 'Who disturbs me?',
        effect: (ctx) => ctx.setFlag('met-wizard'),
        choices: [
          { text: 'I need a spell.', next: 'spell' },
          { text: 'Sorry, wrong tower.', end: true,
            condition: (ctx) => !ctx.questActive('main') },   // choices can be conditional
        ],
      },
      spell: {
        text: 'Bring me a mandrake root and we shall talk.',
        effect: (ctx) => ctx.startQuest('mandrake'),
        end: true,                    // or: next: 'root', or choices: [...]
      },
    },
  },
  onGive: {                           // "give X to wizard" — keys are item ids
    'mandrake-root': (ctx, item) => { ctx.destroyItem(item.id); ctx.giveItem('spell-scroll'); },
    '*': '"I have no use for that."',
  },
  onTalk(ctx) {},                     // alternative to dialogue: full manual control
});
```

Dialogue presents numbered choices; the player types `1`, `2`, ... or `0`/`bye`
to leave. Move NPCs around with `ctx.moveCharacter('wizard', 'meadow')`.

### Quests

```js
game.quest('mandrake', {
  name: 'The Mandrake Root',
  description: 'Find a mandrake root for Crespo.',
  objectives: [
    { id: 'find', text: 'Find a mandrake root' },
    { id: 'deliver', text: 'Bring it to Crespo' },
    { id: 'secret', text: 'Discover the truth', hidden: true },   // shown once completed
    { id: 'bonus', text: 'Keep a cutting', optional: true },      // not required to finish
  ],
  reward: { score: 10 },              // awarded automatically on completion
  onStart(ctx) {},
  onObjective(ctx, objectiveId) {},
  onComplete(ctx) {},                 // fires when all non-optional objectives are done
  autoComplete: false,                // set to finish only via ctx.completeQuest()
  hidden: true,                       // internal quest: no journal entry, no announcements
});
```

Drive quests from anywhere: `ctx.startQuest('mandrake')`,
`ctx.completeObjective('mandrake', 'find')`. The player views progress with
`quests` / `journal`.

### Custom verbs, events, daemons

```js
game.verb('cast', {
  aliases: ['invoke'],
  help: 'cast <spell> — for the magically inclined',
  handler(ctx, cmd) {                 // cmd = { verb, noun, prep, noun2, raw }
    if (cmd.noun === 'fireball') ctx.print('Whoosh!');
    else return false;                // fall through to "You can't do that here."
  },
});

game.on('take', (ctx, { item }) => {            // 'take', 'drop', 'give', 'open', 'use',
  if (item.id === 'crown') ctx.addScore(20);    // 'room:enter', 'quest:start',
});                                             // 'quest:objective', 'quest:complete',
                                                // 'score', 'death', 'win'

game.daemon((ctx) => {                // runs after every turn-consuming command
  if (ctx.currentRoom() === 'swamp' && ctx.state.turns % 3 === 0) {
    ctx.print('Something large moves beneath the water...', 'system');
  }
});
```

### Deaths, victory, scoring

```js
ctx.die('You really should not have licked the altar.');   // Sierra would be proud
ctx.win('The kingdom rejoices!');
ctx.addScore(10, 'solved-riddle');    // the key prevents awarding twice
```

After death the player may `restart` or `restore`.

## ctx API reference

| Category | Methods |
|---|---|
| Output | `print(text, style?)` — styles: `text`, `system`, `error`, `quest`, `dialogue`... |
| Flags | `setFlag(f, v?)`, `hasFlag(f)`, `getFlag(f)`, `clearFlag(f)` |
| Items | `has(id)`, `giveItem(id)`, `destroyItem(id)`, `moveItem(id, loc)`, `itemAt(id)`, `setItemState(id, patch)`, `itemState(id)` |
| Characters | `moveCharacter(id, roomId)`, `characterAt(id)` |
| World | `currentRoom()`, `goTo(roomId)`, `unlockExit(roomId, dir)`, `lockExit(roomId, dir)`, `hasLight()`, `look()` |
| Quests | `startQuest(id)`, `completeObjective(qid, oid)`, `completeQuest(id)`, `questStatus(id)`, `questActive(id)`, `objectiveDone(qid, oid)` |
| Score & fate | `addScore(points, onceKey?)`, `die(msg)`, `win(msg)` |
| Misc | `once(key, fn?)` — run something only once, ever; `startDialogue(charId)`; `state`, `game` |

## Project layout

```
adventure-engine/
├── index.html                  # browser player (edit the import to swap games)
├── play.js                     # terminal player
├── src/
│   ├── engine.js               # Game class: world, verbs, quests, save/load
│   ├── parser.js               # text parser ("use key on door")
│   ├── dialogue.js             # branching conversations
│   ├── entities.js             # Room / Item / Character / Quest
│   └── index.js
├── ui/
│   ├── browser-ui.js           # createBrowserUI(game, element)
│   └── style.css               # retro Sierra look
└── games/
    └── crystal-crown/game.js   # complete example adventure
```

The engine is UI-agnostic: `game.start(io)` takes any `io` object with
`print(text, style)` and optional `save(json)` / `load() -> json` / `onQuit()`,
so you can embed it anywhere — a web page, a terminal, a Discord bot.
