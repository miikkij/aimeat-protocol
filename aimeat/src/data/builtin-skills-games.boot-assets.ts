/**
 * @file src/data/builtin-skills-games.boot-assets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two of the seven game skills: `aimeat-phaser-boot` (getting a game onto the screen
 *   and keeping it the right size) and `aimeat-phaser-assets` (what a game loads and what it draws
 *   instead of loading, plus the asset manager the programme adds on top).
 *
 *   THE ASSET-MANAGER SECTION WAS DRAFTED FROM THE WISH'S CONTRACT AND THEN REWRITTEN against
 *   src/static/sdk-libs/assets/, which landed while this file was being written. Every call, option
 *   and return shape in it now comes from manifest.js, library.js, upload.js, pack.js, sound.js,
 *   texts.js and preview.js rather than from the plan.
 * @structure PHASER_BOOT_SKILL · PHASER_ASSETS_SKILL
 * @usage import { PHASER_BOOT_SKILL, PHASER_ASSETS_SKILL } from './builtin-skills-games.boot-assets.js';
 * @version-history
 *   v1.0.0 -- 2026-09-02 -- Initial, written against phaser/boot.js and phaser/assets.js at
 *     aimeat-phaser 1.0.0.
 */
import type { BuiltinSkill } from './builtin-skills.js';

