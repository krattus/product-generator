// The Crystal Crown — a complete example adventure built on the engine.
// It exercises every framework feature: rooms, items, containers, scenery,
// NPCs with branching dialogue, quests with objectives, locked/conditional
// exits, dark rooms, custom verbs, daemons, deaths, scoring and victory.

import { Game } from '../../src/index.js';

export const game = new Game({
  title: 'THE CRYSTAL CROWN',
  byline: 'A Tale of Daventry-upon-Wyre — built with adventure-engine',
  intro:
    'The Crystal Crown of Eldoria has been stolen from King Aldric and hidden ' +
    'somewhere beyond the Wyre River. You, a humble wanderer, have just arrived ' +
    'at the castle gates seeking your fortune. Perhaps today you shall find it.',
  startRoom: 'courtyard',
  maxScore: 100,
  // Scene art (generated with Higgsfield): paths are relative to assetBase,
  // which itself is relative to the page that hosts the game.
  assetBase: './games/crystal-crown/',
  titleImage: 'art/title.jpg',
});

/* ---------------------------------------------------------------------- */
/* Rooms                                                                   */
/* ---------------------------------------------------------------------- */

game.room('courtyard', {
  image: 'art/courtyard.jpg',
  name: 'Castle Courtyard',
  description:
    'Banners of blue and gold hang limp above the cobblestone courtyard of Castle ' +
    'Eldoria. A marble fountain burbles in the centre, its water strangely cloudy. ' +
    'The throne room lies north through great oak doors; the kingdom stretches away ' +
    'to the south.',
  exits: {
    north: 'throne',
    south: 'meadow',
  },
});

game.room('throne', {
  image: 'art/throne.jpg',
  name: 'Throne Room',
  description:
    'Torchlight flickers across a long crimson carpet leading to an empty stone ' +
    'dais. Above it hangs a velvet cushion under glass — the resting place of the ' +
    'Crystal Crown, now heartbreakingly bare. King Aldric slumps on his throne.',
  exits: {
    south: 'courtyard',
  },
});

game.room('meadow', {
  image: 'art/meadow.jpg',
  name: 'Sunny Meadow',
  description:
    'Wildflowers nod in the breeze across this broad meadow south of the castle. ' +
    'A dark line of trees marks the Whispering Forest to the east, and you can hear ' +
    'the rush of the Wyre River to the south.',
  exits: {
    north: 'courtyard',
    east: 'forest',
    south: 'river',
  },
});

game.room('forest', {
  image: 'art/forest.jpg',
  name: 'Whispering Forest',
  description:
    'Ancient oaks lean close overhead, and the light falls green and dim. The ' +
    'forest floor is soft with moss. A crooked footpath winds north toward a thin ' +
    'curl of chimney smoke.',
  exits: {
    west: 'meadow',
    north: 'hut',
  },
});

game.room('hut', {
  image: 'art/hut.jpg',
  name: "Hermit's Hut",
  description:
    'A round little hut of woven branches, cosy despite the clutter: drying herbs, ' +
    'cracked crockery, and shelves of oddments. The hermit Odo watches you with ' +
    'bright, bird-like eyes.',
  exits: {
    south: 'forest',
  },
});

game.room('river', {
  image: 'art/river.jpg',
  name: 'Troll Bridge',
  description:
    'The Wyre River roars beneath a stout wooden bridge — the only crossing for ' +
    'miles. The far bank rises east toward grey cliffs pocked with caves.',
  exits: {
    north: 'meadow',
    east: {
      to: 'cave-mouth',
      condition: (ctx) => ctx.hasFlag('troll-paid'),
      blockedMessage:
        'The troll plants himself in your path, arms crossed. "TOLL FIRST," he rumbles.',
    },
  },
});

game.room('cave-mouth', {
  image: 'art/cave-mouth.jpg',
  name: 'Cave Entrance',
  description:
    'A ragged mouth of stone gapes in the cliff face. Cold air breathes out of the ' +
    'dark, carrying a faint glitter of crystal-dust. Entering without a light would ' +
    'be madness.',
  exits: {
    west: 'river',
    in: 'cave',
    down: 'cave',
  },
});

