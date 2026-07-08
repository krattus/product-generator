// entities.js — thin wrappers around author-supplied definition objects.
// All game logic lives in engine.js; these classes handle naming and matching.

class Entity {
  constructor(id, def = {}) {
    this.id = id;
    this.def = def;
  }

  get name() {
    return this.def.name || this.id;
  }

  // Does the player's typed phrase refer to this entity?
  // Accepts the exact id, the full name, any alias, or any subset of the
  // words used in the name/aliases ("brass lantern" matches "lantern").
  matches(phrase) {
    if (!phrase) return false;
    const p = phrase.toLowerCase().trim();
    if (p === this.id) return true;
    const names = [this.name.toLowerCase(), ...(this.def.aliases || []).map((a) => a.toLowerCase())];
    if (names.includes(p)) return true;
    const wordPool = new Set(names.flatMap((n) => n.split(/\s+/)));
    return p.split(/\s+/).every((w) => wordPool.has(w));
  }
}

export class Room extends Entity {}

export class Item extends Entity {
  get article() {
    if (this.def.article !== undefined) return this.def.article;
    return /^[aeiou]/i.test(this.name) ? 'an' : 'a';
  }

  get listName() {
    const a = this.article;
    return a ? `${a} ${this.name}` : this.name;
  }
}

export class Character extends Entity {}

export class Quest extends Entity {}
