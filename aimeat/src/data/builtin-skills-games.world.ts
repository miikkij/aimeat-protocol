/**
 * @file src/data/builtin-skills-games.world.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two wave-two game skills: `aimeat-phaser-world` (effects, backdrops, day and
 *   night, sprites and the actor, enemies that think, the boss, the overworld and the tile world,
 *   the designer panels) and `aimeat-phaser-story` (dialogue and cutscenes, the player's status,
 *   trophies, music with no files). A sibling of the other builtin-skills-games.* files for the
 *   same reason they exist: one skill, one repo home, and the file stays under the line ceiling.
 * @structure PHASER_WORLD_SKILL · PHASER_STORY_SKILL
 * @usage import { PHASER_WORLD_SKILL, PHASER_STORY_SKILL } from './builtin-skills-games.world.js';
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (wish-phaser-fx-sprites-parallax-worldmap).
 */
import type { BuiltinSkill } from './builtin-skills.js';

/** The world: what the player sees and fights. */
export const PHASER_WORLD_SKILL: BuiltinSkill = {
  name: 'aimeat-phaser-world',
  visibility: 'public',
  skillMd: `---
name: aimeat-phaser-world
description: "aimeat-phaser's world modules: particle effects (weather, bursts, followers), generated parallax backdrops with a day-night-weather clock, generated animated sprites and the actor with a state machine, enemy brains with behaviours, rules and A* pathfinding, the boss fight sequencer, the overworld level-select map, the big top-down tile world with a minimap, and the two designer panels that tune effects and backdrops live. Load after node:aimeat-phaser. Triggers on: particles, effects, weather, parallax, background layers, day night cycle, sprite sheet, animation, enemy AI, pathfinding, boss fight, world map, level select, tile map, top-down, minimap, efektit, partikkelit, taustakerrokset, vihollinen, pomo, maailmakartta, laattakartta."
license: MIT
metadata:
  audience: agent
---

# The world: effects, backdrops, sprites, enemies, bosses, maps

Every module here draws on the page's own colours (\`AIMEAT.phaser.theme(el)\`) and needs no
art: a game runs with zero files and swaps in real art later through aimeat-assets. Every
motion is finite and every module destroys itself on the scene's shutdown.

## Particle effects: fx(scene)

\`\`\`js
const fx = AIMEAT.phaser.fx(this);
fx.weather('rain', { wind: 60 });            // over the whole camera; a new one drains the last
fx.at(x, y, 'explosion');                    // a finite burst, gone on its own
const dust = fx.follow(player.sprite, 'dust'); // rides the thing; dust.stop() / destroy()
fx.define('my-sparks', { ...fx.preset('sparks'), quantity: 40 });
\`\`\`

Weather kinds: rain, snow, fog, stars, leaves, embers, bubbles, dust, confetti. Bursts:
explosion, sparks, splash, confetti, portal, dust, smoke, footsteps, coin bursts and more
(\`fx.kinds('at')\` lists them). Followers: trail, fire, smoke, dust, bubbles, footsteps.
Colours are theme words (\`colour: 'ok'\`) or numbers. Under the less-motion switch weather
runs thin and slow, a burst becomes one puff and followers stand down; write nothing for it.

## Backdrops: parallax(scene, spec)

\`\`\`js
const bg = AIMEAT.phaser.parallax(this, 'hills');   // hills, night, city, sea, forest, desert, cave
bg.set({ time: 'dusk' });                            // day, dusk, night tint the whole stack
bg.layer('clouds').set({ drift: 12 });
AIMEAT.phaser.platformer(this, { map, controls, parallaxBackdrop: 'forest' });   // the same word
\`\`\`

A custom stack is \`{ layers: [{ kind, scroll, tone, alpha, height, haze, drift, seed }] }\` with
kinds sky, stars, clouds, mountains, hills, forest, city, sea, fog, ground. Every layer is a
tile sprite the width of the camera at its own scroll factor; \`seed\` makes a level look the
same each visit. The stack follows the camera size, not the world.

## Day, night and weather on one clock: dayNight(scene, spec)

\`\`\`js
const sky = AIMEAT.phaser.dayNight(this, { create: true, preset: 'hills', speed: 0.05, hour: 9,
  weather: 'auto', lights: [{ x: 300, y: 470 }] });
sky.set({ hour: 18.5, weather: 'storm' });
sky.on('phase', (name) => AIMEAT.phaser.toast(this, name));   // dawn, day, dusk, night
sky.on('lightning', () => bus.synth('hit'));
\`\`\`

\`speed\` is game hours per real second (0 freezes). The parallax turns at each phase
boundary, an ambient tint moves every frame, lamps show when it is dark, and the weather
schedule ('auto' rolls a seeded forecast) drives fx. Pass \`parallax\` and \`fx\` handles you
already have instead of \`create: true\`.

## Sprites with no art, and the actor

\`\`\`js
['hero', 'slime', 'bat', 'coin'].forEach((kind) => AIMEAT.phaser.spriteSheet(this, { kind }));
const me = AIMEAT.phaser.actor(this, { key: 'hero', x: 120, y: 480 });       // platformer mode
const bat = AIMEAT.phaser.actor(this, { key: 'bat', x, y, mode: 'topdown' });
// in update(): c.update(); me.update(c);      bat.drive(vx, vy);
me.hit({ from: slime.sprite });   // false while invulnerable, so an overlap may call it every frame
me.die(() => me.reset(120, 480));  me.say('Hei!');
AIMEAT.phaser.platformer(this, { map, controls: c, player: me });   // the level takes an actor
\`\`\`

Kinds: hero, topdown (4 or 8 directions), slime, bat, walker, coin, pickup; palette
\`{ body, visor, trim }\`. The sheet registers \`<key>-idle/-walk/-run/-jump/-fall/-hit/-die\`.
A real strip loaded by a pack (or an aimeat-assets image with \`frames\`) gets its animations
from \`animations(this, key, { walk: { start: 2, end: 7, rate: 10, repeat: -1 } })\`, and
\`spriteFromLibrary(this, lib, key, { animations })\` does both from a library entry.

## Enemies that think: brain(scene, actor, spec)

\`\`\`js
const mind = AIMEAT.phaser.brain(this, foe, { archetype: 'walker', target: me, sight: 220, onShoot: fire });
AIMEAT.phaser.brain(this, guard, { start: 'guard', target: me, grid: world.grid(),
  rules: [{ from: 'guard', to: 'chase', when: ['sees', 'heard'] }, { from: 'chase', to: 'guard', when: 'lost' },
          { from: 'any', to: 'flee', when: { healthBelow: 0.3 } }] });
AIMEAT.phaser.brain.noise(me.sprite.x, me.sprite.y, 300, this);   // wakes every brain in range
mind.debug(true);                                                  // sight, path, state on screen
\`\`\`

Archetypes: slime (patrol), bat (wander, chase on sight), walker (patrol, shoot on sight),
guard, boss-minion (ambush). Behaviours: patrol, wander, guard, chase, flee, shoot, ambush,
orbit, sequence. Condition words: sees, lost, heard, hurt, done, { near }, { far },
{ healthBelow }, { timer }, all / any / not, or a function of the context. With a grid
(\`world.grid()\`) a top-down chase routes by A*; \`pathfind.findPath(grid, from, to)\`,
\`smoothPath\` and \`flowField(grid, target)\` are there for your own use. The game owns
projectiles: \`onShoot(origin, angle)\` is called, nothing is spawned for you.

## The boss fight: boss(scene, spec)

\`\`\`js
const b = AIMEAT.phaser.boss(this, { actor: walker, health: 120, name: 'The Walker',
  patterns: { sweep: [{ move: { to: 'left', ms: 700 } }, { telegraph: { ms: 350, kind: 'line' } }, { fire: { kind: 'aimed', speed: 300 } }],
              barrage: [{ telegraph: { ms: 500, kind: 'ring' } }, { fire: { kind: 'ring', count: 12 } }, { slam: { ms: 700 } }, { spawn: { kind: 'imp', count: 2, at: 'sides' } }] },
  phases: [{ at: 1, name: 'Sweep', patterns: ['sweep'] }, { at: 0.5, name: 'Fury', patterns: ['barrage', 'sweep'], speed: 1.3, enter: [{ telegraph: { ms: 600, kind: 'flash' } }] }],
  onFire(origin, angles) { /* your projectiles; angles in radians */ }, onSpawn(x, y, kind) { /* your minions */ } });
b.target(me.sprite); b.start(); b.damage(12); b.on('defeat', () => AIMEAT.phaser.toast(this, 'Down'));
\`\`\`

Steps: move, dash, telegraph (flash, ring, line), fire (aimed, spread, ring, rain), spawn,
slam, wait, fn, loop, random, die. A phase starts when the health fraction crosses its
\`at\`; the step in flight finishes first, then \`enter\` plays once. The bar across the top
drains with a lag fill and a tick at every phase boundary. All timing is on the scene clock,
so \`pause()\` holds everything.

## The overworld: worldMap(scene, spec)

\`\`\`js
const map = AIMEAT.phaser.worldMap(this, { nodes, paths, regions, store, camera: 'follow', fog: true });
map.on('pick', (node) => this.scene.start(node.scene, node.data));
// one line for the whole screen:
scenes: [AIMEAT.phaser.worldMapScene({ key: 'map', nodes, paths, store, controls: true, transition: 'iris' })]
\`\`\`

Nodes \`{ id, x, y, label, kind: 'level'|'town'|'boss'|'secret', scene }\`, paths \`[a, b]\` or
\`{ from, to, control }\`. Locks, stars and bests come from \`store.levels\` (the one save key);
the walker moves along open paths only and a locked node refuses. Arrows walk, action picks,
a click on a reachable node walks there.

## A big top-down world: tileWorld(scene, spec) and minimap

\`\`\`js
const world = AIMEAT.phaser.tileWorld(this, { map: ROWS, tile: 32, camera: 'follow', player: me.sprite,
  objects: (x, y, mark) => { /* E enemy, N npc, C chest, D door */ } });
const mini = AIMEAT.phaser.minimap(this, world, { corner: 'tr', size: 140, marks: ['C'] });
const t = world.toTile(me.sprite.x, me.sprite.y);
if (world.tileAt(t.x, t.y) === 'C') { world.set(t.x, t.y, '.'); mini.refresh(); }
\`\`\`

Legend: \`#\` wall, \`.\` floor, \`~\` water (blocks, or slows with \`water: 'slow'\`), \`T\` tree
(you walk behind the crown), \`D\` door, \`C\` chest, \`P\` spawn, \`E\` enemy, \`N\` npc, \`=\` bridge,
\`,\` grass. A Tiled map loaded by a pack works too: \`{ tiled: key, tileset: { name, image } }\`.
\`world.grid()\` is what the brains route on.

## Designer panels (DOM): tune, then copy the code

\`\`\`js
AIMEAT.phaser.fxDesigner({ target: '#tools', fx, scene: this, family: 'at', preset: 'sparks', x, y });
AIMEAT.phaser.parallaxDesigner({ target: '#tools', parallax: bg, preset: 'hills' });
\`\`\`

Both apply every change to the stage at once and hand back the result with Copy as JS
(\`fx.define(...)\` or the \`parallax(this, spec)\` call) or Export JSON. Needs
\`/lib/aimeat-phaser.css\` on the page. The Design Book's Phaser page shows all of this
running: fetch \`GET /v1/designbook\` and open the Phaser tab.
`,
};

