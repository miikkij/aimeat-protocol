/**
 * @file src/data/builtin-skills-games.saves-controls.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two of the seven game skills: `aimeat-phaser-saves` (one memory key per player, the
 *   guest-to-signed-in merge, the version gate and the public board) and
 *   `aimeat-phaser-controls-hud` (keyboard, gamepad and touch as one state, the HUD, the toast and
 *   the settings page).
 *
 *   THE SAVES SKILL CARRIES THE 1000-KEY RULE because that is the mistake this whole shape exists
 *   to prevent: a key per score fills a person's allowance inside a year, and the fix is not a
 *   bigger budget, it is one record.
 * @structure PHASER_SAVES_SKILL · PHASER_CONTROLS_HUD_SKILL
 * @usage import { PHASER_SAVES_SKILL, PHASER_CONTROLS_HUD_SKILL } from './builtin-skills-games.saves-controls.js';
 * @version-history
 *   v1.0.0 -- 2026-09-02 -- Initial, written against phaser/save.js, phaser/controls.js,
 *     phaser/hud.js and phaser/settings.js at aimeat-phaser 1.0.0.
 */
import type { BuiltinSkill } from './builtin-skills.js';

/** One memory key per player: the state, the merge, the version gate, the board. */
export const PHASER_SAVES_SKILL: BuiltinSkill = {
  name: 'aimeat-phaser-saves',
  visibility: 'public',
  skillMd: `---
name: aimeat-phaser-saves
description: "Saving a Phaser game on an AIMEAT node with AIMEAT.phaser.saves(): the whole save file as ONE private memory key, guest play in the browser merged in at sign-in, the version gate for an older file, levels unlocked and starred, the running score, settings, and the public leaderboard through a second key. Includes the 1000-keys-per-person rule that decides this shape. Triggers on: save, savegame, save file, high score, leaderboard, progress, unlock level, stars, inventory, settings persistence, guest, sign in merge, migration, tallennus, pisteet, ennätys, tulostaulu, kenttien avaus, edistyminen, vieras."
license: MIT
metadata:
  audience: agent
---

# Saving a game: one key per player

The whole save file is ONE private memory record and the board row is ONE public one. That is
not a convention, it is the budget: 1024 kB per value and 1000 keys per person, so a key per
score would fill a player's whole allowance inside a year of playing.

\`saves()\` works signed OUT. The file lives in the browser under \`ak.phaser.<key>\`, every
method behaves the same, nothing throws and nothing asks the player to sign in.

## Quick Start

\`\`\`js
const store = AIMEAT.phaser.saves({ app: 'ridge', version: 1 });
const state = await store.load();

store.levels.unlock('1-2');                 // true the first time
if (store.levels.best('1-1', 4200)) toast('New best');
store.score(50);                            // running total for this session
store.settings({ music: 0.4 });
await store.save();                         // writes collapse into one request

const top = await store.leaderboard({ limit: 10 });
\`\`\`

## Core Concepts

### The spec

| Field | Required | Meaning |
|---|---|---|
| \`app\` | yes | the key prefix, e.g. \`'ridge'\` |
| \`version\` | yes | the shape's version, for the gate below |
| \`key\` | no | the private key. Default \`app + '.save'\` |
| \`defaults\` | no | extra fields a fresh save starts with |
| \`migrate\` | no | \`(old, fromVersion) => newShape\` |
| \`public\` | no | \`(state) => object\`, the subset published to the board |

The public key is always \`app + '.score'\` and is not configurable.

### The state

\`\`\`js
{
  version: 1,
  profile: { name: '' },
  settings: {},
  levels: { '1-1': { unlocked: true, stars: 2, best: 4200 } },
  scores: [4200, 3800],       // the 20 best sessions, highest first
  inventory: {},
  // plus whatever the spec's defaults added
}
\`\`\`

Those six fields are always present: a stored file missing one gets it back on load. Anything
else you put there is kept and never removed.

### The surface

\`load()\` · \`get()\` · \`set(patch)\` · \`save()\` · \`levels\` · \`score\` · \`settings(patch?)\` ·
\`isGuest()\` · \`onChange(fn)\` · \`leaderboard({ limit })\` · \`destroy()\`.

- **\`levels\`**: \`unlock(id)\` returns true when it was closed until now; \`isUnlocked(id)\`;
  \`stars(id)\` reads and \`stars(id, n)\` records a better rating, returning whether it improved;
  \`best(id, score)\` returns whether it beat what was there; \`get(id)\` gives the record or null.
- **\`score(n)\`** adds to the running session total and returns it, raising the all-time
  \`best\` when the total passes it. \`score()\` with no argument just reports.
  **\`score.reset()\`** ends the run: the session total is filed under \`scores\` and the
  accumulator goes back to zero. It returns the score it just filed.
- **\`settings(patch)\`** merges and saves; \`settings()\` returns a COPY, so changing what you
  got back changes nothing.
- **\`onChange(fn)\`** fires on every change and returns the function that stops listening.

### The guest-to-signed-in merge

The first \`load()\` after a person signs in folds the browser copy into the node's copy. The
node's copy is the base, because that is the one the player has been building on their other
devices; the guest copy only ever RAISES something:

- \`levels\`: \`unlocked\` is a union, \`stars\` and \`best\` take the higher of the two.
- \`best\`: the higher.
- \`scores\`: both lists concatenated, sorted, the top 20 kept.
- \`settings\`, \`inventory\`, \`profile.name\`: the node's copy wins.

The guest copy is then cleared, so the merge happens exactly once.

### The version gate

- Same version: used as it is.
- Older: through \`migrate(old, fromVersion)\` when you gave one, then stamped with the new
  version. A \`migrate\` that throws is caught and the stored file is kept untouched.
- **Newer**: kept exactly as it is, with a warning, and NOT downgraded. A build that silently
  rewrites a newer save is how a player loses a season.

### The board

\`leaderboard({ limit })\` reads everyone's \`<app>.score\` records through
\`AIMEAT.data.search\` and returns rows of
\`{ owner, name, best, level, updated }\`, highest first. A page with no memory library gets an
empty list rather than an error, because a board is decoration and a game is not.

What goes in that public record is \`spec.public(state)\`. The default publishes
\`{ name, best, level, updated }\` and nothing else, so a save is never published wider than it
meant to be.

## Common Patterns

### A named player on the board

\`\`\`js
const store = AIMEAT.phaser.saves({ app: 'ridge', version: 1 });
await store.load();
if (!store.get().profile.name) store.set({ profile: { name: askedName } });
\`\`\`

### Publishing a level with the score

\`state.level\` is not one of the six named fields and the library never sets it. If you want
the board to show which level the best came from, set it yourself, or write your own subset:

\`\`\`js
const store = AIMEAT.phaser.saves({
  app: 'ridge', version: 2,
  public: (s) => ({ name: s.profile.name, best: s.best || 0, level: s.lastLevel || null, updated: new Date().toISOString() }),
});
\`\`\`

### Migrating a shape

\`\`\`js
AIMEAT.phaser.saves({
  app: 'ridge', version: 3,
  migrate(old, from) {
    if (from < 2) old.inventory = { keys: old.keys || 0 };
    return old;
  },
});
\`\`\`

### Ending a run

\`\`\`js
level.on('goal', async () => {
  const finished = store.score.reset();
  store.levels.best(currentLevel, finished);
  await store.save();
  const board = await store.leaderboard({ limit: 5 });
});
\`\`\`

## Events

| Call | Fires |
|---|---|
| \`onChange(fn)\` | on every change to the state, with the live state object |

There is no "saved" event. \`save()\` returns a promise that resolves when the write went out,
and every caller inside the same 300 ms window gets the same promise.

## Gotchas and Common Mistakes

1. **Never write \`AIMEAT.data.set\` for anything a save holds.** One key per score is the
   mistake this module exists to prevent: 1000 keys per person, and a schedule that writes
   \`keys_per_day × 365\` over 1000 has the wrong shape.
2. **\`load()\` before anything else.** \`get()\` before a load returns the empty default and
   your first \`set()\` will then be merged over it, not over the player's real file.
3. **\`get()\` hands back the LIVE object.** Read it; change it through \`set()\`, \`settings()\`
   or \`levels.*\` so the change is reported and written.
4. **\`score(n)\` is not \`hud.score(n)\`.** One adds to a total, the other displays a number.
   \`hud.score(store.score())\` is the pairing.
5. **\`score.reset()\` files nothing when the total is zero**, and returns 0.
6. **Writes are debounced by 300 ms.** Call \`save()\` on every pickup if you like; one request
   goes out. But a page that unloads inside that window loses the last burst, so \`await
   store.save()\` at a level end and call \`destroy()\` when you tear the game down: it flushes
   what is pending.
7. **The public row is only rewritten when the subset actually changed.** \`updated\` is left out
   of that comparison on purpose, or every save would publish a new row.
8. **\`leaderboard()\` filters by key.** The search matches on content, so a record that merely
   mentions your app is dropped by its key; do not widen that yourself.
9. **\`spec.storage\` is reserved.** Only \`'auto'\` is understood and nothing reads it today.
10. **Signed out is not an error state.** \`isGuest()\` tells you; use it to offer a sign-in, not
    to refuse play.
`,
};

