// dialogue.js — branching conversation trees with numbered choices.
//
// A character's dialogue definition looks like:
//   dialogue: {
//     start: 'greeting',
//     nodes: {
//       greeting: {
//         text: 'Hello, traveller!',            // string or (ctx) => string
//         effect: (ctx) => { ... },             // optional, runs after text
//         choices: [
//           { text: 'Who are you?', next: 'who', condition: (ctx) => true, effect: (ctx) => {} },
//           { text: 'Farewell.', end: true },
//         ],
//         next: 'otherNode',                    // auto-continue when there are no choices
//       },
//     },
//   }

export function startDialogue(game, character) {
  if (!character) return;
  const ctx = game.ctx();
  if (character.def.onTalk) {
    character.def.onTalk(ctx);
    return;
  }
  const dialogue = character.def.dialogue;
  if (!dialogue || !dialogue.nodes) {
    ctx.print(`${character.name} has nothing to say.`);
    return;
  }
  game._dialogue = { character, choices: [] };
  runNode(game, dialogue.start || 'start');
}

export function runNode(game, nodeId) {
  const { character } = game._dialogue;
  const node = character.def.dialogue.nodes[nodeId];
  const ctx = game.ctx();
  if (!node) {
    game._dialogue = null;
    return;
  }

  const text = typeof node.text === 'function' ? node.text(ctx) : node.text;
  if (text) ctx.print(`${character.name}: “${text}”`, 'dialogue');

  if (node.effect) node.effect(ctx);
  if (game.state.status !== 'playing') {
    game._dialogue = null;
    return;
  }

  const choices = (node.choices || []).filter((c) => !c.condition || c.condition(ctx));
  if (choices.length) {
    game._dialogue.choices = choices;
    choices.forEach((c, i) => ctx.print(`  ${i + 1}. ${c.text}`, 'choice'));
    ctx.print('  0. [End conversation]', 'choice');
  } else if (node.next) {
    runNode(game, node.next);
  } else {
    game._dialogue = null;
  }
}

export function dialogueInput(game, raw) {
  const ctx = game.ctx();
  const t = raw.trim().toLowerCase();

  if (t === '0' || t === 'bye' || t === 'leave' || t === 'end' || t === 'farewell') {
    ctx.print('(You end the conversation.)', 'system');
    game._dialogue = null;
    return;
  }

  const { choices } = game._dialogue;
  const n = parseInt(t, 10);
  if (!Number.isInteger(n) || n < 1 || n > choices.length) {
    ctx.print(`(Choose 1–${choices.length}, or 0 to end the conversation.)`, 'system');
    return;
  }

  const choice = choices[n - 1];
  ctx.print(`You: “${choice.text}”`, 'system');
  if (choice.effect) choice.effect(ctx);
  if (game.state.status !== 'playing') {
    game._dialogue = null;
    return;
  }
  if (choice.end || !choice.next) {
    game._dialogue = null;
  } else {
    runNode(game, choice.next);
  }
}