/** The story: talk, the player's state, trophies, music. */
export const PHASER_STORY_SKILL: BuiltinSkill = {
  name: 'aimeat-phaser-story',
  visibility: 'public',
  skillMd: `---
name: aimeat-phaser-story
description: "aimeat-phaser's story modules: the in-canvas dialogue box with a typewriter, speakers, portraits and questions, the cutscene runner (pan, fade, move, say, ask, skip), the player's status HUD (bars, cooldowns, inventory, quest log, buffs) kept in the one save key, achievements from conditions with a banner and a trophy room, and chiptune music generated on the audio bus with no files. Load after node:aimeat-phaser. Triggers on: dialogue, dialog box, cutscene, NPC talk, health bar, inventory, quest log, achievements, trophies, game music, chiptune, dialogi, välinäytös, elämäpalkki, tehtäväloki, saavutukset, pelimusiikki."
license: MIT
metadata:
  audience: agent
---

# The story: dialogue, cutscenes, status, trophies, music

## Dialogue: dialogue(scene, opts)

\`\`\`js
const talk = AIMEAT.phaser.dialogue(this, { controls: c, speakers: { guide: { tone: 'accent' }, you: { name: 'You', tone: 'ch2' } } });
await talk.say('guide', 'You made it to the ridge.');
const road = await talk.ask('guide', 'High road or low road?', [{ label: 'High road', value: 'high' }, { label: 'Low road', value: 'low' }]);
\`\`\`

The box types the line letter by letter; the action button (or a tap) reveals the rest, turns
the page, closes the line or picks the answer under the cursor; up and down move the cursor.
With \`library\` (an aimeat-assets library) a text argument may be a key: \`say('guide',
'intro.hello')\` shows the player's language and falls back to the literal. \`say()\` resolves
when the player advances, \`ask()\` with the picked value (null if the box was closed). Read
\`talk.open\` to pause your own input while it is up. Under less motion the whole page shows
at once.

## Cutscenes: cutscene(scene, steps, opts)

\`\`\`js
await AIMEAT.phaser.cutscene(this, [
  { skip: true },                                  // hold action to skip the whole thing
  { camera: { x: 1200, y: 240, ms: 900 } }, { fade: 'out', ms: 250 }, { fade: 'in', ms: 250 },
  { say: ['guide', 'Something moved in the dark.'] },
  { ask: ['guide', 'Go on?', [{ label: 'Yes', value: 1 }, { label: 'No', value: 0 }]], then: (v) => (v ? [{ move: { target: me.sprite, x: 900, ms: 800 } }] : []) },
  { wait: 300 }, { fn: async (scene) => {} },
], { controls: c, dialogue: talk });
\`\`\`

Steps run in order; \`then\` returns more steps from an answer. Stop a camera follow before a
pan. The promise resolves \`{ skipped }\`; \`cutscene.skip()\` ends it from outside.

## The player's status: status(scene, spec)

\`\`\`js
const st = AIMEAT.phaser.status(this, { store,
  bars: [{ id: 'hp', label: 'Health', max: 100, value: 100, tone: 'err' }, { id: 'mana', label: 'Mana', max: 50, value: 50, tone: 'ch1' }],
  cooldowns: [{ id: 'skill', icon: 'S', ms: 3000 }], inventory: { slots: 5 } });
st.bars.set('hp', st.bars.get('hp').value - 18);     // a drop flashes, a low bar pulses (finite)
if (st.cooldowns.start('skill')) { /* it was ready */ }
st.inventory.setSlot(0, { icon: 'K', count: 2, label: 'Key' }); st.inventory.select(0);   // keys 1..9 select
st.quest.set('gate', { title: 'Open the gate', steps: [{ text: 'Find the keys' }] }); st.quest.complete('gate');
st.buffs.add('regen', { label: 'Regen', ms: 4000, tone: 'ok' });
\`\`\`

It sits around the HUD's corners (bars and the quest log in the left column, the row at the
bottom). With a \`store\` (from \`AIMEAT.phaser.saves\`), bars, slots and quests live in ONE
section of the player's one save key and come back on the next visit; cooldowns and buffs
are timers and are not written.

## Trophies: achievements(scene, spec) and trophyRoom

\`\`\`js
const ach = AIMEAT.phaser.achievements(this, { store, list: [
  { id: 'ten', title: 'Ten coins', hint: 'Collect ten coins', kind: 'count', stat: 'coins', target: 10, board: true },
  { id: 'fast', title: 'Quick run', hint: 'Finish under 60 s', kind: 'min', stat: 'time', target: 60 },
  { id: 'ghost', title: 'Untouched', hint: 'Take no damage', kind: 'flag', stat: 'no-damage', secret: true },
] });
ach.stat('coins', 1);   ach.set('time', 48);   ach.flag('no-damage');
ach.on('unlock', () => bus.synth('win'));
AIMEAT.phaser.trophyRoom(this, ach, { title: 'Trophies' });   // closes on action, Escape or a tap outside
\`\`\`

A met condition unlocks once, slides a ribbon in at the top and lands in the store's
\`achievements\` section; \`board: true\` also posts the stat to the leaderboard. A secret
trophy lists as ??? until it is won. \`ach.progress(id)\` gives \`{ value, target, done }\`.

## Music with no files: chiptune(bus, spec)

\`\`\`js
const bus = AIMEAT.phaser.audio(h.game);
const tune = AIMEAT.phaser.chiptune(bus, { style: 'level', seed: 7 });   // title, level, boss, shop, win, lose
bus.unlock().then(() => tune.play());
tune.intensity(1, 600);                        // 0 pad and bass, 0.5 melody in, 1 full drums
tune.on('beat', (ev) => this.time.delayedCall(ev.inMs, flash));
tune.stop(400);   AIMEAT.phaser.chiptune(bus, 'win').play();   // a two-bar sting that ends itself
\`\`\`

Four voices scheduled on the audio clock, an A-B-A tune composed from the seed in a key and a
feel (pop, march, waltz, chill, boss, retro); the same seed is the same tune every visit. It
plays through the bus's music level, so the settings slider and mute reach it. Call
\`tune.pause()\` on tab hide and \`resume()\` on show; a background tab throttles timers.
`,
};