game.room('cave', {
  image: 'art/cave.jpg',
  name: 'Echoing Cave',
  dark: true,
  description:
    'Your light throws wild shadows across a forest of stalagmites. Every footstep ' +
    'echoes twice. To the north the floor simply ends — a chasm drops away into ' +
    'blackness, and on its far side you glimpse a pale crystalline glow.',
  onEnter(ctx, { firstVisit }) {
    if (!ctx.hasLight()) {
      ctx.die(
        'You shuffle into the absolute darkness of the cave. Your third step finds ' +
        'nothing but air, and you plunge into a chasm you never saw.',
      );
    }
  },
  exits: {
    out: 'cave-mouth',
    up: 'cave-mouth',
    north: {
      to: 'chamber',
      condition: (ctx) => ctx.hasFlag('rope-tied'),
      blockedMessage:
        'The chasm yawns before you, far too wide to jump. If you had a rope secured ' +
        'to something sturdy, you might climb down and across.',
    },
  },
});

game.room('chamber', {
  image: 'art/chamber.jpg',
  name: 'Crystal Chamber',
  description:
    'You haul yourself over the chasm lip into a chamber of pure wonder: crystals ' +
    'sprout from every surface, drinking your lantern-light and giving it back a ' +
    'hundredfold. On a natural pedestal of quartz rests the Crystal Crown of Eldoria.',
  description2: null,
  exits: {
    south: 'cave',
  },
});

/* ---------------------------------------------------------------------- */
/* Items                                                                   */
/* ---------------------------------------------------------------------- */

game.item('fountain', {
  name: 'marble fountain',
  aliases: ['fountain', 'water'],
  scenery: true,
  location: 'courtyard',
  description:
    'Cloudy water swirls in the marble basin. Something at the bottom catches the light.',
  verbs: {
    search(ctx) {
      if (ctx.itemAt('gold-coin') === 'nowhere') {
        ctx.print(
          'You roll up your sleeve and grope through the chilly water... and fish out ' +
          'a heavy gold coin!',
        );
        ctx.giveItem('gold-coin');
        ctx.addScore(5, 'found-coin');
      } else {
        ctx.print('Nothing else down there but pennies and wishes.');
      }
    },
  },
});

game.item('gold-coin', {
  name: 'gold coin',
  aliases: ['coin'],
  location: 'nowhere',
  description: 'A thick gold coin stamped with the profile of some long-dead king.',
});

game.item('oak-chest', {
  name: 'oak chest',
  aliases: ['chest'],
  location: 'throne',
  fixed: true,
  fixedMessage: 'The chest is far too heavy to carry.',
  container: true,
  open: false,
  description: 'A travelling chest of dark oak, banded with iron.',
});

game.item('rope', {
  name: 'coil of rope',
  aliases: ['rope', 'coil'],
  location: 'oak-chest',
  description: 'Fifty feet of good hempen rope, coiled tight.',
  useOn: {
    stalagmite(ctx) {
      ctx.print(
        'You loop the rope around the stoutest stalagmite, tie it off with your best ' +
        'knot, and pitch the free end into the chasm. It hangs taut against the rock — ' +
        'a climbable path north across the gap.',
      );
      ctx.destroyItem('rope');
      ctx.setFlag('rope-tied');
      ctx.addScore(10, 'rope-tied');
      ctx.completeObjective('crown', 'reach-chamber');
    },
    '*': 'You twirl the rope experimentally. Nothing useful comes of it.',
  },
});

game.item('honey-cake', {
  name: 'honey cake',
  aliases: ['cake', 'honeycake'],
  location: 'oak-chest',
  description: 'A dense golden cake, still sticky with honey. It smells wonderful.',
  verbs: {
    eat: 'Tempting — but something tells you this cake will buy more than a full stomach.',
  },
});

game.item('mushrooms', {
  name: 'glowing mushrooms',
  article: 'some',
  aliases: ['mushrooms', 'mushroom', 'fungus'],
  location: 'forest',
  description: 'A cluster of pale-blue mushrooms, pulsing with soft cold light.',
});

