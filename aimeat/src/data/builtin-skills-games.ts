/**
 * @file src/data/builtin-skills-games.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent skills for building a game on this node: the `aimeat-phaser` entry skill
 *   plus the six area skills that carry one part of the library each. They are written the way the
 *   Phaser project writes its own 28 subsystem skills (frontmatter with a "Triggers on:" line, then
 *   Quick Start, Core Concepts, Common Patterns, Events, Gotchas and Common Mistakes), because an
 *   agent that already knows that shape reads ours without being taught a second one.
 *
 *   WHY THIS IS A FILE AND NOT MORE ENTRIES IN builtin-skills.ts. That file was at 672 of its 800
 *   lines and these seven skills are roughly 1500, so they could not go inline; the same thing
 *   happened to aimeat-app-builder in v1.12.0 and the fix is the same. The entry skill lives here
 *   with the aggregator and the six area skills come in from three sibling modules, each holding
 *   two, so no file in the set is near the limit.
 *
 *   EVERY NAME IN THESE SKILLS WAS READ OUT OF THE MODULE IT DESCRIBES. An option an agent is told
 *   about and then cannot pass is worse than no skill at all: it costs a round trip and teaches the
 *   reader to stop believing the next line. The asset manager (sdk-libs/assets/) and the juice kit
 *   (phaser/juice.js) landed while these were being written and their sections were rewritten
 *   against the real code; if a later part of the game programme is agreed but not yet on the node,
 *   say so in the section rather than inventing a call.
 * @structure GAME_SKILL_ENTRIES: the seven entries, entry skill first
 * @usage import { GAME_SKILL_ENTRIES } from './builtin-skills-games.js';
 * @version-history
 *   v1.1.0 -- 2026-09-03 -- aimeat-phaser-world and aimeat-phaser-story join (wave two), and the
 *     entry skill's table names them.
 *   v1.0.0 -- 2026-09-02 -- Initial: aimeat-phaser and the six area skills, written against
 *     aimeat-phaser 1.0.0 (boot, assets, audio, save, controls, hud, menus, transitions, tokens,
 *     level, settings).
 */
import type { BuiltinSkill } from './builtin-skills.js';
import { PHASER_BOOT_SKILL, PHASER_ASSETS_SKILL } from './builtin-skills-games.boot-assets.js';
import { PHASER_SAVES_SKILL, PHASER_CONTROLS_HUD_SKILL } from './builtin-skills-games.saves-controls.js';
import { PHASER_MENUS_LEVELS_SKILL, PHASER_AUDIO_JUICE_SKILL } from './builtin-skills-games.menus-audio.js';
import { PHASER_WORLD_SKILL, PHASER_STORY_SKILL } from './builtin-skills-games.world.js';

