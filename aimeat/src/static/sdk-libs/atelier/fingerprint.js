/**
 * @file atelier/fingerprint.js
 * @description The fingerprint: what kind of material an item is and how far it can be trusted,
 *   seen before it is read. The node's `profile` step labels each section of a text (its kind of
 *   text, what it rests on, how firmly it is stated, its topic and six directions it leans), and
 *   this component draws that profile the one way every surface draws it: a seal (genre shares as a
 *   ring, the leaning as a shape), a barcode (one stripe per section, as wide as its words, as tall
 *   as its certainty, with the marks + ~ ? x under it and the topics under those), a trust bar,
 *   three quadrant views with four named zones, and the lines a chat would show.
 *
 *   ONE TOPIC LIGHTS UP EVERYWHERE. Pointing at a stripe, a topic band or a bubble keeps that
 *   topic's stripes, band and bubble lit and dims the rest, and the seal shows only that genre's
 *   arc and that topic's own shape over the whole item's shape (dashed), so a reader sees whether
 *   that part is weaker or stronger than the whole. Pointing at the seal opens its card: the seal
 *   large with its axis words, the genre shares and the six axes as sliders.
 *
 *   IT RENDERS; IT DOES NOT FETCH. The app reads the profile itself and hands it over (see @usage).
 *   Nothing moves on its own: the dimming is a short opacity change the viewer's reduced-motion
 *   setting turns off, and an idle fingerprint repaints zero times.
 *
 *   VIEWS. 'panel' (everything, for an opened document), 'row' (seal, title, kind and a thin
 *   barcode with marks, for a list), 'seal' and 'barcode' alone.
 * @parts fingerprint root · head · title · meta · sealBox · seal · barcodeBox · barcode · stripe · topicBand · trust · trustLegend · tag · grids · gridCard · gridName · gridPick · grid · bubble · leaning · gridLeaning · card · tip · extra · empty
 * @slots fingerprint title() · meta() · extra()
 * @variants fingerprint dense · plain
 * @tokens fingerprint --ak-fp-F · --ak-fp-A · --ak-fp-M · --ak-fp-O · --ak-fp-P · --ak-fp-K · --ak-fp-x · --ak-fp-zone · --ak-fp-dim
 * @fork fingerprint Copy fingerprint-draw.js's functions and .ak-fp* out of fingerprint.css and draw the profile yourself; you keep the drawing and give up the topic highlight across the parts, the seal focus, the hover card and the words in three languages.
 * @structure fingerprint(spec) → { el, set, destroy } · FINGERPRINT_SAMPLE
 * @usage
 *   // The app's grant needs storage:read and memory:read; the item is the app's own or the person's.
 *   var r = await session.fetch('/v1/content/facts?kind=memory&key=' + encodeURIComponent(key) + '&with_profile=true');
 *   var d = (await r.json()).data;
 *   var fp = AIMEAT.atelier.fingerprint({ target: host, view: 'panel',
 *     data: { profile: d.facts.profile, sections: d.profile_sections, title: 'Report' },
 *     onSection: function (n) { scrollToSection(n); } });
 *   fp.set({ data: next });
 * @version-history
 *   v0.69.0 — 2026-11-02 — Initial (wish-aineiston-sormenj-lki-millaista-aineisto-on-yhdell-silm-ykse).
 */
import { el, clear, resolve, reducedMotion } from './dom.js';
import { applyVariant, slotInto } from './parts-model.js';
import { emptyState } from './state.js';
import { tf } from './fingerprint-i18n.js';
import {
  normalize, sealSvg, barcodeSvg, trustBar, gridSvg, sealCard, tagLines, sectionTip, zoneName, DEFAULT_GRIDS, AXES,
} from './fingerprint-draw.js';

const VARIANTS = ['dense', 'plain'];
const VIEWS = ['panel', 'row', 'seal', 'barcode'];