game.item('lantern', {
  name: 'brass lantern',
  aliases: ['lantern', 'lamp', 'light'],
  location: 'nowhere',
  light: true,
  description: 'A sturdy brass lantern. Odo has charmed its flame never to gutter.',
});

game.item('stalagmite', {
  name: 'stalagmite',
  aliases: ['stalagmites', 'rock', 'pillar'],
  scenery: true,
  location: 'cave',
  description:
    'A thick spire of dripstone, older than the kingdom itself. Sturdy enough to anchor a rope.',
});

game.item('chasm', {
  name: 'chasm',
  aliases: ['pit', 'gap'],
  scenery: true,
  location: 'cave',
  description:
    'You cannot see the bottom. You drop a pebble in and never hear it land.',
  verbs: {
    climb(ctx) {
      if (ctx.hasFlag('rope-tied')) ctx.print('Just head north — the rope will hold.');
      else ctx.die('You attempt to climb down the sheer chasm wall bare-handed. The wall wins.');
    },
  },
});

game.item('crown', {
  name: 'crystal crown',
  aliases: ['crown'],
  location: 'chamber',
  description:
    'The Crystal Crown of Eldoria: a circlet of flawless crystal that splits your ' +
    'lantern-light into slow rainbows. It hums faintly, as if pleased to be found.',
});

game.item('pedestal', {
  name: 'quartz pedestal',
  aliases: ['pedestal'],
  scenery: true,
  location: 'chamber',
  description: 'A natural column of milky quartz, worn smooth on top.',
});

/* ---------------------------------------------------------------------- */
/* Characters                                                              */
/* ---------------------------------------------------------------------- */

game.character('king', {
  name: 'King Aldric',
  aliases: ['king', 'aldric'],
  location: 'throne',
  presence: 'King Aldric sits slumped upon his throne, staring at the empty crown-case.',
  description:
    'The King of Eldoria looks like a man who has not slept in a week. His eyes keep ' +
    'drifting to the empty glass case above the dais.',
  dialogue: {
    start: 'root',
    nodes: {
      root: {
        text(ctx) {
          if (ctx.questStatus('crown') === 'completed')
            return 'You have the eternal gratitude of Eldoria, my friend.';
          if (ctx.questActive('crown'))
            return 'Any news of my crown, wanderer? Each day without it, the kingdom dims.';
          return 'Ah... a visitor. Forgive me if I do not rise. A thief has taken the ' +
                 'Crystal Crown, and with it the luck of this whole kingdom.';
        },
        choices: [
          {
            text: 'What happened to the crown?',
            next: 'story',
          },
          {
            text: 'I will find your crown, Your Majesty.',
            condition: (ctx) => !ctx.questActive('crown') && ctx.questStatus('crown') !== 'completed',
            next: 'accept',
          },
          {
            text: 'Any advice for the road?',
            condition: (ctx) => ctx.questActive('crown'),
            next: 'advice',
          },
        ],
      },
      story: {
        text:
          'Three nights past, something crept in while the guards slept — and slept, mark ' +
          'you, like the enchanted. By dawn the crown was gone. My huntsman tracked queer ' +
          'footprints south to the Wyre River and no further. Whatever took it nests in the ' +
          'caves beyond.',
        next: 'root',
      },
      accept: {
        text:
          'Then Eldoria is in your debt already. Take whatever you find useful from my ' +
          'travelling chest. And mind the bridge — a troll has squatted there since ' +
          'spring, and he does not wave travellers through for free.',
        effect(ctx) {
          ctx.startQuest('crown');
          ctx.addScore(5, 'accepted-quest');
        },
        end: true,
      },
      advice: {
        text:
          'The hermit Odo in the Whispering Forest knows those caves better than any man ' +
          'alive. And feed the troll something sweet before he decides YOU are something sweet.',
        end: true,
      },
    },
  },
  onGive: {
    crown(ctx) {
      ctx.destroyItem('crown');
      ctx.print(
        'King Aldric rises trembling from his throne and takes the crown in both hands. ' +
        'The moment it touches his brow, colour floods back into the room — the torches ' +
        'burn brighter, the banners stir, and somewhere outside a bell begins to ring.',
      );
      ctx.completeObjective('crown', 'return-crown');
    },
    '*': '"Keep it, good wanderer. All I want is my crown."',
  },
});

