// engine.js — the core of the adventure framework.
//
// A Game is authored declaratively:
//
//   const game = new Game({ title: 'My Quest', startRoom: 'meadow', maxScore: 100 });
//   game.room('meadow', { name: 'Sunny Meadow', description: '...', exits: { north: 'forest' } });
//   game.item('key', { name: 'rusty key', location: 'meadow' });
//   game.character('wizard', { name: 'Old Wizard', location: 'tower', dialogue: {...} });
//   game.quest('main', { name: 'Save the Kingdom', objectives: [...] });
//   game.start(io);          // io = { print(text, style), save(json), load() -> json, onQuit() }
//   game.command('go north') // feed player input
//
// See README.md for the full authoring guide.

import { parse, buildVerbLookup, DIRECTIONS } from './parser.js';
import { Room, Item, Character, Quest } from './entities.js';
import { startDialogue, dialogueInput } from './dialogue.js';

const SAVE_VERSION = 1;

function joinList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export class Game {
  constructor(config = {}) {
    this.config = {
      title: 'Untitled Adventure',
      byline: '',
      intro: '',
      startRoom: null,
      maxScore: 0,
      ...config,
    };
    this.rooms = new Map();
    this.items = new Map();
    this.characters = new Map();
    this.quests = new Map();
    this.customVerbs = new Map();
    this.listeners = new Map();
    this.daemons = [];
    this.io = { print: () => {} };
    this.state = null;
    this._dialogue = null;
    this._verbLookup = buildVerbLookup();
  }

  /* ------------------------------------------------------------------ */
  /* Authoring API                                                       */
  /* ------------------------------------------------------------------ */

  room(id, def) { this.rooms.set(id, new Room(id, def)); return this; }
  item(id, def) { this.items.set(id, new Item(id, def)); return this; }
  character(id, def) { this.characters.set(id, new Character(id, def)); return this; }
  quest(id, def) { this.quests.set(id, new Quest(id, def)); return this; }

  // game.verb('cast', { aliases: ['invoke'], help: 'cast <spell>', handler(ctx, cmd) {...} })
  verb(name, def) {
    this.customVerbs.set(name, { aliases: [], ...def });
    this._verbLookup = buildVerbLookup(this.customVerbs);
    return this;
  }

  // Events: 'room:enter', 'take', 'drop', 'give', 'open', 'use',
  //         'quest:start', 'quest:objective', 'quest:complete', 'score', 'death', 'win'
  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
    return this;
  }

  // Daemons run after every turn-consuming command: game.daemon((ctx) => {...})
  daemon(fn) { this.daemons.push(fn); return this; }

  emit(event, data = {}) {
    for (const fn of this.listeners.get(event) || []) fn(this.ctx(), data);
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  start(io) {
    if (io) this.io = { ...this.io, ...io };
    if (!this.config.startRoom || !this.rooms.has(this.config.startRoom)) {
      throw new Error(`Game config.startRoom must name an existing room (got "${this.config.startRoom}")`);
    }
    this.state = this._freshState();
    this._dialogue = null;

    this.print(this.config.title, 'title');
    if (this.config.byline) this.print(this.config.byline, 'system');
    if (this.config.intro) this.print(this.config.intro, 'text');
    this.print('(Type "help" for a list of commands.)', 'system');
    this._enterRoom(this.config.startRoom);
  }

  _freshState() {
    const locations = {};
    for (const [id, item] of this.items) locations[id] = item.def.location || 'nowhere';
    const charLocations = {};
    for (const [id, ch] of this.characters) charLocations[id] = ch.def.location || 'nowhere';
    return {
      status: 'playing', // 'playing' | 'dead' | 'won'
      currentRoom: null,
      turns: 0,
      score: 0,
      scored: {},        // keys already awarded (prevents double-scoring)
      once: {},          // keys used by ctx.once()
      flags: {},
      locations,         // itemId -> roomId | 'inventory' | 'nowhere' | containerItemId
      charLocations,     // characterId -> roomId | 'nowhere'
      entityState: {},   // itemId -> { open, locked, ... }
      unlockedExits: {}, // "roomId:direction" -> true
      quests: {},        // questId -> { status, objectives: { objId: true } }
      visited: {},       // roomId -> true
    };
  }

  print(text, style = 'text') { this.io.print(text, style); }

  /* ------------------------------------------------------------------ */
  /* The ctx object — handed to every author-supplied callback           */
  /* ------------------------------------------------------------------ */

  ctx() {
    const game = this;
    const state = this.state;
    return {
      game,
      state,
      print: (msg, style = 'text') => game.print(msg, style),

      // flags
      setFlag: (f, v = true) => { state.flags[f] = v; },
      hasFlag: (f) => !!state.flags[f],
      getFlag: (f) => state.flags[f],
      clearFlag: (f) => { delete state.flags[f]; },

      // items
      has: (id) => state.locations[id] === 'inventory',
      giveItem: (id) => { state.locations[id] = 'inventory'; },
      destroyItem: (id) => { state.locations[id] = 'nowhere'; },
      moveItem: (id, loc) => { state.locations[id] = loc; },
      itemAt: (id) => state.locations[id],
      setItemState: (id, patch) => {
        state.entityState[id] = { ...state.entityState[id], ...patch };
      },
      itemState: (id) => state.entityState[id] || {},

      // characters
      moveCharacter: (id, roomId) => { state.charLocations[id] = roomId; },
      characterAt: (id) => state.charLocations[id],

      // movement & world
      currentRoom: () => state.currentRoom,
      goTo: (roomId) => game._enterRoom(roomId),
      unlockExit: (roomId, dir) => { state.unlockedExits[`${roomId}:${dir}`] = true; },
      lockExit: (roomId, dir) => { delete state.unlockedExits[`${roomId}:${dir}`]; },
      hasLight: () => game.hasLight(),
      look: () => game.lookAround(),

      // score & quests
      addScore: (pts, key) => game.addScore(pts, key),
      startQuest: (id) => game.startQuest(id),
      completeObjective: (qid, oid) => game.completeObjective(qid, oid),
      completeQuest: (id) => game.completeQuest(id),
      questStatus: (id) => state.quests[id]?.status || 'inactive',
      questActive: (id) => state.quests[id]?.status === 'active',
      objectiveDone: (qid, oid) => !!state.quests[qid]?.objectives[oid],

      // fate
      die: (msg) => game.die(msg),
      win: (msg) => game.win(msg),

      // misc
      once: (key, fn) => {
        if (state.once[key]) return false;
        state.once[key] = true;
        if (fn) fn();
        return true;
      },
      startDialogue: (charId) => startDialogue(game, game.characters.get(charId)),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Input handling                                                      */
  /* ------------------------------------------------------------------ */

  command(raw) {
    if (!this.state) throw new Error('Call game.start(io) before feeding commands.');
    if (!raw || !raw.trim()) return;

    if (this.state.status !== 'playing') {
      this._afterGameCommand(raw);
      return;
    }

    if (this._dialogue) {
      dialogueInput(this, raw);
      return;
    }

    const cmd = parse(raw, this._verbLookup);
    if (!cmd) return;
    if (!cmd.verb) {
      this.print(`I don't know the word "${cmd.unknown}".`, 'error');
      return;
    }

    const consumesTurn = this._dispatch(cmd);
    if (consumesTurn !== false && this.state.status === 'playing') {
      this.state.turns += 1;
      for (const d of this.daemons) {
        if (this.state.status !== 'playing') break;
        d(this.ctx());
      }
    }
  }

  // After death or victory only meta commands are accepted.
  _afterGameCommand(raw) {
    const word = raw.trim().toLowerCase().split(/\s+/)[0];
    if (word === 'restart') { this.start(); return; }
    if (word === 'restore' || word === 'load') { this.loadGame(); return; }
    if (word === 'score') { this.showScore(); return; }
    if (word === 'quit' || word === 'q') { this._quit(); return; }
    const hint = this.state.status === 'dead'
      ? 'You are dead. Type RESTART to try again, RESTORE to load a saved game, or QUIT.'
      : 'The story is over. Type RESTART to play again, or QUIT.';
    this.print(hint, 'system');
  }

  // Returns false for "free" meta commands that shouldn't consume a turn.
  _dispatch(cmd) {
    const { verb } = cmd;

    // Custom verbs take priority — authors may even override built-ins.
    if (this.customVerbs.has(verb)) {
      const result = this.customVerbs.get(verb).handler(this.ctx(), cmd);
      if (result !== false) return true;
    }

    // Per-entity verb overrides: item/character defs may carry
    //   verbs: { push: (ctx, cmd) => {...} | 'Just a string to print.' }
    const overridable = !['go', 'inventory', 'look', 'help', 'score', 'quests', 'save', 'load', 'restart', 'quit', 'wait'].includes(verb);
    if (overridable && cmd.noun) {
      const entity = this.findVisible(cmd.noun);
      const override = entity?.def.verbs?.[verb];
      if (override !== undefined) {
        if (typeof override === 'string') { this.print(override); return true; }
        const result = override(this.ctx(), cmd);
        if (result !== false) return true;
      }
    }

    switch (verb) {
      case 'go': return this._doGo(cmd);
      case 'look':
        if (cmd.noun || cmd.noun2) return this._doExamine(cmd);
        this.lookAround();
        return true;
      case 'examine': return this._doExamine(cmd);
      case 'take': return this._doTake(cmd);
      case 'drop': return this._doDrop(cmd);
      case 'inventory': this.showInventory(); return false;
      case 'use': return this._doUse(cmd);
      case 'open': return this._doOpen(cmd);
      case 'close': return this._doClose(cmd);
      case 'talk': return this._doTalk(cmd);
      case 'give': return this._doGive(cmd);
      case 'read': return this._doRead(cmd);
      case 'search': return this._doSearch(cmd);
      case 'push': case 'pull': case 'climb':
        return this._doDefaultAction(cmd);
      case 'wait': this.print('Time passes.'); return true;
      case 'help': this.showHelp(); return false;
      case 'score': this.showScore(); return false;
      case 'quests': this.showQuests(); return false;
      case 'save': this.saveGame(); return false;
      case 'load': this.loadGame(); return false;
      case 'restart': this.start(); return false;
      case 'quit': this._quit(); return false;
      default:
        this.print("You can't do that here.", 'error');
        return false;
    }
  }

  _quit() {
    if (this.io.onQuit) this.io.onQuit();
    else this.print('(There is no quitting here — just close the window, or type RESTART.)', 'system');
  }

  /* ------------------------------------------------------------------ */
  /* World queries                                                       */
  /* ------------------------------------------------------------------ */

  currentRoom() { return this.rooms.get(this.state.currentRoom); }

  isOpen(item) {
    const runtime = this.state.entityState[item.id];
    if (runtime && 'open' in runtime) return !!runtime.open;
    return !!item.def.open;
  }

  isLocked(item) {
    const runtime = this.state.entityState[item.id];
    if (runtime && 'locked' in runtime) return !!runtime.locked;
    return !!item.def.locked;
  }

  isItemVisible(item) {
    const loc = this.state.locations[item.id];
    if (loc === 'inventory') return true;
    if (loc === this.state.currentRoom) return true;
    if (this.items.has(loc)) {
      const container = this.items.get(loc);
      return this.isOpen(container) && this.isItemVisible(container);
    }
    return false;
  }

  itemsIn(containerId) {
    return [...this.items.values()].filter((i) => this.state.locations[i.id] === containerId);
  }

  charactersHere() {
    return [...this.characters.values()].filter(
      (c) => this.state.charLocations[c.id] === this.state.currentRoom,
    );
  }

  hasLight() {
    return [...this.items.values()].some(
      (i) => i.def.light && this.isItemVisible(i) && !(this.state.entityState[i.id]?.lightOff),
    );
  }

  // Finds the item or character the player's phrase refers to, among
  // everything currently visible (inventory, room, open containers, NPCs).
  findVisible(phrase) {
    if (!phrase) return null;
    for (const item of this.items.values()) {
      if (this.isItemVisible(item) && item.matches(phrase)) return item;
    }
    for (const ch of this.charactersHere()) {
      if (ch.matches(phrase)) return ch;
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Room display                                                        */
  /* ------------------------------------------------------------------ */

  _enterRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Unknown room "${roomId}"`);
    this.state.currentRoom = roomId;
    const firstVisit = !this.state.visited[roomId];
    this.state.visited[roomId] = true;

    if (room.def.onEnter) room.def.onEnter(this.ctx(), { firstVisit });
    if (this.state.status !== 'playing') return;

    this.emit('room:enter', { room, firstVisit });
    if (this.state.status !== 'playing') return;

    this.lookAround();
  }

  lookAround() {
    const room = this.currentRoom();

    if (room.def.dark && !this.hasLight()) {
      this.print('Darkness', 'room-name');
      this.print('It is pitch black. You cannot see a thing.', 'text');
      return;
    }

    this.print(room.name, 'room-name');
    const desc = typeof room.def.description === 'function'
      ? room.def.description(this.ctx())
      : room.def.description;
    if (desc) this.print(desc, 'text');

    const items = [...this.items.values()].filter(
      (i) => this.state.locations[i.id] === room.id && !i.def.scenery,
    );
    if (items.length) {
      this.print(`You see ${joinList(items.map((i) => this._itemLine(i)))} here.`, 'text');
    }

    for (const ch of this.charactersHere()) {
      this.print(ch.def.presence || `${ch.name} is here.`, 'text');
    }

    const exits = Object.entries(room.def.exits || {})
      .filter(([, exit]) => !(typeof exit === 'object' && exit.hidden))
      .map(([dir]) => dir);
    if (exits.length) this.print(`Obvious exits: ${exits.join(', ')}.`, 'exits');

    if (room.def.onLook) room.def.onLook(this.ctx());
  }

  _itemLine(item) {
    let line = item.listName;
    if (item.def.container) {
      if (!this.isOpen(item)) {
        line += ' (closed)';
      } else {
        const contents = this.itemsIn(item.id);
        line += contents.length
          ? ` (open, containing ${joinList(contents.map((c) => c.listName))})`
          : ' (open, empty)';
      }
    }
    return line;
  }

  /* ------------------------------------------------------------------ */
  /* Verb handlers                                                       */
  /* ------------------------------------------------------------------ */

  _doGo(cmd) {
    const dir = DIRECTIONS[cmd.noun] || DIRECTIONS[cmd.noun2];
    if (!dir) { this.print('Go which direction?', 'error'); return false; }

    const room = this.currentRoom();
    let exit = (room.def.exits || {})[dir];
    if (!exit) { this.print("You can't go that way.", 'error'); return false; }
    if (typeof exit === 'string') exit = { to: exit };

    const ctx = this.ctx();
    if (exit.condition && !exit.condition(ctx)) {
      this.print(exit.blockedMessage || 'Something prevents you from going that way.', 'text');
      return true;
    }
    if (exit.locked && !this.state.unlockedExits[`${room.id}:${dir}`]) {
      this.print(exit.lockedMessage || "It's locked.", 'text');
      return true;
    }
    if (exit.onPass) exit.onPass(ctx);
    if (this.state.status !== 'playing') return true;

    if (room.def.onExit) room.def.onExit(ctx, { direction: dir });
    if (this.state.status !== 'playing') return true;

    this._enterRoom(exit.to);
    return true;
  }

  _doExamine(cmd) {
    const phrase = cmd.noun || cmd.noun2;
    if (!phrase) { this.lookAround(); return true; }
    const entity = this.findVisible(phrase);
    if (!entity) { this.print("You don't see that here.", 'error'); return false; }

    if (entity.def.onExamine) {
      const result = entity.def.onExamine(this.ctx());
      if (result !== false) return true;
    }
    const desc = typeof entity.def.description === 'function'
      ? entity.def.description(this.ctx())
      : entity.def.description;
    this.print(desc || `You see nothing special about the ${entity.name}.`, 'text');

    if (entity.def.container) {
      if (!this.isOpen(entity)) {
        this.print(`The ${entity.name} is closed.`, 'text');
      } else {
        const contents = this.itemsIn(entity.id);
        this.print(
          contents.length
            ? `Inside you see ${joinList(contents.map((c) => c.listName))}.`
            : `The ${entity.name} is empty.`,
          'text',
        );
      }
    }
    return true;
  }

  _doTake(cmd) {
    if (!cmd.noun) { this.print('Take what?', 'error'); return false; }
    const entity = this.findVisible(cmd.noun);
    if (!entity) { this.print("You don't see that here.", 'error'); return false; }
    if (entity instanceof Character) {
      this.print(`${entity.name} would object to that.`, 'text');
      return true;
    }
    if (this.state.locations[entity.id] === 'inventory') {
      this.print('You already have it.', 'text');
      return false;
    }
    if (entity.def.onTake) {
      const result = entity.def.onTake(this.ctx());
      if (result !== false) return true;
    }
    if (entity.def.scenery || entity.def.fixed) {
      this.print(entity.def.fixedMessage || "You can't take that.", 'text');
      return true;
    }
    this.state.locations[entity.id] = 'inventory';
    this.print(`You take the ${entity.name}.`, 'text');
    this.emit('take', { item: entity });
    return true;
  }

  _doDrop(cmd) {
    if (!cmd.noun) { this.print('Drop what?', 'error'); return false; }
    const item = [...this.items.values()].find(
      (i) => this.state.locations[i.id] === 'inventory' && i.matches(cmd.noun),
    );
    if (!item) { this.print("You aren't carrying that.", 'error'); return false; }
    if (item.def.onDrop) {
      const result = item.def.onDrop(this.ctx());
      if (result !== false) return true;
    }
    this.state.locations[item.id] = this.state.currentRoom;
    this.print(`You drop the ${item.name}.`, 'text');
    this.emit('drop', { item });
    return true;
  }

  _doUse(cmd) {
    if (!cmd.noun) { this.print('Use what?', 'error'); return false; }
    const item = this.findVisible(cmd.noun);
    if (!item) { this.print("You don't see that here.", 'error'); return false; }
    const ctx = this.ctx();

    if (cmd.noun2) {
      const target = this.findVisible(cmd.noun2);
      if (!target) { this.print("You don't see that here.", 'error'); return false; }
      const handler = item.def.useOn?.[target.id] ?? item.def.useOn?.['*'];
      if (handler !== undefined) {
        if (typeof handler === 'string') { this.print(handler); return true; }
        const result = handler(ctx, target);
        if (result !== false) { this.emit('use', { item, target }); return true; }
      }
      this.print("That doesn't seem to work.", 'text');
      return true;
    }

    if (item.def.onUse) {
      const result = item.def.onUse(ctx);
      if (result !== false) { this.emit('use', { item }); return true; }
    }
    this.print(`You can't figure out how to use the ${item.name} here. Maybe try "use ${item.name} on <something>".`, 'text');
    return true;
  }

  _doOpen(cmd) {
    if (!cmd.noun) { this.print('Open what?', 'error'); return false; }
    const item = this.findVisible(cmd.noun);
    if (!item) { this.print("You don't see that here.", 'error'); return false; }
    if (!item.def.container) { this.print("You can't open that.", 'text'); return true; }
    if (this.isOpen(item)) { this.print("It's already open.", 'text'); return true; }
    if (this.isLocked(item)) {
      this.print(item.def.lockedMessage || `The ${item.name} is locked.`, 'text');
      return true;
    }
    this.state.entityState[item.id] = { ...this.state.entityState[item.id], open: true };
    const contents = this.itemsIn(item.id);
    this.print(
      contents.length
        ? `You open the ${item.name}. Inside you see ${joinList(contents.map((c) => c.listName))}.`
        : `You open the ${item.name}. It is empty.`,
      'text',
    );
    this.emit('open', { item });
    return true;
  }

  _doClose(cmd) {
    if (!cmd.noun) { this.print('Close what?', 'error'); return false; }
    const item = this.findVisible(cmd.noun);
    if (!item) { this.print("You don't see that here.", 'error'); return false; }
    if (!item.def.container) { this.print("You can't close that.", 'text'); return true; }
    if (!this.isOpen(item)) { this.print("It's already closed.", 'text'); return true; }
    this.state.entityState[item.id] = { ...this.state.entityState[item.id], open: false };
    this.print(`You close the ${item.name}.`, 'text');
    return true;
  }

  _doTalk(cmd) {
    const phrase = cmd.noun || cmd.noun2;
    if (!phrase) {
      const here = this.charactersHere();
      if (here.length === 1) { startDialogue(this, here[0]); return true; }
      this.print('Talk to whom?', 'error');
      return false;
    }
    const ch = this.charactersHere().find((c) => c.matches(phrase));
    if (!ch) {
      if (this.findVisible(phrase)) { this.print('It has nothing to say.', 'text'); return true; }
      this.print("There's no one here by that name.", 'error');
      return false;
    }
    startDialogue(this, ch);
    return true;
  }

  _doGive(cmd) {
    if (!cmd.noun || !cmd.noun2) { this.print('Give what to whom? Try "give <item> to <person>".', 'error'); return false; }
    const item = [...this.items.values()].find(
      (i) => this.state.locations[i.id] === 'inventory' && i.matches(cmd.noun),
    );
    if (!item) { this.print("You aren't carrying that.", 'error'); return false; }
    const ch = this.charactersHere().find((c) => c.matches(cmd.noun2));
    if (!ch) { this.print("There's no one here by that name.", 'error'); return false; }

    const handler = ch.def.onGive?.[item.id] ?? ch.def.onGive?.['*'];
    if (handler !== undefined) {
      if (typeof handler === 'string') { this.print(handler); return true; }
      const result = handler(this.ctx(), item);
      if (result !== false) { this.emit('give', { item, character: ch }); return true; }
    }
    this.print(`${ch.name} politely declines.`, 'text');
    return true;
  }

  _doRead(cmd) {
    if (!cmd.noun) { this.print('Read what?', 'error'); return false; }
    const item = this.findVisible(cmd.noun);
    if (!item) { this.print("You don't see that here.", 'error'); return false; }
    const text = typeof item.def.text === 'function' ? item.def.text(this.ctx()) : item.def.text;
    this.print(text || `There is nothing written on the ${item.name}.`, 'text');
    return true;
  }

  _doSearch(cmd) {
    if (!cmd.noun) { this.print('Search what?', 'error'); return false; }
    const item = this.findVisible(cmd.noun);
    if (!item) { this.print("You don't see that here.", 'error'); return false; }
    if (item.def.container && this.isOpen(item)) return this._doExamine(cmd);
    this.print('You find nothing of interest.', 'text');
    return true;
  }

  _doDefaultAction(cmd) {
    if (!cmd.noun) { this.print(`${cmd.verb[0].toUpperCase()}${cmd.verb.slice(1)} what?`, 'error'); return false; }
    const entity = this.findVisible(cmd.noun);
    if (!entity) { this.print("You don't see that here.", 'error'); return false; }
    this.print("That doesn't accomplish anything.", 'text');
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Inventory / status displays                                         */
  /* ------------------------------------------------------------------ */

  showInventory() {
    const carried = [...this.items.values()].filter((i) => this.state.locations[i.id] === 'inventory');
    if (!carried.length) { this.print('You are empty-handed.', 'text'); return; }
    this.print(`You are carrying ${joinList(carried.map((i) => i.listName))}.`, 'text');
  }

  showScore() {
    const max = this.config.maxScore ? ` of ${this.config.maxScore}` : '';
    this.print(`Score: ${this.state.score}${max} points, in ${this.state.turns} turns.`, 'score');
  }

  showQuests() {
    const entries = Object.entries(this.state.quests);
    if (!entries.length) { this.print('Your quest journal is empty.', 'text'); return; }
    this.print('QUEST JOURNAL', 'room-name');
    for (const [qid, entry] of entries) {
      const quest = this.quests.get(qid);
      if (!quest || quest.def.hidden) continue;
      const mark = entry.status === 'completed' ? '✔' : entry.status === 'failed' ? '✘' : '◆';
      this.print(`${mark} ${quest.name} (${entry.status})`, 'quest');
      if (entry.status === 'active') {
        for (const obj of quest.def.objectives || []) {
          const done = !!entry.objectives[obj.id];
          if (obj.hidden && !done) continue;
          this.print(`   [${done ? 'x' : ' '}] ${obj.text}`, 'text');
        }
      }
    }
  }

  showHelp() {
    this.print('COMMANDS', 'room-name');
    this.print('Movement:  north, south, east, west, up, down, in, out (or n/s/e/w/u/d)', 'text');
    this.print('World:     look, examine <thing>, open/close <thing>, read <thing>, search <thing>', 'text');
    this.print('Items:     take <item>, drop <item>, inventory (i), use <item> on <thing>', 'text');
    this.print('People:    talk to <person>, give <item> to <person>', 'text');
    this.print('Progress:  quests (journal), score, save, restore, restart, quit', 'text');
    for (const [name, def] of this.customVerbs) {
      if (def.help) this.print(`Special:   ${def.help}`, 'text');
      else this.print(`Special:   ${name}`, 'text');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Score, quests, fate                                                 */
  /* ------------------------------------------------------------------ */

  addScore(points, key) {
    if (key) {
      if (this.state.scored[key]) return;
      this.state.scored[key] = true;
    }
    this.state.score += points;
    this.print(`[Your score just went up by ${points} point${points === 1 ? '' : 's'}.]`, 'score');
    this.emit('score', { points, key });
  }

  startQuest(id) {
    const quest = this.quests.get(id);
    if (!quest) throw new Error(`Unknown quest "${id}"`);
    if (this.state.quests[id]) return;
    this.state.quests[id] = { status: 'active', objectives: {} };
    if (!quest.def.hidden) this.print(`— New quest: ${quest.name} —`, 'quest');
    if (quest.def.onStart) quest.def.onStart(this.ctx());
    this.emit('quest:start', { quest });
  }

  completeObjective(qid, oid) {
    const quest = this.quests.get(qid);
    const entry = this.state.quests[qid];
    if (!quest || !entry || entry.status !== 'active') return;
    if (entry.objectives[oid]) return;
    entry.objectives[oid] = true;

    const obj = (quest.def.objectives || []).find((o) => o.id === oid);
    if (obj && !quest.def.hidden) this.print(`[Objective complete: ${obj.text}]`, 'quest');
    if (quest.def.onObjective) quest.def.onObjective(this.ctx(), oid);
    this.emit('quest:objective', { quest, objective: oid });

    const allDone = (quest.def.objectives || [])
      .filter((o) => !o.optional)
      .every((o) => entry.objectives[o.id]);
    if (allDone && quest.def.autoComplete !== false) this.completeQuest(qid);
  }

  completeQuest(id) {
    const quest = this.quests.get(id);
    const entry = this.state.quests[id];
    if (!quest || !entry || entry.status === 'completed') return;
    entry.status = 'completed';
    if (!quest.def.hidden) this.print(`— Quest completed: ${quest.name} —`, 'quest');
    if (quest.def.reward?.score) this.addScore(quest.def.reward.score, `quest:${id}`);
    if (quest.def.onComplete) quest.def.onComplete(this.ctx());
    this.emit('quest:complete', { quest });
  }

  die(message) {
    if (message) this.print(message, 'death');
    this.print('*** YOU HAVE DIED ***', 'death');
    this.showScore();
    this.state.status = 'dead';
    this._dialogue = null;
    this.print('Type RESTART to try again, or RESTORE to load a saved game.', 'system');
    this.emit('death', {});
  }

  win(message) {
    if (message) this.print(message, 'win');
    this.print('*** YOU HAVE WON ***', 'win');
    this.showScore();
    this.state.status = 'won';
    this._dialogue = null;
    this.print('Type RESTART to play again.', 'system');
    this.emit('win', {});
  }

  /* ------------------------------------------------------------------ */
  /* Save / load                                                         */
  /* ------------------------------------------------------------------ */

  serialize() {
    return JSON.stringify({
      version: SAVE_VERSION,
      title: this.config.title,
      state: this.state,
    });
  }

  restore(json) {
    let data;
    try {
      data = JSON.parse(json);
    } catch {
      this.print('That saved game is corrupted.', 'error');
      return false;
    }
    if (data.title !== this.config.title || data.version !== SAVE_VERSION) {
      this.print('That saved game belongs to a different adventure.', 'error');
      return false;
    }
    this.state = data.state;
    this._dialogue = null;
    this.print('Game restored.', 'system');
    this.lookAround();
    return true;
  }

  saveGame() {
    if (!this.io.save) { this.print('Saving is not supported here.', 'error'); return; }
    if (this.state.status !== 'playing') { this.print('You cannot save now.', 'error'); return; }
    this.io.save(this.serialize());
    this.print('Game saved.', 'system');
  }

  loadGame() {
    if (!this.io.load) { this.print('Loading is not supported here.', 'error'); return; }
    const json = this.io.load();
    if (!json) { this.print('No saved game found.', 'error'); return; }
    this.restore(json);
  }
}