/** A research report as the node profiles one: the sample state and the Design Book's preview. */
export const FINGERPRINT_SAMPLE = {
  title: 'Kaukolämmön hintatutkimus 2026',
  profile: {
    v: 1, prompt: 'profile-4', model: 'deepseek/deepseek-pro-latest', at: '2026-11-02T12:00:00.000Z', kind: 'tutkimusraportti',
    topics: [
      { name: 'Hintakehitys', share: 0.37, genre: 'F', mark: '+', axes: { fakta: 0.9, konkr: 0.8, aika: -0.6, toim: -0.6, yks: 0.8, varm: 0.85 } },
      { name: 'Kilpailutilanne', share: 0.47, genre: 'A', mark: '+', axes: { fakta: 0.6, konkr: 0.4, aika: -0.1, toim: -0.3, yks: 0.2, varm: 0.6 } },
      { name: 'Kuluttajien kokemus', share: 0.06, genre: 'K', mark: '~', axes: { fakta: 0.1, konkr: 0.8, aika: -0.3, toim: -0.4, yks: 0.5, varm: 0.4 } },
      { name: 'Suositukset', share: 0.1, genre: 'P', mark: '~', axes: { fakta: -0.1, konkr: 0.2, aika: 0.7, toim: 0.8, yks: -0.4, varm: 0.3 } },
    ],
    sections: [['F', 200, 0.9, '+', 0], ['F', 150, 0.9, '+', 0], ['A', 220, 0.8, '+', 1], ['F', 180, 0.9, '+', 0], ['A', 250, 0.75, '+', 1],
      ['K', 80, 0.7, '~', 2], ['A', 200, 0.7, '+', 1], ['M', 90, 0.5, '~', 3], ['P', 60, 0.6, '~', 3]],
    axes: { fakta: 0.62, konkr: 0.57, aika: -0.17, toim: -0.25, yks: 0.38, varm: 0.68 },
  },
  sections: [
    { n: 1, heading: 'Hinnat 2015–2026', claim: 'Keskihinta nousi 38 % kymmenessä vuodessa.' },
    { n: 2, heading: 'Alueelliset erot', claim: 'Kallein kunta maksaa kaksi kertaa halvimman hinnan.' },
    { n: 3, heading: 'Markkinan rakenne', claim: 'Neljässä kunnassa viidestä on vain yksi toimittaja.' },
    { n: 4, heading: 'Hinnan osat', claim: 'Perusmaksun osuus kasvoi 22 prosentista 31 prosenttiin.' },
    { n: 5, heading: 'Kilpailun vaikutus', claim: 'Kahden toimittajan alueilla hinta on 12 % alempi.' },
    { n: 6, heading: 'Asukkaiden kertomuksia', claim: 'Kolme kotitaloutta kertoo, että lasku yllätti.' },
    { n: 7, heading: 'Vertailu Ruotsiin', claim: 'Ruotsissa hintavalvonta hillitsi nousua.' },
    { n: 8, heading: 'Tutkijoiden näkemys', claim: 'Hinnoittelun pitäisi olla avoimempaa.' },
    { n: 9, heading: 'Suositukset', claim: 'Hintavalvonta ja julkinen hintavertailu.' },
  ],
};

/**
 * The fingerprint.
 * @param {{
 *   target?: string|Element, variant?: string, view?: 'panel'|'row'|'seal'|'barcode', sample?: boolean,
 *   data?: { profile: any, sections?: any[], title?: string, age?: number }|null,
 *   grids?: Array<[string, string]>, fade?: 'none'|'age', meta?: string,
 *   onSection?: (n: number) => void,
 *   empty?: { title?: string, hint?: string },
 *   parts?: { title?: any, meta?: any, extra?: any },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data?: any, view?: string, grids?: Array<[string, string]> }) => void, destroy: () => void }}
 */
