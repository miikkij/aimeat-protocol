/**
 * @file public/atelier-ambient-demo.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ambient demo page's script (atelier-ambient-demo.html), external because the
 *   node's content-security policy refuses an inline script, the same way front-demo.js sits
 *   beside front-demo.html. One Atelier frame whose look decides its ambient, buttons that
 *   change the look and override the preset, one stage per preset, and attract mode armed at
 *   four seconds so the idle behaviour can be watched. window.demo carries the handles for the
 *   browser verification.
 * @usage  loaded by /atelier-ambient-demo.html
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (wish-atelier-ambient-visuals, stage 4).
 */
(function () {
  const K = window.AIMEAT.atelier;
  const LOOKS = ['lounge', 'dawn', 'aurora', 'stage', 'terminal', 'neon-dense', 'broadcast', 'riso', 'editorial', 'vivid'];
  const PRESETS = ['waves', 'aurora', 'dust', 'grid', 'static', 'ink', 'none'];

  const a = K.app({
    title: 'Ambient',
    tagline: 'The one layer allowed to move at idle.',
    look: 'lounge',
    requireLogin: false,
    navItems: [{ id: 'home', label: 'Home' }, { id: 'stages', label: 'Stages' }],
  });

  K.hero({ target: a.main, title: 'The console at rest', sub: 'The look decides what moves behind the app; the weather switch and Less motion always win.' });

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

  const presets = K.section({ target: a.main, title: 'Override', hint: 'An app may name a preset over the look; "look" hands the decision back.' });
  row(presets.body, PRESETS.concat(['look']), 'preset', function (id) {
    a.set({ ambient: id === 'look' ? null : id });
  }, 'look');

  const words = K.section({ target: a.main, title: 'Words on the page' });
  const p = document.createElement('p');
  p.textContent = 'Body text sits on the page ground with the layer moving under it. The matrix proved this ink over every pigment the preset lays down, at the alpha the look set, in every palette and both modes.';
  words.body.appendChild(p);

  const stages = K.section({ target: a.main, title: 'One stage per preset', hint: 'A section can carry its own weather.' });
  const grid = document.createElement('div');
  grid.className = 'demo-stages';
  stages.body.appendChild(grid);
  const stageHandles = {};
  for (const id of PRESETS.slice(0, 6)) {
    const h = document.createElement('h3');
    h.className = 'demo-stage-title';
    h.textContent = id;
    stageHandles[id] = K.ambientStage({ target: grid, preset: id, minHeight: '180px', body: h });
  }

  const idle = K.attract({ app: a, after: 4000 });

  /** @type {any} */ (window).demo = { app: a, stages: stageHandles, attract: idle, kit: K };
})();
