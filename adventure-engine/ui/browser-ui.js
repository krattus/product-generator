// browser-ui.js — a retro Sierra-style browser front end for adventure-engine games.
//
//   import { game } from '../games/my-game/game.js';
//   import { createBrowserUI } from './browser-ui.js';
//   createBrowserUI(game, document.getElementById('game'));

export function createBrowserUI(game, root) {
  root.classList.add('adv-root');
  root.innerHTML = `
    <div class="adv-statusbar">
      <span class="adv-title"></span>
      <span class="adv-score"></span>
    </div>
    <div class="adv-output"></div>
    <div class="adv-inputbar">
      <span class="adv-prompt">&gt;</span>
      <input class="adv-input" type="text" autocomplete="off" spellcheck="false"
             placeholder="What now? (type 'help' for commands)" />
    </div>
  `;

  const output = root.querySelector('.adv-output');
  const input = root.querySelector('.adv-input');
  const titleEl = root.querySelector('.adv-title');
  const scoreEl = root.querySelector('.adv-score');

  titleEl.textContent = game.config.title;

  const history = [];
  let historyIndex = -1;

  function refreshStatus() {
    if (!game.state) return;
    const max = game.config.maxScore ? ` of ${game.config.maxScore}` : '';
    scoreEl.textContent = `Score: ${game.state.score}${max}   Turns: ${game.state.turns}`;
  }

  function print(text, style = 'text') {
    const div = document.createElement('div');
    div.className = `adv-line adv-${style}`;
    div.textContent = text;
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
    refreshStatus();
  }

  const saveKey = `adventure-engine:${game.config.title}`;

  game.start({
    print,
    save(json) {
      try { localStorage.setItem(saveKey, json); }
      catch { print('(Storage is unavailable here — the save may not survive this tab.)', 'system'); }
    },
    load() {
      try { return localStorage.getItem(saveKey); }
      catch { return null; }
    },
    onQuit() {
      print('(To leave, simply close the tab. To play again, type RESTART.)', 'system');
    },
  });
  refreshStatus();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const raw = input.value.trim();
      input.value = '';
      if (!raw) return;
      history.push(raw);
      historyIndex = history.length;
      print(`> ${raw}`, 'echo');
      game.command(raw);
      refreshStatus();
    } else if (e.key === 'ArrowUp') {
      if (historyIndex > 0) {
        historyIndex -= 1;
        input.value = history[historyIndex];
        e.preventDefault();
      }
    } else if (e.key === 'ArrowDown') {
      if (historyIndex < history.length - 1) {
        historyIndex += 1;
        input.value = history[historyIndex];
      } else {
        historyIndex = history.length;
        input.value = '';
      }
      e.preventDefault();
    }
  });

  // Keep the input focused so the player can just keep typing.
  root.addEventListener('click', (e) => {
    if (window.getSelection()?.toString()) return; // allow copying text
    input.focus();
  });
  input.focus();

  return { print, input };
}
