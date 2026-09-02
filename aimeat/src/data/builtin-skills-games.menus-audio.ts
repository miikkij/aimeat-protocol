/**
 * @file src/data/builtin-skills-games.menus-audio.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two of the seven game skills: `aimeat-phaser-menus-levels` (the in-canvas menus, the
 *   four scene moves, and an ASCII map as a playable level) and `aimeat-phaser-audio-juice` (the
 *   sound bus, the browser's audio lock, the synth, and the screen feel the programme adds on top).
 *
 *   THE JUICE SECTION WAS DRAFTED FROM THE WISH'S CONTRACT AND THEN REWRITTEN against
 *   phaser/juice.js, which landed while this file was being written. It carries the nine effects
 *   the module actually exports, their real defaults, and the two time-scale traps the module's own
 *   header records.
 * @structure PHASER_MENUS_LEVELS_SKILL · PHASER_AUDIO_JUICE_SKILL
 * @usage import { PHASER_MENUS_LEVELS_SKILL, PHASER_AUDIO_JUICE_SKILL } from './builtin-skills-games.menus-audio.js';
 * @version-history
 *   v1.0.0 -- 2026-09-02 -- Initial, written against phaser/menus.js, phaser/transitions.js,
 *     phaser/level.js and phaser/audio.js at aimeat-phaser 1.0.0.
 */
import type { BuiltinSkill } from './builtin-skills.js';