/** Input as one state, the HUD, the toast and the DOM settings page. */
export const PHASER_CONTROLS_HUD_SKILL: BuiltinSkill = {
  name: 'aimeat-phaser-controls-hud',
  visibility: 'public',
  skillMd: `---
name: aimeat-phaser-controls-hud
description: "Input and the heads-up display for a Phaser 4 game on an AIMEAT node: AIMEAT.phaser.controls() folds keyboard, gamepad and an on-screen touch pad into one state per frame with press edges and rebinding; hud() and toast() draw score, lives, level, timer and a passing message on the page's own colours; settingsPanel() is the DOM settings page. Triggers on: input, controls, keyboard, arrow keys, WASD, gamepad, joystick, touch controls, virtual joystick, rebind, key bindings, HUD, score display, lives, timer, toast, settings page, näppäimet, ohjaimet, peliohjain, kosketusohjaus, näppäinasetukset, pistenäyttö, asetukset."
license: MIT
metadata:
  audience: agent
---

# One input state, and what shows on top of the game

## Quick Start

\`\`\`js
function create() {
  this.c = AIMEAT.phaser.controls(this, { touch: 'auto' });
  this.hud = AIMEAT.phaser.hud(this, { lives: 3, level: 'Ridge 1-1' });
  this.c.on('pause', () => AIMEAT.phaser.pauseMenu(this, { controls: this.c }));
}
function update() {
  this.c.update();                       // read the frame FIRST
  if (this.c.left) player.x -= 3;
  if (this.c.justPressed('jump')) jump();
  player.x += this.c.axis.x * 3;          // the analog version of the same thing
}
AIMEAT.phaser.toast(this, 'Checkpoint reached', { tone: 'ok' });
\`\`\`

## Core Concepts

### The seven actions

\`left\` \`right\` \`up\` \`down\` \`jump\` \`action\` \`pause\`, plus \`axis: { x, y }\` running
-1 to 1. Whatever the player is holding, a scene reads \`c.left\` and never asks which device
said so.

The default scheme, as Phaser key names:

| Action | Keys |
|---|---|
| left | \`LEFT\`, \`A\` |
| right | \`RIGHT\`, \`D\` |
| up | \`UP\`, \`W\` |
| down | \`DOWN\`, \`S\` |
| jump | \`SPACE\`, \`UP\`, \`W\` |
| action | \`X\`, \`K\`, \`ENTER\` |
| pause | \`ESC\`, \`P\` |

### The options

| Option | Default | Meaning |
|---|---|---|
| \`keyboard\` | true | read the keys at all |
| \`wasd\` | true | keep the letter keys in the scheme; false drops W, A, S and D from every action |
| \`gamepad\` | true | read a connected pad; see the gotcha below |
| \`touch\` | \`'auto'\` | \`'auto'\` shows the overlay on a coarse pointer, \`true\` always, \`false\` never |
| \`scheme\` | the table above | \`{ jump: ['SPACE', 'Z'] }\` replaces just that action |
| \`touchTarget\` | the canvas's parent | where the overlay mounts |
| \`deadZone\` | 0.2 | stick travel that counts as nothing |

### The surface

\`update()\` · \`justPressed(name)\` · \`on(name, fn)\` · \`rebind(name, keys)\` · \`bindings()\` ·
\`showTouch(on)\` · \`vibrate(ms)\` · \`destroy()\`.

\`update()\` is the whole contract: it reads the keyboard, the pad and the overlay, folds them
into the state, and works out which actions were pressed on THIS frame. The booleans are a
snapshot, so read them after the call and never before it.

\`justPressed(name)\` and the \`on(name, fn)\` handlers are exactly one frame wide, and both
depend on \`update()\` having run.

\`vibrate(ms)\` returns whether anything happened, so pair a buzz with something visible rather
than relying on it.

### The touch overlay

A stick pad on the left and two round buttons (Jump, Act) on the right, mounted over the
canvas as ordinary DOM and dressed by the library's stylesheet on the page's own colours. Only
the parts themselves take pointer events, so a tap between them still reaches the game, and
each part sets \`touch-action: none\` so dragging the stick never scrolls the page behind it.

Whether it SHOWS is a stylesheet question: the module writes \`data-ak-touch="auto|on|off"\`
and the media query answers \`auto\`, so a device that changes its pointer mid-session needs
nothing re-run.

A quick tap that arrives and leaves between two frames is latched and still counts for exactly
one frame, never for two.

### hud(scene, opts)

Score top left in the display face, lives under it as drawn hearts, level and clock top right.
Everything rides the camera at \`setScrollFactor(0)\` and a high depth, so it stays put while
the level scrolls under it.

| Option | Meaning |
|---|---|
| \`score\` \`lives\` \`level\` \`time\` | starting values |
| \`depth\` | default 900 |
| \`pad\` | the inset, default 14 |
| \`themeFrom\` | the element whose colours dress it |

Methods: \`score(v)\` · \`lives(n)\` · \`level(text)\` · \`time(seconds)\` (shown as \`m:ss\`) ·
\`message(text, ms)\` · \`set({ score, lives, level })\` · \`destroy()\`.

A figure that CHANGES gets one short scale pop and stops. Nothing animates while the game sits
still.

### toast(scene, text, opts)

One line up the middle: it arrives, holds, rises and fades away, removing itself.
\`{ ms, y, depth, rise, tone, themeFrom }\`, where \`tone\` is \`'ok'\`, \`'warn'\` or \`'err'\` and
decides the pill's edge colour. Returns the container, in case you want it gone sooner.

### settingsPanel(spec)

The settings page as DOM beside the canvas, on the Atelier kit's own form when the page has
the kit and on the same class names when it does not.

\`\`\`js
const panel = AIMEAT.phaser.settingsPanel({
  target: '#settings',
  audio: bus, controls: c, saves: store, game: h,
  sections: ['audio', 'display', 'controls', 'motion'],   // the default, and the order
});
panel.refresh();   // re-read every control from the game
panel.destroy();
\`\`\`

Sound (three sliders and a mute), Display (fullscreen), Controls (the on-screen pad switch and
a rebind row per action), Motion (less motion), plus Reset to defaults. Every change lands
immediately and is written through \`saves.settings()\`; there is no Save button, because a
volume slider you have to confirm is a slider that lies to you.

Rebinding arms a ONE-SHOT key listener: the next key is taken, the listener is gone whatever
happens, and Escape leaves the binding as it was. A rebind REPLACES the whole list for that
action, because the person pressed one key and expects that key to be the answer.

## Events

| Call | Fires |
|---|---|
| \`c.on('jump', fn)\` | on the press edge, during \`c.update()\` |
| \`scene.scale.on('resize', …)\` | the HUD already listens and re-lays out its right-hand column |

## Gotchas and Common Mistakes

1. **The gamepad needs \`input: { gamepad: true }\` in the Phaser game config, and
   \`AIMEAT.phaser.game()\` has no option for it.** Without that key Phaser never starts its
   gamepad plugin, \`scene.input.gamepad\` is undefined, and \`controls()\` runs on keyboard and
   touch alone with no error. If a pad is required, build the \`Phaser.Game\` yourself with that
   key set; everything else in this library works the same on it.
2. **A Phaser 4 gamepad axis is an OBJECT, not a number.** \`pad.axes[0].getValue()\` is the
   reading; \`pad.axes[0]\` used as a number is \`NaN\`. \`pad.leftStick\` is the shortcut where
   it exists, and the library tries it first.
3. **Read after \`update()\`, once per frame.** Calling \`update()\` twice in a frame eats the
   press edges: the second call sees the same button already held and reports no press.
4. **\`justPressed\` needs \`update()\`.** A handler that checks it from a timer or a pointer
   callback reads last frame's answer.
5. **Rebinding to a key name Phaser does not know is dropped with a warning**, and the action
   is then unbound. The names are Phaser's own: \`SPACE\`, \`ENTER\`, \`ESC\`, \`LEFT\`, \`ONE\`.
   Digits are spelled out.
6. **\`showTouch(on)\` only SETS.** Nothing reads the overlay's state back, which is why the
   settings panel remembers its own answer for that switch. Do not treat it as a getter.
7. **The touch switch in the settings panel is remembered but not applied on load.** The switch
   comes back showing what the player chose; the overlay itself starts wherever \`controls()\`
   put it. Call \`c.showTouch(store.settings().touch)\` after boot if you want the two to agree.
8. **Less motion is saved but not restored.** The panel writes \`motion: 'less'\` into the save
   and reads the setting back off the document, so apply it yourself on boot.
9. **\`controls().destroy()\` gives the keys back.** Two live controls handles on one scene both
   add the same keys and the first \`destroy()\` removes them from under the second.
10. **\`hud.time()\` takes SECONDS, not milliseconds**, and formats them as \`m:ss\`.
11. **The HUD is per scene.** Restarting the scene destroys it; build it in \`create()\`.
`,
};
