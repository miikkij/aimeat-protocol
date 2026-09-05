/**
 * @file public/atelier-ambient-demo.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ambient demo page's script (atelier-ambient-demo.html), external because the
 *   node's content-security policy refuses an inline script, the same way front-demo.js sits
 *   beside front-demo.html. One Atelier frame whose look decides its ambient, buttons that
 *   change the look and override the preset, a post chain over the frame's layer, one stage per
 *   preset, the effects on a block of words and on a picture, the moments on a cue, and attract
 *   mode armed at four seconds so the idle behaviour can be watched. window.demo carries the
 *   handles for the browser verification.
 * @usage  loaded by /atelier-ambient-demo.html
 * @version-history
 *   v1.1.0 — 2026-09-05 — The effects (wish-atelier-post-process-effects, stage 3): the three
 *     generators among the presets, a post row over the frame's layer, a still-effect row on a
 *     block of words, a picture with the picture effects and the moments on it.
 *   v1.0.0 — 2026-09-05 — Initial (wish-atelier-ambient-visuals, stage 4).
 */
(function () {
  const K = window.AIMEAT.atelier;
  const LOOKS = ['lounge', 'dawn', 'aurora', 'stage', 'terminal', 'neon-dense', 'broadcast', 'riso', 'editorial', 'vivid'];
  const PRESETS = ['waves', 'aurora', 'dust', 'grid', 'static', 'ink', 'plasma', 'lava', 'tunnel', 'none'];
  const POSTS = ['none', 'kaleidoscope', 'ripple', 'vhs', 'glitch'];
  const WORD_FX = ['none', 'scanlines', 'vignette', 'recolour'];
  const PICTURE_FX = ['none', 'duotone', 'distort', 'recolour', 'vignette', 'scanlines'];
  const MOMENTS = ['glitch', 'vhs', 'distort', 'ripple'];

  const a = K.app({
    title: 'Ambient',
    tagline: 'The one layer allowed to move at idle.',
    look: 'lounge',
    requireLogin: false,
    navItems: [{ id: 'home', label: 'Home' }, { id: 'stages', label: 'Stages' }],
  });

  K.hero({ target: a.main, title: 'The console at rest', sub: 'The look decides what moves behind the app; the weather switch and Less motion always win.' });

  /** The handles the browser verification reads, filled in as the page builds. */
  /** @type {any} */
  const demo = { fx: { words: null, picture: null }, lastPlayed: null };

  function row(target, ids, label, onPick, current) {
    const box = document.createElement('div');
    box.className = 'demo-row';
    box.setAttribute('data-demo', label);
    for (const id of ids) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ak-btn';
      b.textContent = id;
      b.setAttribute('data-' + label, id);
      b.setAttribute('aria-pressed', id === current ? 'true' : 'false');
      b.addEventListener('click', function () {
        for (const other of box.children) other.setAttribute('aria-pressed', other === b ? 'true' : 'false');
        onPick(id);
      });
      box.appendChild(b);
    }
    target.appendChild(box);
    return box;
  }

  const looks = K.section({ target: a.main, title: 'The look', hint: 'Each look names its own ambient, or none.' });
  row(looks.body, LOOKS, 'look', function (id) { a.set({ look: id, quiet: true }); }, 'lounge');

  // The frame's layer: the preset override and the post chain travel together, because the
  // frame's set({ ambient }) replaces the whole wish.
  const wish = { preset: null, post: [] };
  function applyWish() {
    a.set({ ambient: wish.preset === null && !wish.post.length ? null : { preset: wish.preset, post: wish.post } });
  }
  const presets = K.section({ target: a.main, title: 'Override', hint: 'An app may name a preset over the look; "look" hands the decision back.' });
  row(presets.body, PRESETS.concat(['look']), 'preset', function (id) {
    wish.preset = id === 'look' ? null : id;
    applyWish();
  }, 'look');

  const posts = K.section({ target: a.main, title: 'A post pass over the layer', hint: 'Living motion of an effect, behind the words: the layer folds, rolls, wears or tears its own field.' });
  row(posts.body, POSTS, 'post', function (id) {
    wish.post = id === 'none' ? [] : [id];
    applyWish();
  }, 'none');

  const words = K.section({ target: a.main, title: 'Words on the page' });
  const p = document.createElement('p');
  p.textContent = 'Body text sits on the page ground with the layer moving under it. The matrix proved this ink over every pigment the preset lays down, at the alpha the look set, in every palette and both modes.';
  words.body.appendChild(p);

  // The effects on a block of words: the ground volume, proven under body text.
  const wordFx = K.section({ target: a.main, title: 'An effect on the words', hint: 'Still effects a block may wear under its text; the matrix proved the ink at each one\'s default.' });
  const wordBox = document.createElement('div');
  wordBox.className = 'demo-fx-box';
  const wordLine = document.createElement('p');
  wordLine.textContent = 'A block of body text, with a secondary line under it and an accent word: the four inks the matrix maps through a colour effect.';
  const wordSub = document.createElement('p');
  wordSub.className = 'demo-fx-sub';
  wordSub.textContent = 'The secondary line, in dimmed ink.';
  wordBox.appendChild(wordLine);
  wordBox.appendChild(wordSub);
  let wordHandle = null;
  row(wordFx.body, WORD_FX, 'fx-words', function (id) {
    if (wordHandle) { wordHandle.destroy(); wordHandle = null; }
    if (id !== 'none') wordHandle = K.fx(wordBox, { id, params: id === 'recolour' ? { hue: 40 } : null });
    demo.fx.words = wordHandle;
  }, 'none');
  wordFx.body.appendChild(wordBox);

  // The effects on a picture: the prop volume, and the moments on a cue.
  const pictureFx = K.section({ target: a.main, title: 'An effect on a picture', hint: 'A picture takes the whole range; the moments play once and are gone on finished.' });
  const picture = document.createElement('div');
  picture.className = 'demo-fx-picture';
  picture.setAttribute('data-demo', 'picture');
  let pictureHandle = null;
  row(pictureFx.body, PICTURE_FX, 'fx-picture', function (id) {
    if (pictureHandle) { pictureHandle.destroy(); pictureHandle = null; }
    if (id !== 'none') {
      const params = id === 'vignette' ? { strength: 0.6 } : id === 'scanlines' ? { strength: 0.3 } : id === 'recolour' ? { hue: 120 } : null;
      pictureHandle = K.fx(picture, { id, params });
    }
    demo.fx.picture = pictureHandle;
  }, 'none');
  const moments = row(pictureFx.body, MOMENTS, 'moment', function (id) {
    demo.lastPlayed = K.fxPlay(picture, id);
  }, null);
  moments.setAttribute('aria-label', 'Play a moment on the picture');
  pictureFx.body.appendChild(picture);

  const stages = K.section({ target: a.main, title: 'One stage per preset', hint: 'A section can carry its own weather.' });
  const grid = document.createElement('div');
  grid.className = 'demo-stages';
  stages.body.appendChild(grid);
  const stageHandles = {};
  for (const id of PRESETS.slice(0, 9)) {
    const h = document.createElement('h3');
    h.className = 'demo-stage-title';
    h.textContent = id;
    stageHandles[id] = K.ambientStage({ target: grid, preset: id, minHeight: '180px', body: h });
  }

  const idle = K.attract({ app: a, after: 4000 });

  Object.assign(demo, { app: a, stages: stageHandles, attract: idle, kit: K, wish, picture, wordBox });
  /** @type {any} */ (window).demo = demo;
})();