/** Menus, the title screen, the pause menu, scene moves, and the ASCII level. */
export const PHASER_MENUS_LEVELS_SKILL: BuiltinSkill = {
  name: 'aimeat-phaser-menus-levels',
  visibility: 'public',
  skillMd: `---
name: aimeat-phaser-menus-levels
description: "Menus and levels for a Phaser 4 game on an AIMEAT node: menuItems() draws a keyboard-and-pointer list inside the canvas, titleScene() is a whole first screen you drop into the scenes array, pauseMenu() opens over a running scene, transition() hands one scene to the next four ways, and parseMap()/platformer() turn twelve lines of ASCII into a playable level. Triggers on: menu, main menu, title screen, pause menu, scene transition, fade, wipe, iris, level, tilemap, ASCII map, platformer, level editor, level select, valikko, aloitusnäyttö, taukovalikko, siirtymä, kenttä, kenttäeditori, tasohyppely."
license: MIT
metadata:
  audience: agent
---

# Menus, scene moves, and a level made of text

## Quick Start

\`\`\`js
const P = AIMEAT.phaser;

const MAP = [
  '..........o.......',
  '.......=====......',
  '..o...............',
  '.....^^......o..G.',
  'P........E........',
  '##################',
];

const title = P.titleScene({
  title: 'RIDGE RUN', sub: 'Six levels, one ridge',
  backdrop: 'stars', titleMotion: 'drop', motion: 'stagger',
  items: [
    { label: 'Play', scene: 'play' },
    { label: 'Levels', locked: true, hint: 'Finish 1-1 first' },
  ],
});

const play = { key: 'play',
  create() {
    this.c = P.controls(this);
    this.level = P.platformer(this, { map: MAP, controls: this.c, tile: 32, camera: 'follow' });
    this.level.on('goal', () => P.transition(this, 'title', { kind: 'iris', colour: 'accent' }));
    this.c.on('pause', () => P.pauseMenu(this, { controls: this.c, onQuit: () => this.scene.start('title') }));
  },
  update() { this.c.update(); this.level.update(); } };

await P.game({ parent: '#stage', scale: 'fit', gravity: { y: 900 }, scenes: [title, play] });
\`\`\`

## Core Concepts

### menuItems(scene, spec)

A vertical list drawn in the canvas. Up and down move, Enter and Space pick, hover selects and
a click picks, so neither input is the second-class one. Pass a \`controls\` state and a pad or
the touch overlay drives the same list, read on the edge so holding a direction moves one item.

| Field | Meaning |
|---|---|
| \`items\` | \`[{ label, onPick, locked, hint }]\` |
| \`x\` \`y\` | where the list starts |
| \`motion\` | \`'stagger'\` (default), \`'slide'\`, \`'zoom'\`, \`'typewriter'\` |
| \`cursor\` | \`'bar'\` (default), \`'arrow'\`, \`'glow'\` |
| \`align\` | \`'left'\` (default) or \`'center'\` |
| \`font\` \`size\` \`gap\` | the face, 26 px, 46 px between rows |
| \`controls\` | a controls state to drive it |
| \`index\` | which item starts selected |

Handle: \`el\` (the container), \`select(i)\` (out of range wraps, so a pad never dead-ends),
\`current()\`, \`enable(on)\`, \`destroy()\`.

**A locked item is not a dead button.** It stays readable, keeps its hint, and answers a pick
with one shake, so the player learns the control works and the door does not.

### titleScene(spec)

Returns a scene CONFIG, so nothing is created until Phaser starts the scene and you may build
it at module scope. Put it first in \`scenes\` and it is the first screen.

\`{ key, title, sub, items, motion, titleMotion, backdrop, version, controls }\`, where
\`key\` defaults to \`'title'\`, \`titleMotion\` is \`'drop'\` (default), \`'kinetic'\` (one Text
per letter, each landing a beat later) or \`'typewriter'\`, and \`backdrop\` is \`'grid'\`
(default), \`'stars'\` or \`'none'\`. An item with a \`scene\` starts that scene when picked;
\`onPick\` runs first if you gave one. \`version\` prints a small line in the bottom right.

### pauseMenu(scene, spec)

Opens a parallel scene over the running one with a scrim and four choices: Resume, Restart,
Settings, Quit. The parallel scene is registered on the game the first time it is asked for, so
an app never declares it.

\`{ title, labels: { resume, restart, settings, quit }, onSettings, onQuit, onResume,
pauseScene, controls }\`. \`pauseScene\` defaults to true, which pauses the scene underneath.
Escape closes, and so does the controls state's own \`pause\`. The handle is \`{ close, destroy }\`.

### transition(scene, toKey, opts)

\`{ kind, duration, colour, data }\` where \`kind\` is \`'fade'\` (default), \`'wipe'\`, \`'iris'\`
or \`'cut'\`, and \`colour\` is \`'bg'\` (default), \`'ink'\` or \`'accent'\`. It covers this scene,
starts the next, and uncovers it there, resolving once the next scene has been started. \`data\`
is handed to the target scene.

Under less motion every kind becomes a CUT (not a shorter fade, not a faster wipe) and the
promise still resolves the same way, so your code is unchanged.

### parseMap(rows, legend)

Pure: give it an array of strings and get level data back, so a level can be checked, generated
or shipped long before a scene exists. Coordinates are GRID cells, so the same data drives any
tile size.

\`\`\`js
const data = AIMEAT.phaser.parseMap(MAP);
// { width, height, tiles: [{ x, y, kind }], spawn, coins, enemies, goal, spikes }
\`\`\`

The legend every AIMEAT platformer understands without saying so:

| Mark | Kind |
|---|---|
| \`#\` | ground |
| \`=\` | brick |
| \`^\` | spike |
| \`o\` | coin |
| \`E\` | enemy |
| \`P\` | spawn |
| \`G\` | goal |

\`.\` and a space mean nothing here. Anything else is ignored unless your \`legend\` names it,
and a kind you add is SOLID by default, which is the useful assumption.

### platformer(scene, spec)

| Field | Default | Meaning |
|---|---|---|
| \`map\` | none | the rows |
| \`legend\` | the table above | extra or replacement marks |
| \`tile\` | 32 | pixels per cell |
| \`textures\` | \`tile-ground\`, \`tile-brick\`, \`tile-spike\`, \`tile-coin\`, \`tile-goal\`, \`tile-enemy\`, \`hero\` | the key per kind |
| \`gravity\` | 900 | set on the world |
| \`player\` | \`{ speed: 220, jump: 420, doubleJump: false }\` | |
| \`controls\` | none | a controls state |
| \`camera\` | \`'follow'\` | or \`'fixed'\` |
| \`bounds\` | true | world and camera bounds from the map size |
| \`parallaxBackdrop\` | false | two drawn layers behind the level, both off the theme |

Handle: \`player\`, \`groups\` (\`ground\`, \`coins\`, \`enemies\`, \`spikes\`, \`goal\`), \`map\`,
\`on(event, fn)\`, \`update()\`, \`reset()\`, \`destroy()\`.

**It runs with no art.** A texture key that does not exist is drawn on the spot as a plain
rectangle in the theme's colours, so a level built five minutes into a project already plays
and adding real art later changes nothing but the look.

Enemies walk until a wall or a LEDGE turns them round, and the ledge check reads the map rather
than adding a probe sprite.

## What a level editor writes

A level is the rows array plus the legend, which means an editor writes plain text into the
game's own save record, with no new key and no new table:

\`\`\`js
store.set({ levels: store.get().levels, maps: { '1-1': { rows: MAP, legend: { '~': 'water' } } } });
\`\`\`

Levels the app SHIPS belong in the source; levels a PLAYER made belong in that one record with
the rest of their save. Never one key per level: the budget is 1000 keys per person.

## Events

| Event | Value | Notes |
|---|---|---|
| \`coin\` | the running count | after the coin is taken |
| \`die\` | none | **return \`true\` and you have handled it**; the built-in respawn then stands down |
| \`goal\` | none | fires once |
| \`land\` | none | the frame the player touched ground |

\`on()\` returns the function that stops listening. The scene's \`shutdown\` destroys the handle.

## Gotchas and Common Mistakes

1. **\`setMask\` is dead under WebGL in Phaser 4.** The console says "This method is not
   supported in WebGL. Create a Mask filter instead", which turns the Phaser 3 recipe for an
   iris into a silent no-op on the default renderer. The library's iris is a stroked ring whose
   inner edge shrinks instead; do the same rather than reaching for a mask.
2. **\`level.update()\` must be called from the scene's own \`update()\`,** after
   \`controls.update()\`. Nothing polls for you.
3. **\`titleScene()\` returns a config, not a scene.** Put it in \`scenes\`; do not call
   \`scene.add()\` with it yourself.
4. **A map row shorter than the others is not padded.** \`width\` is the longest row and the
   short rows simply have nothing past their end, which is usually a hole in the floor.
5. **\`P\` marks the spawn and there is only one.** A second \`P\` wins, because the later cell
   overwrites the earlier. Same for \`G\`.
6. **A menu built in \`create()\` dies with the scene.** That is the intent; do not hold the
   handle across a restart.
7. **\`transition()\` uncovers the target scene through a one-shot \`create\` hook.** A scene the
   manager does not yet know still STARTS, it just arrives without the second half, so add
   every scene to the game before transitioning to it.
8. **\`pauseMenu\` pauses the scene by default,** which means that scene's \`update()\` stops. If
   your game keeps a timer in \`update()\`, that timer stops too, which is usually what you
   wanted and occasionally is not: pass \`pauseScene: false\` when it is not.
9. **The Settings item does nothing on its own.** Give \`onSettings\` a handler that opens your
   \`settingsPanel\`, or the player picks it and nothing happens.
10. **\`reset()\` repopulates the map and puts the player on the spawn**; it does not restart
    the scene. Coins the player took come back.
`,
};