export function fingerprint(spec) {
  const s = spec || {};
  const root = el('div', { class: 'ak-root ak-fp', 'data-ak-part': 'root' });
  applyVariant(root, s, VARIANTS);
  if (s.target) resolve(s.target).appendChild(root);
  let data = s.sample === true ? FINGERPRINT_SAMPLE : (s.data || null);
  let view = VIEWS.indexOf(String(s.view)) >= 0 ? String(s.view) : 'panel';
  let grids = (s.grids && s.grids.length ? s.grids : DEFAULT_GRIDS).map(function (g) { return [g[0], g[1]]; });
  let P = null;
  let lit = '';
  let emptyCard = null;
  let destroyed = false;
  const tip = el('div', { class: 'ak-fp__tip', 'data-ak-part': 'tip', role: 'tooltip', hidden: true });

  function sealSize() { return view === 'panel' ? 130 : view === 'row' ? 48 : 56; }

  function drawSeal(box, focus) {
    clear(box);
    box.appendChild(sealSvg(P, sealSize(), { labels: view === 'panel', focus: focus }));
  }

  function gridCard(i) {
    const xy = grids[i];
    const key = xy[0] + '|' + xy[1];
    const named = tf('grid.' + key);
    const pick = function (axis) {
      const sel = /** @type {HTMLSelectElement} */ (el('select', { class: 'ak-fp__select', 'data-ak-part': 'gridPick', 'aria-label': tf(axis === 0 ? 'x' : 'y') },
        AXES.map(function (k) { return el('option', { value: k, selected: k === xy[axis], text: tf('axis.' + k + '.lo') + ' ↔ ' + tf('axis.' + k + '.hi') }); })));
      sel.addEventListener('change', function () {
        xy[axis] = sel.value;
        if (xy[0] === xy[1]) xy[1 - axis] = AXES.filter(function (k) { return k !== sel.value; })[0];
        render();
      });
      return el('label', { class: 'ak-fp__pick' }, [el('span', { text: tf(axis === 0 ? 'x' : 'y') }), sel]);
    };
    const ax = function (k) { return Math.max(-1, Math.min(1, Number(P.axes[k]) || 0)); };
    return el('div', { class: 'ak-fp__gridcard', 'data-ak-part': 'gridCard' }, [
      el('div', { class: 'ak-fp__gridname', 'data-ak-part': 'gridName', text: named.indexOf('grid.') === 0 ? tf('grid.own') : named }),
      el('div', { class: 'ak-fp__picks' }, [pick(0), pick(1)]),
      gridSvg(P, xy[0], xy[1]),
      el('div', { class: 'ak-fp__gridleaning', 'data-ak-part': 'gridLeaning' },
        [tf('leaning') + ': ', el('b', { text: zoneName(xy[0], xy[1], ax(xy[0]), ax(xy[1])) })]),
    ]);
  }

  function head(withMeta) {
    const h = el('div', { class: 'ak-fp__head', 'data-ak-part': 'head' });
    slotInto(h, s, 'title', P.title || null, { tag: 'div', cls: 'ak-fp__title' });
    if (withMeta) {
      const own = [P.kind, s.meta].filter(Boolean).join(' · ');
      slotInto(h, s, 'meta', own || null, { tag: 'div', cls: 'ak-fp__meta' });
    }
    return h;
  }

  function render() {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    lit = '';
    P = normalize(data);
    root.setAttribute('data-ak-view', view);
    root.removeAttribute('data-ak-age');
    if (!P) {
      const e = s.empty || {};
      emptyCard = emptyState({ target: root, tone: 'quiet', title: e.title || tf('empty'), hint: e.hint || tf('emptyHint') });
      emptyCard.el.setAttribute('data-ak-part', 'empty');
      return;
    }
    if (s.fade === 'age' && P.age > 180) root.setAttribute('data-ak-age', P.age > 365 ? 'old' : 'mid');
    if (view === 'seal') {
      const box = el('div', { class: 'ak-fp__sealbox', 'data-ak-part': 'sealBox' });
      drawSeal(box, null);
      root.appendChild(box);
    } else if (view === 'barcode') {
      root.appendChild(el('div', { class: 'ak-fp__barcodebox', 'data-ak-part': 'barcodeBox' }, barcodeSvg(P, { full: true })));
    } else if (view === 'row') {
      const box = el('div', { class: 'ak-fp__sealbox', 'data-ak-part': 'sealBox' });
      drawSeal(box, null);
      root.appendChild(box);
      root.appendChild(head(true));
      root.appendChild(el('div', { class: 'ak-fp__barcodebox', 'data-ak-part': 'barcodeBox' }, barcodeSvg(P, { W: 300, H: 28, full: false })));
    } else {
      root.appendChild(head(true));
      const box = el('div', { class: 'ak-fp__sealbox', 'data-ak-part': 'sealBox' });
      drawSeal(box, null);
      const side = el('div', { class: 'ak-fp__side' }, [
        el('div', { class: 'ak-fp__label', text: tf('barcode') }),
        el('div', { class: 'ak-fp__barcodebox', 'data-ak-part': 'barcodeBox' }, barcodeSvg(P, { full: true, H: 64 })),
        el('div', { class: 'ak-fp__label', text: tf('trust') }),
        trustBar(P),
      ]);
      root.appendChild(el('div', { class: 'ak-fp__top' }, [box, side]));
      root.appendChild(el('pre', { class: 'ak-fp__tag', 'data-ak-part': 'tag', text: tagLines(P).join('\n') }));
      root.appendChild(el('div', { class: 'ak-fp__grids', 'data-ak-part': 'grids' }, grids.map(function (_, i) { return gridCard(i); })));
    }
    slotInto(root, s, 'extra', null, { tag: 'div', cls: 'ak-fp__extra' });
    root.appendChild(tip);
  }

  function light(ti, g) {
    const key = ti == null ? '' : ti + '|' + g;
    if (key === lit) return;
    lit = key;
    root.querySelectorAll('[data-topic]').forEach(function (n) {
      n.classList.toggle('ak-fp--dim', ti != null && n.getAttribute('data-topic') !== String(ti));
    });
    root.querySelectorAll('[data-ak-part="sealBox"]').forEach(function (box) {
      drawSeal(/** @type {HTMLElement} */ (box), ti == null ? null : { ti: ti, g: g });
    });
  }

  function showTip(ev, lines, card) {
    clear(tip);
    if (card) tip.appendChild(card);
    else lines.forEach(function (l, i) { tip.appendChild(el(i === 0 ? 'b' : 'div', { text: l })); });
    tip.hidden = false;
    tip.classList.toggle('ak-fp__tip--card', !!card);
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const x = Math.max(8, Math.min(ev.clientX + 14, window.innerWidth - w - 8));
    const y = ev.clientY + 14 + h > window.innerHeight - 8 ? Math.max(8, ev.clientY - h - 10) : ev.clientY + 14;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  function onMove(ev) {
    if (!P) return;
    const target = /** @type {Element} */ (ev.target);
    const seal = target.closest && target.closest('.ak-fp__seal');
    const topicEl = target.closest && target.closest('[data-topic]');
    if (topicEl && root.contains(topicEl)) {
      const ti = Number(topicEl.getAttribute('data-topic'));
      const t = P.topics[ti];
      light(ti, topicEl.getAttribute('data-g') || (t && t.genre) || 'F');
      if (topicEl.hasAttribute('data-i')) {
        showTip(ev, sectionTip(P, P.rows[Number(topicEl.getAttribute('data-i'))]));
      } else if (t) {
        const of = P.rows.filter(function (r) { return r.ti === ti; }).map(function (r) { return r.heading || String(r.n); });
        showTip(ev, [t.name, tf('genre.' + t.genre) + ' · ' + t.mark + ' ' + tf('mark.' + t.mark) + ' · ' + tf('share', { p: Math.round(t.share * 100) }), tf('sectionsOf', { list: of.join(', ') })]);
      }
      return;
    }
    light(null, '');
    if (seal && root.contains(seal) && view !== 'barcode') { showTip(ev, [], sealCard(P)); return; }
    tip.hidden = true;
  }

  function onLeave() { light(null, ''); tip.hidden = true; }

  function onClick(ev) {
    const t = /** @type {Element} */ (ev.target);
    const stripe = t.closest && t.closest('[data-i]');
    if (!stripe || !P || !s.onSection) return;
    const r = P.rows[Number(stripe.getAttribute('data-i'))];
    if (r) s.onSection(r.n);
  }

  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerleave', onLeave);
  root.addEventListener('click', onClick);
  if (reducedMotion()) root.setAttribute('data-ak-still', '');
  if (s.onSection) root.setAttribute('data-ak-clickable', '');
  render();

  return {
    el: root,
    set: function (patch) {
      if (destroyed || !patch) return;
      if ('data' in patch) data = patch.data || null;
      if (patch.view && VIEWS.indexOf(patch.view) >= 0) view = patch.view;
      if (patch.grids && patch.grids.length) grids = patch.grids.map(function (g) { return [g[0], g[1]]; });
      render();
    },
    destroy: function () {
      destroyed = true;
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('click', onClick);
      if (emptyCard) emptyCard.destroy();
      root.remove();
    },
  };
}