/** The entry skill: which area skill to load, the paved path, and the two rules. */
const PHASER_ENTRY_SKILL: BuiltinSkill = {
  name: 'aimeat-phaser',
  visibility: 'public',
  skillMd: `---
name: aimeat-phaser
description: "The entry point for building a Phaser 4 game on an AIMEAT node with the aimeat-phaser library: which module carries what, the paved path from nothing to a playing game, the publish checklist, and the two rules that break a game when they are ignored. Load this first, then the one area skill your task is about. Triggers on: phaser, aimeat-phaser, game, arcade, platformer, canvas game, sprite, scene, peli, pelimoottori, tasohyppely, arkadipeli, kenttä, pelin teko."
license: MIT
metadata:
  audience: agent
---

# Building a Phaser 4 game on this node

\`AIMEAT.phaser\` is the base every game here otherwise rebuilds: booting into an element,
loading art, sound, saves, controls, menus, levels and a settings page. It is served from
this node at \`/v1/libs/aimeat-phaser.js\` and it loads the engine (Phaser 4.2.1) from this
node too.

Put both lines in the page, in this order:

\`\`\`html
<link rel="stylesheet" href="/lib/aimeat-phaser.css">
<script src="/v1/libs/aimeat-phaser.js"></script>
\`\`\`

For signed-in saves and the leaderboard, load \`aimeat-auth.js\` and \`aimeat-data.js\` as well.
Without them the game still runs, and everything it saves stays in the browser.

## Which skill for which job

| You are working on | Load |
|---|---|
| booting, scaling, fullscreen, resize, pause, the frame | \`node:aimeat-phaser-boot\` |
| loading files, generated art, the asset manager | \`node:aimeat-phaser-assets\` |
| saves, levels unlocked, score, settings, leaderboard | \`node:aimeat-phaser-saves\` |
| keyboard, gamepad, touch, HUD, toast, settings page | \`node:aimeat-phaser-controls-hud\` |
| menus, title screen, pause menu, scene changes, levels | \`node:aimeat-phaser-menus-levels\` |
| sound, music, the synth, screen feel | \`node:aimeat-phaser-audio-juice\` |
| particle effects, parallax backdrops, day and night, generated sprites and the actor, enemy brains and pathfinding, the boss fight, the overworld map, the tile world and minimap, the designer panels | \`node:aimeat-phaser-world\` |
| dialogue and cutscenes, the player's status HUD, achievements and the trophy room, chiptune music | \`node:aimeat-phaser-story\` |

## Quick Start: the paved path

Twelve lines from nothing to a playing platformer with a title screen, a HUD and saves.

\`\`\`js
const P = AIMEAT.phaser;
const MAP = ['....o....', '..===....', 'P...^..G#', '#########'];
const store = P.saves({ app: 'ridge', version: 1 });
await store.load();
const play = { key: 'play',
  create() {
    P.textures.tiles(this, { prefix: 'tile-', kinds: { ground: true, brick: true, spike: true, coin: true, goal: true, enemy: true } });
    P.textures.character(this, { key: 'hero' });
    this.c = P.controls(this);
    this.hud = P.hud(this, { lives: 3, level: 'Ridge 1-1' });
    this.level = P.platformer(this, { map: MAP, controls: this.c, tile: 32 });
    this.level.on('coin', (n) => this.hud.score(n * 10));
    this.level.on('goal', () => { store.levels.best('1-1', this.level.map.coins.length * 10); store.save(); });
  },
  update() { this.c.update(); this.level.update(); } };
const title = P.titleScene({ title: 'RIDGE RUN', items: [{ label: 'Play', scene: 'play' }] });
const h = await P.game({ parent: '#stage', scale: 'fit', fullscreen: 'button', gravity: { y: 900 }, scenes: [title, play] });
const bus = P.audio(h.game);
\`\`\`

The first scene in \`scenes\` is the one that starts. \`h.game\` is the Phaser.Game, and
\`h.theme\` is the page's own colours as numbers.

## Core Concepts

**The look comes from the page, never from a literal.** \`P.theme(el)\` reads the Atelier
\`--ak-*\` custom properties off the element the game lives in and hands back numbers, which
is what Phaser wants for a colour. So a game wears the app's palette and its light or dark
mode without naming a colour, and the HUD, the menus, the generated tiles and the transition
tint all change together. Write \`th.accent\`, not \`0xe8564a\`.

**Everything is finite.** No part of the library animates while the game sits still: the
score pops once when it changes, a toast rises once and removes itself, the title's stars
twinkle once and hold, an audio fade is a counted ramp. This is what makes an idle screen
measurable, so keep it true in your own code.

**Every handle has \`destroy()\`, and the scene's shutdown calls it.** \`menuItems\`,
\`platformer\` and the game handle take their listeners down with them. When you build a
handle in \`create()\` and the scene restarts, you get a fresh one; do not keep the old.

**Guest is the floor.** \`saves()\` works signed out, keeping the file in the browser, and
merges it into the node's copy the first time the player signs in. Never gate play behind a
login.

## The two rules

**1. Phaser comes from this node and nowhere else.** \`P.game()\` loads
\`/lib/phaser@4.min.js\` from the node it was served by, once, and a game keeps working on a
private node with no route to the internet. Do not add a \`<script>\` tag for a CDN copy, and
do not \`import\` Phaser from a package host: a second engine on the page is two Phasers
fighting over one canvas.

**2. One save key per player.** The whole save file is ONE memory record,
\`<app>.save\`, private, plus ONE public record for the board, \`<app>.score\`. The budget is
1024 kB per value and 1000 keys per person, so a key per score or a key per level fills a
player's whole allowance inside a year. \`saves()\` does this for you; do not write
\`AIMEAT.data.set\` yourself for anything a save holds.

## The Design Book is the place to copy from

The Phaser page at \`https://design-book.apps.aimeat.io/\` runs five demos on this library:
fullscreen and resize, menus with motions, a platformer with a level select, audio with the
settings page, and packs plus saves plus login plus controls, with the booting code shown
beside each one. Copy from a demo that runs rather than from memory of an API.

## Publish checklist

1. It boots from a cold load while SIGNED OUT, and plays. Saving prompts a sign-in; nothing refuses.
2. It works at mobile width. \`scale: 'fit'\` letterboxes; \`'resize'\` needs a \`resize\` handler in the scene.
3. The tab hiding pauses it. \`game()\` does this already unless you passed \`pauseOnHide: false\`.
4. No sound before a gesture. \`bus.unlock()\` runs from a click, a tap or a key, and never on load.
5. A score written is read back on the board without a reload: \`store.save()\` then \`store.leaderboard()\`.
6. No CDN link and no \`data:\` URI. Files live at \`/v1/pub/<owner>/…\` or in storage; art you can generate, generate.

## Gotchas and Common Mistakes

1. **\`textures.tiles()\` makes only the kinds you name, and names them exactly what you asked
   for.** \`tiles(this, { size: 32 })\` with no \`kinds\` makes nothing at all, and
   \`kinds: { ground: true }\` makes a texture called \`ground\`, not \`tile-ground\`. The
   platformer looks for \`tile-ground\`, so pass \`prefix: 'tile-'\` as the Quick Start does.
2. **Calling \`P.game()\` twice into the same element gives you two games.** Each call appends
   its own frame. Keep the handle and call \`h.destroy()\` before booting another.
3. **\`await P.game(...)\`: it is a promise**, because the engine may still be loading. A game
   booted without awaiting has no \`h.game\` yet.
4. **A scene object needs \`key\`** when anything is going to \`scene.start('play')\` at it.
5. **Physics is arcade by default.** Pass \`physics: null\` to run without it, and remember that
   \`platformer()\` then has no world to build in.
6. **\`AIMEAT.phaser.version\` must match the CSS.** If you vendored or patched either file, the
   libs test fails on the mismatch rather than at runtime.
`,
};

/** The nine game skills, entry first. */
export const GAME_SKILL_ENTRIES: BuiltinSkill[] = [
  PHASER_ENTRY_SKILL,
  PHASER_BOOT_SKILL,
  PHASER_ASSETS_SKILL,
  PHASER_SAVES_SKILL,
  PHASER_CONTROLS_HUD_SKILL,
  PHASER_MENUS_LEVELS_SKILL,
  PHASER_AUDIO_JUICE_SKILL,
  PHASER_WORLD_SKILL,
  PHASER_STORY_SKILL,
];