game.character('hermit', {
  name: 'Odo the Hermit',
  aliases: ['hermit', 'odo', 'old man'],
  location: 'hut',
  presence: 'Odo the Hermit perches on a three-legged stool, mending a net.',
  description:
    'Odo is small, brown and wrinkled as a walnut, wrapped in a patched robe. He smells ' +
    'of woodsmoke and mint.',
  dialogue: {
    start: 'root',
    nodes: {
      root: {
        text(ctx) {
          if (ctx.questStatus('lantern') === 'completed')
            return 'How fares the lantern? Never gutters, does she. Finest charm I ever wove.';
          if (ctx.questActive('lantern'))
            return 'Found my mushrooms yet? Blue ones, glowing, soft as ear-lobes. The forest is full of them.';
          return 'Come in, come in! Few enough visitors take the forest path these days. ' +
                 'What brings you to old Odo?';
        },
        choices: [
          {
            text: 'I seek the Crystal Crown. Do you know the caves?',
            next: 'caves',
          },
          {
            text: 'Do you have a lantern I could borrow?',
            condition: (ctx) => !ctx.questActive('lantern') && ctx.questStatus('lantern') !== 'completed',
            next: 'bargain',
          },
          {
            text: 'I brought your glowing mushrooms.',
            condition: (ctx) => ctx.questActive('lantern') && ctx.has('mushrooms'),
            next: 'thanks',
          },
          {
            text: 'How do I get past the troll?',
            next: 'troll',
          },
        ],
      },
      caves: {
        text:
          'The Echoing Cave, past the troll bridge. Dark as a miser\'s heart in there — take ' +
          'a light or take your last steps. And there is a chasm; the old crystal chamber ' +
          'lies on its far side. A rope and a strong stalagmite saw me across, years ago.',
        next: 'root',
      },
      bargain: {
        text:
          'A lantern! Ha — I have the finest lantern in three kingdoms, charmed never to go ' +
          'out. It is yours... for a price. Fetch me a cluster of the glowing mushrooms that ' +
          'grow in this forest. My eyes are too old to find them and my knees too old to stoop.',
        effect(ctx) {
          ctx.startQuest('lantern');
        },
        end: true,
      },
      thanks: {
        text:
          'Oho, beauties! These will keep my stew luminous for a month. Here — the lantern, ' +
          'as promised. May it show you everything but your own end.',
        effect(ctx) {
          ctx.destroyItem('mushrooms');
          ctx.giveItem('lantern');
          ctx.completeObjective('lantern', 'gather');
          ctx.completeObjective('lantern', 'deliver');
        },
        end: true,
      },
      troll: {
        text:
          'Grum? All appetite, that one. He will let anything cross his bridge if you fill ' +
          'his fist first — he is partial to gold, and cannot resist anything sweet.',
        next: 'root',
      },
    },
  },
});

game.character('troll', {
  name: 'Grum the Troll',
  aliases: ['troll', 'grum'],
  location: 'river',
  presence: 'Grum the Troll squats at the middle of the bridge, cracking his knuckles like walnuts.',
  description(ctx) {
    return ctx.hasFlag('troll-paid')
      ? 'Grum lounges against the railing, happily preoccupied with his toll.'
      : 'Nine feet of moss-green muscle and warts. His eyes are small, but they are fixed on you.';
  },
  dialogue: {
    start: 'root',
    nodes: {
      root: {
        text(ctx) {
          return ctx.hasFlag('troll-paid')
            ? 'Hurr. Bridge is open, little snack. Grum is a troll of his word.'
            : 'HALT. This Grum\'s bridge. Crossing costs toll. No toll... Grum eats walkers.';
        },
        choices: [
          {
            text: 'What kind of toll?',
            condition: (ctx) => !ctx.hasFlag('troll-paid'),
            next: 'toll',
          },
          {
            text: 'Nice bridge you have here.',
            next: 'bridge',
          },
        ],
      },
      toll: {
        text: 'Somethin\' SHINY... or somethin\' SWEET. Grum is flexible. Grum is also hungry.',
        end: true,
      },
      bridge: {
        text: 'Grum built it himself. Out of a bigger bridge.',
        end: true,
      },
    },
  },
  onGive: {
    'honey-cake': (ctx) => payTroll(ctx, 'honey-cake'),
    'gold-coin': (ctx) => payTroll(ctx, 'gold-coin'),
    '*': 'Grum sniffs it, unimpressed. "Not shiny. Not sweet. Not toll."',
  },
});

