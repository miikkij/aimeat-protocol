/**
 * @file src/data/app-templates/game-shell.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The GAME shell template body: the Atelier shell with a Phaser 4 game inside it,
 *   built on the served aimeat-phaser base (/v1/libs/aimeat-phaser.js). A builder forks this and
 *   gets a title screen, a playable level from an ASCII map, a pause menu, a settings page, a save
 *   record and a public leaderboard already wired together, so the work left is the map, the words
 *   and the look rather than the plumbing.
 *
 *   IT LIVES IN ITS OWN FILE rather than in shells.ts because the body is long: the four classic
 *   shells are twenty lines of head plus a boot, this one is a whole small game, and shells.ts is
 *   already at 332 lines against the 800-line cap.
 *
 *   THE COMMENTS IN THE BODY ARE THE PRODUCT. Each one says either REPLACE (the map, the world's
 *   words, the colours) or KEEP (the physics: audio only after a gesture, one save key per player,
 *   no CDN, generated textures unless a pack is declared). A builder who reads nothing else still
 *   ships a game that behaves.
 * @structure SHELL_PHASER_GAME
 * @usage  import { SHELL_PHASER_GAME } from './app-templates/game-shell.js';
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial: the shell-phaser-game template (Atelier shell + aimeat-phaser).
 */

// ── The GAME shell (Atelier track) ───────────────────────────────────
// Atelier's app shell carries the bar, the sign-in pill and the designed states; aimeat-phaser
// carries everything a Phaser game otherwise re-guesses. The app between them is the map, the
// words and the look. {{app}} is the memory namespace, replaced when the template is forked.