/** Booting, scaling, fullscreen, resize, pause, reduced motion. */
export const PHASER_BOOT_SKILL: BuiltinSkill = {
  name: 'aimeat-phaser-boot',
  visibility: 'public',
  skillMd: `---
name: aimeat-phaser-boot
description: "Boot a Phaser 4 game into an element with AIMEAT.phaser.game(): the three scale modes, fullscreen on the frame rather than the canvas, the resize event, pausing when the tab hides, reading the page's colours with theme(), less motion, and what is wired for a phone today. Triggers on: game boot, scale, resize, fullscreen, canvas size, letterbox, aspect ratio, pause on hide, theme colours, reduced motion, mobile, koko, koko näyttö, skaalaus, kokoruutu, teema, värit, mobiili, tauko."
license: MIT
metadata:
  audience: agent
---

# Booting a game, and keeping it the right size

\`AIMEAT.phaser.game(spec)\` builds a FRAME (a \`div.ak-phaser\`), puts the canvas in it, and
gives you a handle. The frame is what goes full screen, so anything you draw over the game in
DOM travels with it instead of being left behind on the page.

## Quick Start

\`\`\`js
const h = await AIMEAT.phaser.game({
  parent: '#stage',
  width: 960, height: 540,
  scale: 'fit',
  fullscreen: 'button',
  physics: 'arcade',
  gravity: { y: 900 },
  scenes: [play],
});
h.game;        // the Phaser.Game
h.frame;       // the div the canvas lives in
h.theme.ink;   // the page's text colour, as a number Phaser accepts
await h.fullscreen();
h.destroy();
\`\`\`

## Core Concepts

### The spec

| Field | Default | What it does |
|---|---|---|
| \`parent\` | the body | an element or a CSS selector |
| \`width\` / \`height\` | 960 / 540 | the DESIGN size, which is not the pixel size |
| \`scale\` | \`'fit'\` | \`'fit'\`, \`'resize'\` or \`'fixed'\` (below) |
| \`fullscreen\` | off | \`true\` wires it up for the handle; \`'button'\` also puts the button in the frame's corner |
| \`scenes\` | \`[]\` | scene classes or plain scene objects; the first one starts |
| \`physics\` | \`'arcade'\` | or \`'matter'\`, or \`null\` for none |
| \`gravity\` | \`{ y: 0 }\` | passed to whichever engine is running |
| \`background\` | \`'bg'\` | \`'bg'\`, \`'surface'\`, \`'ink'\` or a number |
| \`pixelArt\` | false | nearest-neighbour scaling |
| \`transparent\` | false | let the page show through |
| \`pauseOnHide\` | true | the loop sleeps while the tab is hidden |
| \`fps\` | Phaser's own | a target frame rate |
| \`fullscreenLabel\` / \`exitFullscreenLabel\` | English | the button's two labels |
| \`onReady\` | none | called with the Phaser.Game once it has booted |

### The three scale modes

- **\`'fit'\`** (Phaser \`Scale.FIT\`, centred) letterboxes the design size inside the parent's
  box. The frame keeps the design's aspect ratio through a \`--ak-phaser-ratio\` custom
  property. This is the mode to reach for: the game is laid out once at 960 by 540 and every
  screen gets the same picture.
- **\`'resize'\`** (\`Scale.RESIZE\`) makes the canvas the parent's box and hands each scene a
  \`resize\` event. Every position you computed from \`scale.width\` has to be recomputed there.
- **\`'fixed'\`** (\`Scale.NONE\`) leaves the canvas at the design size, whatever the box does.

### The handle

\`fullscreen()\` · \`exitFullscreen()\` · \`isFullscreen()\` · \`resize(w, h)\` · \`size()\` ·
\`sleep()\` · \`wake()\` · \`reducedMotion()\` · \`destroy()\`, plus \`game\`, \`frame\` and \`theme\`.

\`fullscreen()\` returns a promise that resolves when the browser grants it and REJECTS with a
sentence when it refuses, which it does whenever the call did not come from a real gesture.

### theme(el): the page's colours as numbers

\`\`\`js
const th = AIMEAT.phaser.theme(h.frame);
// bg surface ink inkDim accent ok warn err line ch1 ch2 ch3 ch4  → numbers
// font fontDisplay fontMono ease                                  → CSS strings
// motion                                                          → milliseconds
scene.add.text(0, 0, 'Play', { fontFamily: th.font, color: AIMEAT.phaser.theme.css(h.frame).ink });
\`\`\`

The four \`ch1\`..\`ch4\` channel colours are the set to use when you need several things to read
apart at a glance: player colours, tile kinds, chart series.

\`theme.css(el)\` is the same thing with the colours as \`#rrggbb\` strings, for a Phaser text
style or an inline SVG fill.

Colours are resolved by painting the computed value onto a one-pixel canvas and reading the
pixel back, so a \`var()\` chain or a \`color-mix()\` resolves correctly. When the Atelier
stylesheet is not on the page the tokens are absent and a documented fallback palette stands
in, so a bare page still gets a finished-looking game.

## Common Patterns

### A scene that survives 'resize'

\`\`\`js
const play = {
  key: 'play',
  create() {
    this.title = this.add.text(this.scale.width / 2, 40, 'Ridge').setOrigin(0.5, 0);
    this.scale.on('resize', (size) => this.title.setX(size.width / 2));
  },
};
\`\`\`

### Pausing for something other than a hidden tab

\`\`\`js
h.sleep();  // the loop stops asking for frames
h.wake();
\`\`\`

### Honouring less motion

\`\`\`js
if (h.reducedMotion()) sprite.setPosition(x, y);
else this.tweens.add({ targets: sprite, x, y, duration: h.theme.motion });
\`\`\`

The library's own menus, transitions and coin pops already check this; the rule inside
\`aimeat-phaser\` is that less motion becomes a CUT, not a shorter animation.

### What is wired for a phone today

- The frame is the fullscreen target, so a DOM overlay inside it stays in the picture.
- A \`ResizeObserver\` watches the parent AND the frame, so \`'resize'\` mode stays honest when a
  sidebar folds away and the window never hears about it.
- The touch overlay from \`controls()\` mounts into the same frame and shows itself on a coarse
  pointer through a CSS media query, so nothing has to be re-run when the device changes.
- The loop sleeps when the tab hides, which is the battery rule.

Orientation locking, the safe-area inset and a PWA install are agreed for the game programme
and are NOT in the library yet. Do not write code against a \`mobile\` module until
\`AIMEAT.phaser\` reports one.

## Events

| Event | On | When |
|---|---|---|
| \`resize\` | \`scene.scale\` | \`'resize'\` mode, whenever the box changed |
| \`enterfullscreen\` / \`leavefullscreen\` | \`game.scale\` | the browser granted or ended full screen |
| \`fullscreenunsupported\` / \`fullscreenfailed\` | \`game.scale\` | it refused; \`h.fullscreen()\` rejects on these |
| \`ready\` | \`game.events\` | the boot finished; \`game()\` already awaits this for you |

## Gotchas and Common Mistakes

1. **\`scale.resize(w, h)\` is a no-op in RESIZE mode on Phaser 4.2.1.** The game size IS the
   parent's box, and Phaser rebuilds it from the parent bounds inside \`refresh()\`, so a size
   you set is measured, applied and then overwritten on the next refresh. It looks exactly like
   the observer not firing. The working pair is \`scale.getParentBounds()\` then
   \`scale.refresh()\`, which is what the library does. \`h.resize(w, h)\` is therefore ignored in
   \`'resize'\` mode by design.
2. **Full screen is granted only from a real gesture.** Call \`h.fullscreen()\` inside a click,
   key or tap handler. From a timer or a promise chain the browser refuses and the returned
   promise rejects.
3. **Pass the frame to \`theme()\`, not the canvas.** A canvas is legal to append to but its
   children never render, so a caller who passes \`game.canvas\` is moved up to the frame
   automatically, so rely on that rather than working around it.
4. **The design size is not the pixel size.** In \`'fit'\` mode \`scale.width\` stays 960 however
   large the canvas is drawn. Lay out against \`scale.width\` and \`scale.height\`, never
   \`window.innerWidth\`.
5. **A collapsed box is not a resize.** The observer ignores a frame under one pixel, because
   refreshing to zero takes the canvas with it and it does not come back on its own. If your
   game vanishes when a panel opens, the panel is hiding the frame, not resizing it.
6. **\`destroy()\` is the only clean exit.** It disconnects the observer, removes the visibility
   listener, destroys the game and removes the frame. Dropping the handle leaves all four.
7. **Do not add a second Phaser.** The engine loads once from this node, shared by whoever asks
   first. A CDN tag on the page gives you two engines and one canvas.
`,
};