/** The sound bus, the browser's lock, the synth, and the screen feel. */
export const PHASER_AUDIO_JUICE_SKILL: BuiltinSkill = {
  name: 'aimeat-phaser-audio-juice',
  visibility: 'public',
  skillMd: `---
name: aimeat-phaser-audio-juice
description: "Sound and screen feel for a Phaser 4 game on an AIMEAT node: AIMEAT.phaser.audio() is the bus with a master level, a music channel and an effects channel, the browser's audio lock honoured rather than worked around, a music crossfade and a small synthesiser so a game ships with no audio files at all; AIMEAT.phaser.juice() is the nine finite effects that make a hit land (shake, hit-stop, flash, burst, number, combo, slowmo, pop, trail). Triggers on: audio, sound, sfx, music, volume, mute, crossfade, synth, sound effects, audio unlock, autoplay blocked, juice, game feel, screen shake, hit stop, particles, damage numbers, combo, slow motion, ääni, äänet, musiikki, äänenvoimakkuus, mykistys, ruudun tärinä, osumatunne."
license: MIT
metadata:
  audience: agent
---

# Sound, and how a game feels when something happens

## Quick Start

\`\`\`js
const bus = AIMEAT.phaser.audio(handle.game, { music: 0.5 });

// The browser will not make a sound until somebody has clicked, tapped or typed.
scene.input.once('pointerdown', async () => {
  await bus.unlock();
  bus.playMusic('theme', { loop: true, fade: 800 });
});

bus.synth('coin');            // no file needed
bus.play('explosion');        // a file you loaded in a pack
bus.master(0.8); bus.music(0.4); bus.sfx(1); bus.mute(false);
store.settings(bus.settings());          // keep the four numbers with the player's save
bus.apply(store.settings());             // and put them back next visit
\`\`\`

## Core Concepts

### The bus

\`audio(game, opts)\` where \`game\` is \`handle.game\` and \`opts\` is
\`{ master, music, sfx, muted }\`. The defaults are master 1, music 0.6, effects 1, not muted.

| Call | What it does |
|---|---|
| \`master(v?)\` | the game's own volume; with no argument it reports |
| \`music(v?)\` | the music channel; setting it moves the track that is playing |
| \`sfx(v?)\` | the effects channel; a sound already ringing keeps the level it started at |
| \`mute(on?)\` | the game's mute |
| \`play(key, options?)\` | one effect; \`options.volume\` is a MULTIPLIER on the channel |
| \`playMusic(key, { loop, fade, volume })\` | crossfades out of whatever was playing; \`loop\` defaults true, \`fade\` to 400 ms |
| \`stopMusic(fade?)\` | fades out and lets go; default 300 ms |
| \`synth(name, { volume, type, rate })\` | a sound with no file behind it |
| \`unlocked\` | a getter: may this page make a sound yet? |
| \`onUnlock(fn)\` | called straight away when sound is already allowed; returns the stop function |
| \`unlock()\` | ask the browser; call it from a real gesture |
| \`settings()\` | \`{ master, music, sfx, muted }\` |
| \`apply(settings)\` | put a remembered set back in force |
| \`destroy()\` | stop every ramp, drop every track |

### The lock is honoured, not worked around

Until someone has clicked, tapped or typed, a page may not make a sound. A bus that queued
everything up for later would be worse than one that says no, because the person comes back to
a burst of noise they did not ask for. So:

- \`play()\` returns **false** while the lock is on, rather than queueing.
- \`playMusic()\` returns **null** and says in the console what to do.
- \`synth()\` returns **false**.
- \`unlock()\` is what a gesture handler calls, and \`onUnlock()\` is how the interface finds out
  it may now offer sound.

### The synth: six voices, no files

\`beep\` \`jump\` \`coin\` \`hit\` \`select\` \`win\`. Each is one or a few short oscillator
envelopes, scheduled and stopped by the audio clock, on the effects channel and through the
game's own master and mute. An unknown name falls back to \`beep\`.

\`{ volume, type, rate }\`: \`volume\` multiplies the channel, \`type\` overrides the oscillator
shape (\`'square'\`, \`'sawtooth'\`, \`'triangle'\`, \`'sine'\`), \`rate\` multiplies every
frequency, so \`rate: 1.5\` is the same voice a fifth higher.

### Volumes are not persisted here

\`settings()\` hands the four numbers out and \`apply()\` takes them back. Where they are kept
between visits is the app's business (\`saves()\` keeps them in the player's own record), because
a library that wrote to storage on its own would be writing under someone else's name.

## Common Patterns

### Offering sound honestly

\`\`\`js
const bus = AIMEAT.phaser.audio(h.game);
bus.apply(store.settings());
const stop = bus.onUnlock(() => hud.message('Sound on'));
this.input.once('pointerdown', () => bus.unlock());
\`\`\`

### A ship-with-no-audio-files game

\`\`\`js
level.on('coin', () => bus.synth('coin'));
level.on('die',  () => { bus.synth('hit'); return false; });   // false: the built-in respawn still runs
level.on('goal', () => bus.synth('win'));
\`\`\`

### Changing the track between levels

\`\`\`js
bus.playMusic('cave', { fade: 1200 });   // the old track fades out over the same span
\`\`\`

## Screen feel: the juice kit

\`AIMEAT.phaser.juice(scene, opts)\` is nine gestures that make a hit land. One handle owns
everything it started, so one \`destroy()\` ends all of it, and the scene's own shutdown does
the same without being asked.

\`\`\`js
const j = AIMEAT.phaser.juice(this);
level.on('coin', (n) => { j.burst(player.x, player.y, 'coin'); j.combo(player, { count: n }); });
level.on('die', () => { j.hitStop(90); j.shake(); j.flash('err'); return false; });
j.number(enemy.x, enemy.y, '-12', { tone: 'err' });
\`\`\`

| Call | Signature | What it does |
|---|---|---|
| \`shake\` | \`(strength?, ms?)\` | the camera shakes. Default 0.006 for 180 ms, capped at 0.05 |
| \`hitStop\` | \`(ms?, scale?)\` | the clock nearly stops. Default 90 ms at 0.05, floored at one frame and 0.02 |
| \`flash\` | \`(colour?, ms?)\` | one tint over the picture; \`'accent'\`, \`'ink'\`, \`'err'\` or a number |
| \`burst\` | \`(x, y, kind, opts?)\` | particles. \`'coin'\`, \`'hit'\`, \`'dust'\`, \`'spark'\`, \`'confetti'\` |
| \`number\` | \`(x, y, text, opts?)\` | a figure rising off the thing it belongs to; \`{ tone, size, rise, ms }\` |
| \`combo\` | \`(target, { count, label, ms, size })\` | a counter that grows and then decays |
| \`slowmo\` | \`(ms, scale)\` | the whole scene runs slow and ramps back |
| \`pop\` | \`(gameObject, scale?)\` | one squash on the thing that was struck. Default 1.18 |
| \`trail\` | \`(gameObject, opts?)\` | ghosts behind something fast; \`{ count, step, ms, alpha, tint }\` |

The four movement effects return **false** when they did nothing, which is how you find out
that the viewer asked for less motion.

**Nothing here runs forever.** A burst is exploded once and its emitter dies with the last
particle, a number tweens and destroys itself, a combo decays, and both time-scale effects hold
a captured baseline they always return to. So an idle screen stays at zero repaints, which is
what lets a finished screen be measured instead of argued about.

**Less motion is answered honestly, and not by switching everything off.** What MOVES the
picture or the clock is skipped: shake, hit-stop, slowmo, pop, trail and burst do nothing. What
TELLS the player something stays and loses only its travel: a number appears where it was
thrown and fades without rising, a combo shows its count without the bounce, a flash is one
short tint.

No colour is written in the kit. Every particle, number and flash takes a theme number, so the
whole set re-tones with the page's palette and mode.

## Events

| Event | On | When |
|---|---|---|
| \`unlocked\` | \`game.sound\` | the browser allowed sound; \`bus.onUnlock(fn)\` wraps this |

## Gotchas and Common Mistakes

1. **Nothing plays before a gesture, and nothing queues.** If your game is silent, the first
   thing to check is whether \`bus.unlocked\` is false. Do not call \`unlock()\` on load: the
   browser refuses and you have burned the call.
2. **\`unlock()\` must come from a real gesture handler**: a click, a tap or a key. From a
   timer or a promise chain it resolves false.
3. **\`play(key)\` warns and returns false when nothing loaded under that key.** Load the sound
   in a pack first; \`preloadPack\` reports a 404 rather than throwing, so a missing file shows
   up here.
4. **\`playMusic\` crossfades; it does not layer.** The previous track is retired over the same
   span, so the two never add up to a moment twice as loud. Two tracks at once needs two
   \`game.sound.add\` of your own.
5. **Setting \`music()\` moves the playing track but leaves a track that is fading out alone,**
   because catching it mid-fade makes the change audible as a jump.
6. **\`sfx()\` applies to the NEXT \`play()\`.** A sound already ringing keeps the level it
   started at.
7. **\`synth()\` needs Web Audio.** Where the game is not running on it, the call returns false
   and is silent, so pair a sound with something visible.
8. **The settings panel's Reset to defaults is not the bus's own defaults.** The panel resets
   master to 0.8 and effects to 0.8; a fresh bus starts at 1 and 1. If those two need to agree,
   pass the panel's numbers to \`audio()\` when you build the bus.
9. **\`destroy()\` the bus when you destroy the game.** Ramps and tracks outlive a dropped
   reference otherwise.
10. **The arcade world scales the OTHER WAY from everything else.** \`scene.time.timeScale\` and
    \`scene.tweens.timeScale\` are multipliers (0.3 is three-tenths speed) and Phaser's arcade
    \`world.timeScale\` is a divisor (2 is half speed). One asked-for scale is therefore \`scale\`
    on three of them and \`1 / scale\` on the fourth. \`juice()\` does this for you; hand-rolled
    slow motion is where it goes wrong.
11. **A hit-stop cannot be timed on the clock it is stopping.** A \`delayedCall\` on the scene's
    own clock takes \`1 / scale\` as long to fire, so a scene stopped at 0.05 waits twenty times
    its hit-stop. \`hitStop()\` and \`slowmo()\` recover from real time, which is also what a
    hit-stop IS: a fixed number of the player's milliseconds, not the game's.
12. **A juice call that returns false did nothing**, and the reason is almost always less
    motion. Do not treat it as an error, and do not pair the only feedback with a movement
    effect.
`,
};