export const SHELL_PHASER_GAME = `<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: {{app}}
version: 1.0.0
description: {{one-line description, REQUIRED for publishing}}
entry: index.html
-->
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content" />
  <meta name="aimeat-app" content="{{app}}.html" />
  <meta name="aimeat-track" content="atelier" />
  <meta name="aimeat-scopes" content="memory:read memory:write" />
  <meta name="aimeat-locales" content="en" />
  <title>{{Game Title}}</title>
  <!-- The kit first, then the game's own frame and controls: both read the same --ak-* tokens,
       so the canvas wears whatever look, palette and light/dark mode the page is wearing. -->
  <link href="/lib/aimeat-atelier.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-phaser.css" rel="stylesheet" type="text/css" />
  <script src="/lib/aimeat-boot.js"></script>
</head>
<body>
  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <script src="/v1/libs/aimeat-atelier.js"></script>
  <!-- KEEP: this loads the engine itself from THIS node on first use. Never link a CDN: a game
       that fetches phaser from the internet stops working on a private node, and the node's own
       copy is the version everything else here was proven against. -->
  <script src="/v1/libs/aimeat-phaser.js"></script>
  <script>
    var K = AIMEAT.atelier;
    var P = AIMEAT.phaser;

    /* ─────────────────────────────────────────────────────────────────────────────────────
       REPLACE: the world's words. Everything a player reads is in these five lines.
       ───────────────────────────────────────────────────────────────────────────────────── */
    var APP = '{{app}}';                       // the memory namespace; the save is {{app}}.save
    var TITLE = 'RIDGE RUN';
    var SUB = 'a night on the ridge';
    var FOOTER = 'Arrows or WASD to move, Space to jump, Escape to pause.';
    var LOOK = 'broadcast';                    // vivid | poster | terminal | stage | riso | ...

    /* ─────────────────────────────────────────────────────────────────────────────────────
       REPLACE: the levels. One ASCII map per level, and the map IS the level format: twelve
       lines of text you can read, diff and edit without a tool.
         #  ground      =  brick        ^  spike       o  coin
         E  enemy       P  spawn        G  goal        .  nothing
       Any extra mark you name in a legend becomes a solid tile of its own kind.
       ───────────────────────────────────────────────────────────────────────────────────── */
    var LEVELS = [
      {
        name: 'The ridge',
        map: [
          '..........................',
          '..........................',
          '.....o....................',
          '....====..........o.......',
          '..........o......====.....',
          '.........====.............',
          '..o.......................',
          '.===........E.........o...',
          '..........=====......===..',
          'P.....o...........^^....G.',
          '##########################',
          '##########################',
        ],
      },
      {
        name: 'The quarry',
        map: [
          '..........................',
          '.....o....o....o..........',
          '....===..===..===.........',
          '..........................',
          '..o...............o.......',
          '.===.....E......====......',
          '.........=====............',
          '......o..............o....',
          '....====....^^^.....===...',
          'P..........======......G..',
          '#######.......############',
          '#######.......############',
        ],
      },
    ];

    /* ─────────────────────────────────────────────────────────────────────────────────────
       KEEP: ONE memory key per player. Not one per score and not one per level. The node
       allows a thousand keys per person, so a key per run fills a player's whole allowance
       inside a year of playing. This single record holds the profile, the settings, every
       level's unlock and best, and the recent scores. It works signed out, keeping the file
       in this browser, and merges that guest file into the person's own memory once, the
       first time they sign in.
       ───────────────────────────────────────────────────────────────────────────────────── */
    var store = P.saves({
      app: APP,
      version: 1,
      defaults: { levels: { l0: { unlocked: true } } },
    });

    var handle = null;   // the booted game
    var bus = null;      // the sound bus
    var pad = null;      // the live scene's control state, for the settings page
    var at = 0;          // which level is being played

    /* The shell: the bar with the sign-in pill, the light/dark and less-motion controls, and
       the designed loading / empty / error states. KEEP requireLogin false: that is what makes
       this a game rather than a form. It plays immediately, asks for nothing, and the save
       follows the person into their own memory whenever they decide to sign in. */
    var a = K.app({
      title: TITLE,
      tagline: SUB,
      look: LOOK,
      requireLogin: false,
      footer: FOOTER,
      onReady: function () { boot(); },
    });

    var started = false;
    function boot() {
      // onReady runs again when someone signs in mid-game: that second load is the merge.
      if (started) { store.load(); return; }
      started = true;
      a.status('loading', { title: 'Loading' });
      store.load().then(startGame, function (err) {
        a.status('error', {
          title: 'The game could not start',
          hint: String((err && err.message) || err),
          onRetry: function () { started = false; boot(); },
        });
      });
    }

    function startGame() {
      a.status('none');

      /* The title screen is a SCENE CONFIG, so it goes into the scenes array like any other
         scene and nothing is built until Phaser starts it. Three doors: play, change the
         settings, look at the board. An item with a scene name moves there; an item with an
         onPick runs your code. */
      var title = P.titleScene({
        key: 'title',
        title: TITLE,
        sub: SUB,
        motion: 'stagger',        // stagger | slide | zoom | typewriter
        titleMotion: 'kinetic',   // drop | kinetic | typewriter
        backdrop: 'stars',        // grid | stars | none
        version: 'v1.0',
        items: [
          { label: 'Play', scene: 'play' },
          { label: 'Settings', onPick: function () { openSettings(); } },
          { label: 'Leaderboard', onPick: function () { openBoard(); } },
        ],
      });

      P.game({
        parent: a.main,
        width: 960,
        height: 540,
        scale: 'fit',            // KEEP: the design size letterboxes into whatever room there is
        fullscreen: 'button',    // KEEP: the kit's button in the frame's corner; Escape leaves
        pauseOnHide: true,       // KEEP: the loop sleeps while the tab is hidden
        physics: 'arcade',
        gravity: { y: 900 },
        pixelArt: true,
        scenes: [title, { key: 'play', create: createPlay }],
      }).then(function (h) {
        handle = h;
        bus = P.audio(h.game);
        bus.apply(store.settings());
        /* KEEP: a browser makes no sound until a person has clicked, tapped or typed, and a bus
           that queues everything up for later plays it all at once when the lock lifts. So the
           unlock happens on the first real gesture and never before. */
        var unlock = function () { if (bus) bus.unlock(); };
        h.frame.addEventListener('pointerdown', unlock, { once: true });
        window.addEventListener('keydown', unlock, { once: true });
      }, function (err) {
        a.status('error', { title: 'The game could not start', hint: String((err && err.message) || err) });
      });
    }

    /* The play scene. Everything in here is the example level: replace the body, keep the shape. */
    function createPlay() {
      var scene = this;
      var level = LEVELS[at];

      /* KEEP: the art is GENERATED, so the game runs with no files at all and the page carries
         no base64. When you have real art, declare a pack instead and delete these two lines:
           var art = P.pack({ id: 'art', base: '/v1/pub/<owner>/{{app}}/', images: { sky: 'sky.png' } });
           preload: function () { P.preloadPack(this, art); }
         A data: URI is refused by the pack on purpose: it is paid for on every load, forever. */
      P.textures.tiles(scene, { size: 32 });
      P.textures.character(scene, { key: 'hero' });

      pad = P.controls(scene, { touch: 'auto', gamepad: true });
      var hud = P.hud(scene, { lives: 3 });
      hud.level(level.name);
      hud.score(0);

      var score = 0;
      var lvl = P.platformer(scene, {
        map: level.map,
        tile: 32,
        controls: pad,
        camera: 'follow',
        parallaxBackdrop: true,
        player: { speed: 220, jump: 440 },   // REPLACE: how your character feels
      });

      lvl.on('coin', function (n) {
        score = n * 10;
        hud.score(score);
        if (bus) bus.synth('coin');   // the coin sound: a synth voice, no file to ship
      });
      lvl.on('die', function () { if (bus) bus.synth('hit'); });
      lvl.on('goal', function () {
        if (bus) bus.synth('win');
        // KEEP: the best per level goes into the one save record, written once, at the goal.
        var improved = store.levels.best('l' + at, score);
        store.levels.unlock('l' + (at + 1));
        store.score(score);
        store.save();
        P.toast(scene, improved ? 'New best: ' + score : 'Finished: ' + score);
        scene.time.delayedCall(900, function () {
          at = (at + 1) % LEVELS.length;
          P.transition(scene, 'play', { kind: 'wipe' });
        });
      });

      // The pause menu opens over the running scene. Escape and the pad's pause both reach it.
      pad.on('pause', function () {
        P.pauseMenu(scene, {
          controls: pad,
          onSettings: function () { openSettings(); },
          onQuit: function () { P.transition(scene, 'title', { kind: 'iris', colour: 'accent' }); },
        });
      });

      scene.events.on('update', function () { pad.update(); lvl.update(); });
    }

    /* KEEP: a side panel is a DOM dialog and the game still hears the keyboard behind it, because
       Phaser listens on the window rather than on the canvas. So the game's keys are switched off
       while a panel is open and back on when it closes. Sleeping the whole loop instead looks
       like it works and is not: the keys pressed while it slept are delivered in a burst on the
       wake, and the menu behind the panel acts on every one of them. */
    function holdKeys(on) {
      var kb = handle && handle.game && handle.game.input ? handle.game.input.keyboard : null;
      if (kb) kb.enabled = !on;
    }

    /* KEEP: a panel opened from an in-canvas menu opens on the NEXT tick, never inside the key
       press that asked for it. A modal dialog focuses its first control, and the browser then
       hands that same Enter to it as a click: the panel opened and shut in two frames, which
       looks exactly like a menu item that does nothing. */
    function openPanel(spec) {
      var d = K.drawer(spec);
      holdKeys(true);
      setTimeout(function () { d.open(); }, 0);
      return d;
    }

    /* The settings page is DOM in a side panel, not another in-canvas menu: a slider, a switch
       and a rebind button are controls the browser and every assistive technology already
       understand. There is no Save button because every change lands at once, on the bus and in
       the save record, under the same field names the bus reports. */
    function openSettings() {
      var panel = null;
      var d = openPanel({
        side: 'right',
        title: 'Settings',
        body: function (host) {
          panel = P.settingsPanel({ target: host, audio: bus, controls: pad, saves: store, game: handle });
        },
        onClose: function () {
          if (panel) panel.destroy();
          holdKeys(false);
          d.destroy();
        },
      });
    }

    /* The board reads every player's public score record. The save itself stays private: only
       the small subset the store publishes (name, best, level) is ever readable by anyone else. */
    function openBoard() {
      var d = openPanel({
        side: 'right',
        title: 'Leaderboard',
        body: function (host) {
          host.appendChild(K.el('p', { class: 'ak-section__hint' }, store.isGuest()
            ? 'You are playing as a guest, so this browser is keeping your best. Sign in from the bar and it moves into your own memory, and your name joins the board.'
            : 'Your best is on the board.'));
          var rows = K.list({ target: host, items: [], empty: { title: 'Nobody on the board yet' } });
          store.leaderboard({ limit: 10 }).then(function (top) {
            rows.set({ items: (top || []).map(function (r, i) {
              return { id: String(i), title: r.name || r.owner || 'Player', meta: String(r.best) };
            }) });
          }, function () { /* a board nobody can read is an empty board, never a broken screen */ });
        },
        onClose: function () {
          holdKeys(false);
          d.destroy();
        },
      });
    }
  </script>
</body>
</html>`;
