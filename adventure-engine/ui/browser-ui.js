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
    <div class="adv-scene" hidden><img alt="" /></div>
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
  const scene = root.querySelector('.adv-scene');
  const sceneImg = scene.querySelector('img');

  titleEl.textContent = game.config.title;

  const history = [];
  let historyIndex = -1;

  function assetUrl(path) {
    if (!path || path.startsWith('data:')) return path;
    return (game.config.assetBase || '') + path;
  }

  // Which illustration belongs to the current moment of the game?
  function currentScene() {
    if (!game.state) return game.config.titleImage;
    if (game.state.status !== 'playing') return game.config.titleImage;
    const room = game.rooms.get(game.state.currentRoom);
    if (!room) return game.config.titleImage;
    if (room.def.dark && !game.hasLight()) return 'DARK';
    return room.def.image || game.config.titleImage;
  }

  function refreshScene() {
    const src = currentScene();
    if (!src) { scene.hidden = true; return; }
    scene.hidden = false;
    if (src === 'DARK') {
      scene.classList.add('adv-scene-dark');
      sceneImg.removeAttribute('src');
    } else {
      scene.classList.remove('adv-scene-dark');
      const url = assetUrl(src);
      if (sceneImg.getAttribute('src') !== url) sceneImg.src = url;
    }
  }

  function refreshStatus() {
    if (!game.state) return;
    const max = game.config.maxScore ? ` of ${game.config.maxScore}` : '';
    scoreEl.textContent = `Score: ${game.state.score}${max}   Turns: ${game.state.turns}`;
    refreshScene();
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