/** Loading files, generated art, and the asset manager on top. */
export const PHASER_ASSETS_SKILL: BuiltinSkill = {
  name: 'aimeat-phaser-assets',
  visibility: 'public',
  skillMd: `---
name: aimeat-phaser-assets
description: "Art and sound for a Phaser 4 game on an AIMEAT node: declaring a resource pack, loading it with a progress bar and 404 reporting, generating tiles and a character so a game runs with no files at all, and where real files live (/v1/pub/<owner>/…, never a data: URI). Also the aimeat-assets manager: one manifest per app as one public memory key, upload, the browser atlas packer, the WAV export, the texts and the gallery. Triggers on: assets, load, preload, spritesheet, atlas, texture, tileset, sprite, image, progress bar, 404, asset manager, aimeat-assets, manifest, packAtlas, upload, kuvat, lataus, tekstuuri, äänitiedostot, resurssit, kuvapaketti."
license: MIT
metadata:
  audience: agent
---

# What a game loads, and what it draws instead

Two halves. \`pack\` and \`preloadPack\` load real files. \`textures\` generates art in the
browser, so a game plays before anyone has made a single picture.

## Quick Start

\`\`\`js
const P = AIMEAT.phaser;

// No files at all. This is the one to reach for first.
function create() {
  P.textures.tiles(this, { prefix: 'tile-', size: 32, kinds: { ground: true, brick: true, spike: true, coin: true, goal: true } });
  const hero = P.textures.character(this, { key: 'hero' });
  this.add.sprite(80, 80, hero.key).play(hero.anims.run);
}

// Real files, when you have them.
const art = P.pack({
  id: 'level1',
  base: '/v1/pub/alice/ridge/',
  images: { sky: 'sky.png' },
  spritesheets: { boss: { url: 'boss.png', frameWidth: 64, frameHeight: 64 } },
  audio: { coin: ['coin.mp3', 'coin.ogg'] },
});
function preload() { P.preloadPack(this, art); }            // the scene manager starts the loader
async function createLater() { const r = await P.preloadPack(this, art); }  // this call starts it
\`\`\`

## Core Concepts

### pack(spec): a frozen manifest

Every relative address is resolved against \`base\`, and \`base\` against the page, so
\`base: 'assets/'\` means what it looks like from wherever the app is served. The result is
frozen, because a manifest is a statement of what a level needs and two scenes may share it.

| Field | Shape |
|---|---|
| \`id\` | a name, used in warnings |
| \`base\` | prefix for every relative address |
| \`images\` | \`{ key: url }\` |
| \`spritesheets\` | \`{ key: { url, frameWidth, frameHeight } }\` |
| \`atlases\` | \`{ key: { texture, data } }\` |
| \`audio\` | \`{ key: url }\` or \`{ key: [mp3, ogg] }\` |
| \`tilemaps\` | \`{ key: url }\`, Tiled JSON |
| \`json\` | \`{ key: url }\` |
| \`bitmapFonts\` | \`{ key: { texture, data } }\` |

### preloadPack(scene, packOrPacks, opts)

Registers one manifest or an array of them, draws a progress bar IN THE CANVAS on the page's
own colours, and resolves with \`{ loaded, failed }\`. A file that fails is COLLECTED, not
thrown: one missing sprite must not take the level with it, and the result names every address
that did not answer.

| Option | Meaning |
|---|---|
| \`bar\` | \`false\` hides it; \`{ x, y, width }\` places it. Default: centred, 60% of the canvas width |
| \`theme\` | a theme object to draw the bar with. Default: read off the canvas |
| \`onProgress\` | \`(fraction, fileKey) => void\` |
| \`onFail\` | \`({ key, url, type }) => void\`, once per file that did not load |

It works from \`preload()\` and from \`create()\` alike. Which one you are at is read from the
scene's own status: during preload the scene manager will start the loader, so the call only
registers and waits; later, nothing is going to start it, so the call does.

### textures: art with no files

- \`textures.shapes(scene, [{ key, width, height, draw(g, look) }])\`: you draw, the library
  keeps it as a texture. \`look\` is the theme, so use \`look.accent\` and the shape re-tones
  with the palette. Returns the keys.
- \`textures.tiles(scene, { size, prefix, kinds })\`: one square texture per kind. \`kinds\` is
  \`{ ground: true, spike: 0xff0000 }\`: \`true\` takes the kind's own theme colour, a number
  overrides it. The kinds with a colour of their own are \`ground\`, \`brick\`, \`spike\`, \`coin\`,
  \`goal\`, \`water\` and \`crate\`; anything else you name is drawn as a solid block in the
  accent colour. Returns the keys.
- \`textures.character(scene, { key, width, height, palette })\`: a six-frame hero strip with
  its animations registered. Returns
  \`{ key, frames, anims: { idle, run, jump } }\`, where the animation names are
  \`<key>-idle\`, \`<key>-run\` and \`<key>-jump\`. \`palette\` takes \`{ body, visor, trim }\` as
  numbers; left out, body is the accent colour, visor is the ink and trim is a darker body.

An existing key is left alone rather than regenerated, because \`generateTexture\` draws over
the old canvas instead of replacing it and a half-overwritten texture looks like a rendering
fault rather than a bug.

## Common Patterns

### Loading and reporting what did not arrive

\`\`\`js
async function create() {
  const { loaded, failed } = await AIMEAT.phaser.preloadPack(this, art, {
    onFail: (f) => console.warn('missing', f.key, f.url),
  });
  if (failed.length) AIMEAT.phaser.toast(this, failed.length + ' files did not load', { tone: 'warn' });
}
\`\`\`

### Generated tiles the platformer can find

\`platformer()\` looks for \`tile-ground\`, \`tile-brick\`, \`tile-spike\`, \`tile-coin\`,
\`tile-goal\`, \`tile-enemy\` and \`hero\`. So the prefix is not optional if you want your
generated art used:

\`\`\`js
AIMEAT.phaser.textures.tiles(this, { prefix: 'tile-', kinds: { ground: true, brick: true, spike: true, coin: true, goal: true, enemy: true } });
AIMEAT.phaser.textures.character(this, { key: 'hero' });
\`\`\`

### A shape of your own

\`\`\`js
AIMEAT.phaser.textures.shapes(this, [{
  key: 'orb', width: 24, height: 24,
  draw(g, look) { g.fillStyle(look.ch1, 1).fillCircle(12, 12, 11); },
}]);
\`\`\`

## Where real files live

Published apps are one HTML file, so an asset is a URL, not bytes in the page.

- Upload once through \`AIMEAT.storage\` and serve from \`/v1/pub/<owner>/<path>\`.
- Give the pack that address as its \`base\`.
- A \`data:\` URI is REFUSED by \`pack()\` with a warning that names the entry, because a base64
  blob is carried in the page on every single load, forever.

## The aimeat-assets manager

A second library, \`/v1/libs/aimeat-assets.js\` on \`AIMEAT.assets\`, for a game with real
files. One app's whole asset list is ONE memory record (images, atlases, audio, fonts,
tilemaps, videos and the app's texts), for the same reason a save is one record.

\`\`\`html
<script src="/v1/libs/aimeat-assets.js"></script>
\`\`\`

\`\`\`js
const lib = AIMEAT.assets.library({ app: 'ridge' });
await lib.load();                      // the stored manifest, or the inline one, or an empty library
AIMEAT.phaser.preloadPack(this, lib.toPack());   // straight into the loader above
this.add.image(0, 0, 'hero');
hud.message(lib.t('level.start', { n: 1 }));      // the texts live in the same record
\`\`\`

### The library store

\`library({ app, key, lang, manifest })\`. \`key\` defaults to \`app + '.assets'\`.

| Call | What it does |
|---|---|
| \`load()\` | the stored record, else the \`manifest\` you passed inline, else an empty library. Never throws |
| \`get()\` / \`set(m)\` | the manifest as it stands, frozen; \`set\` adopts a new one |
| \`save()\` | writes the record **public**, so a signed-out player reads it |
| \`add(kind, key, entry)\` | one entry, after an upload |
| \`url(key)\` / \`has(key)\` / \`list(kind)\` | resolve, ask, and one row per key for a table |
| \`toPack()\` | the manifest as the resource pack \`preloadPack()\` reads |
| \`t(key, vars)\` / \`lang(code)\` | the texts, with \`{n}\` substitution and English as the floor |
| \`check()\` | asks every address whether it is there → \`{ ok, missing: [{ key, url, status }] }\` |
| \`onChange(fn)\` / \`destroy()\` | watch, and stop |

\`toPack()\` maps the manifest onto the pack shape: an image with a \`frames\` block becomes a
spritesheet, one without stays an image, atlases stay atlases, an audio pair keeps both
addresses, tilemaps are Tiled JSON, and a font carrying \`data\` becomes a bitmap font.

### The manifest

\`manifest({ app, version, base, images, atlases, audio, fonts, tilemaps, videos, texts })\`
validates and freezes. It stamps itself \`spec: 'aimeat.assets.manifest/v1'\`, so an agent that
finds the record knows how to read it. An image entry is
\`{ file, w, h, frames: { frameWidth, frameHeight, count }, bytes, licence, source, tags }\`; an
atlas is \`{ texture, data }\`.

A KEY is an address, not a sentence: lowercase letters and digits joined by a dash, a dot or a
slash. It is what a scene names when it draws, so it stays put while the file behind it is
replaced.

### Uploading, packing, exporting, showing

\`\`\`js
const put = await AIMEAT.assets.upload(blob, { app: 'ridge', kind: 'images' });   // → { key, url, bytes }
lib.add('images', 'hero', { file: put.url, w: 32, h: 40, bytes: put.bytes });
await lib.save();

const packed = await AIMEAT.assets.packAtlas([{ key: 'coin', src: coinBlob }], { maxSize: 1024 });
const wav = await AIMEAT.assets.sound.record((ctx, out) => { /* build a graph */ }, 0.25);
const gallery = AIMEAT.assets.preview('#library', lib, { check: true });
\`\`\`

- **\`upload(file, { app, key, kind, visibility, mime_type })\`** returns the \`/v1/pub/<owner>/<key>\`
  address, which is the anonymous read. \`visibility\` defaults to \`'public'\` and anything else
  is warned about at upload time rather than found later as a blank sprite.
- **\`packAtlas(images, { maxSize, padding, pot, name })\`** packs loose pictures into one sheet
  plus TexturePacker JSON, in the browser, and returns \`{ png, json, sheet }\`. \`src\` may be an
  image on the page, an ImageBitmap, a Blob or an address. Forty sprites become two requests.
- **\`sound.record(fn, seconds, sampleRate, channels)\`** renders a Web Audio graph offline and
  returns a WAV blob. \`sound.toWav(samples, sampleRate)\` is the writer on its own.
- **\`preview(target, library, { check, title })\`** draws the whole library as a gallery on the
  page's own colours, with the missing files marked when you ask for the check.

## Gotchas and Common Mistakes

1. **\`tiles()\` with no \`kinds\` makes nothing.** \`kinds\` is the list; \`size\` and \`prefix\`
   only describe them. This is the single most common wrong call.
2. **The generated key is \`prefix + kind\`, and the prefix defaults to empty.** So
   \`kinds: { ground: true }\` gives you \`ground\`, and \`platformer()\` looking for
   \`tile-ground\` will not find it: it draws its own plain rectangle instead, which is why the
   level still plays and the art is silently unused.
3. **A \`data:\` URI in a pack is dropped, not loaded.** The console says which entry and why.
4. **Call \`textures.*\` in \`create()\`, not \`preload()\`.** They draw with the scene's own
   graphics and the theme, both of which want the scene to exist.
5. **\`preloadPack\` from \`create()\` must be awaited.** From \`preload()\` you may ignore the
   promise, because the scene manager waits for the loader anyway.
6. **A failed file is not an exception.** If you need the level to refuse to start, read
   \`failed\` and decide; nothing throws for you.
7. **The progress bar is drawn at depth 9999 and scroll factor 0** and destroys itself on
   \`complete\`. Do not add your own on top; pass \`bar: false\` if you want to draw the loading
   screen yourself.
8. **An audio pair is two addresses for one sound**, not two sounds. \`{ coin: ['coin.mp3',
   'coin.ogg'] }\` registers one key that every browser between them can play.
9. **The manifest is saved PUBLIC and the save file is saved PRIVATE.** They are two records
   with opposite visibility, and it is not an oversight: a player who is signed out has to read
   the art list, and nobody but the player may read their save.
10. **\`/v1/storage/<key>\` is not an asset address.** It needs an Authorization header, so it
    works for the file's owner and for nobody else. Every manifest entry uses
    \`/v1/pub/<owner-ghii>/<key>\`, which is what \`upload()\` hands back.
11. **\`lib.save()\` needs \`aimeat-data.js\` on the page**, and says so in words when it is not
    there. Everything else in the asset library works without it.
12. **A manifest over 1024 kB is refused rather than written.** Split the app into two
    manifests, one per chapter, or move the long texts into their own record.
13. **A duplicate frame name in \`packAtlas()\` is refused**, because one of the two pictures
    would then be unreachable inside the sheet.
`,
};