function payTroll(ctx, itemId) {
  if (ctx.hasFlag('troll-paid')) {
    ctx.print('"Toll already paid," Grum says magnanimously. "Keep it."');
    return;
  }
  ctx.destroyItem(itemId);
  const line = itemId === 'honey-cake'
    ? 'Grum crams the entire honey cake into his mouth, wrapper of leaves and all. His eyes roll back in bliss.'
    : 'Grum bites the gold coin, beams, and tucks it somewhere you would rather not think about.';
  ctx.print(`${line} "TOLL PAID!" he booms, and steps aside with a courtly, ground-shaking bow.`);
  ctx.setFlag('troll-paid');
  ctx.addScore(10, 'troll-paid');
  ctx.completeObjective('crown', 'cross-bridge');
}

/* ---------------------------------------------------------------------- */
/* Quests                                                                  */
/* ---------------------------------------------------------------------- */

game.quest('crown', {
  name: 'The Stolen Crown',
  description: 'Recover the Crystal Crown of Eldoria and return it to King Aldric.',
  objectives: [
    { id: 'cross-bridge', text: 'Get across the troll bridge' },
    { id: 'reach-chamber', text: 'Find a way over the chasm in the Echoing Cave' },
    { id: 'find-crown', text: 'Recover the Crystal Crown' },
    { id: 'return-crown', text: 'Return the crown to King Aldric' },
  ],
  onComplete(ctx) {
    ctx.addScore(40, 'quest:crown-bonus');
    ctx.win(
      'That evening there is feasting in Castle Eldoria, and your name is the first ' +
      'toast on every lip. King Aldric names you Champion of the Realm — and quietly ' +
      'asks whether you might be free next spring, as there is this small matter of a dragon...',
    );
  },
});

game.quest('lantern', {
  name: 'A Light for Old Odo',
  description: 'Gather glowing mushrooms from the Whispering Forest for Odo the Hermit.',
  objectives: [
    { id: 'gather', text: 'Pick a cluster of glowing mushrooms' },
    { id: 'deliver', text: 'Bring the mushrooms to Odo' },
  ],
  reward: { score: 10 },
});

/* ---------------------------------------------------------------------- */
/* Events, custom verbs, daemons                                           */
/* ---------------------------------------------------------------------- */

game.on('take', (ctx, { item }) => {
  if (item.id === 'mushrooms' && ctx.questActive('lantern')) {
    ctx.completeObjective('lantern', 'gather');
  }
  if (item.id === 'crown') {
    ctx.addScore(20, 'took-crown');
    ctx.completeObjective('crown', 'find-crown');
    ctx.once('crown-taken-flavour', () =>
      ctx.print(
        'As you lift the crown from the pedestal, every crystal in the chamber chimes ' +
        'a single clear note, like a cathedral of tiny bells.',
      ),
    );
  }
});

game.verb('swim', {
  aliases: ['dive', 'wade'],
  help: 'swim — for the brave and the foolish',
  handler(ctx) {
    if (ctx.currentRoom() === 'river') {
      ctx.die(
        'Scorning the troll and his toll, you plunge into the Wyre River. The Wyre, ' +
        'which has drowned better swimmers than you for a thousand years, barely notices.',
      );
    } else {
      ctx.print('There is no water here worth swimming in.');
    }
  },
});

game.daemon((ctx) => {
  if (ctx.currentRoom() === 'forest' && ctx.state.turns % 4 === 0) {
    ctx.print('The oaks lean and whisper to one another about you.', 'system');
  }
});
