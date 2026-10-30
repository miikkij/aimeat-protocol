/**
 * @file atelier/ornament-sets.js
 * @description THE ORNAMENT SETS: eleven styles (modern, futuristic, cyberpunk, vibrant, emotional,
 *   dramatic, symmetrical, chaotic, velocity, art deco, crystal), each one figure for each of five
 *   roles on a screen, so a page decorated from one set reads as one hand
 *   (wish-kymmenen-koristesetti-eri-tyyleiss):
 *
 *     <set>-frame    round a card or a panel        OVERLAY, drawn round the element's box
 *     <set>-rule     an empty element under a heading   a strip at the element's width
 *     <set>-bar      a progress bar (takes `value`; handle.set(v) moves it)
 *     <set>-bullets  a list: a mark before each item
 *     <set>-strip    an empty element at the foot of a page or a section
 *
 *   This module turns each SetStyle (ornament-sets-a/b/c.js) into the five figures ornament.js
 *   mounts. The style draws in the set canvas's coordinates: the frame gets the element's box
 *   inside a padded drawing, a rule or a strip gets a horizontal run, the bar its track and value,
 *   a bullet one point. A part drawn on its own starts at once: the start times the canvas gave a
 *   bullet are shifted so the first one shows without waiting for a frame that is not there.
 * @structure SETS · SET_IDS · SET_ROLES_LIST · SET_FIGURES
 * @usage
 *   AIMEAT.atelier.ornament(card, 'cyberpunk-frame');
 *   AIMEAT.atelier.ornamentSet('cyberpunk', { frame: card, rule: hr, bar, bullets: ul, strip: foot });
 * @version-history
 *   v0.1.0 — 2026-10-30 — Initial: eleven sets from the accepted set canvas.
 */
import { pen } from './ornament-set-pen.js';
import { drawing } from './ornament-svg.js';
import { fillMount } from './ornament-lines.js';
import { SETS_A } from './ornament-sets-a.js';
import { SETS_B } from './ornament-sets-b.js';
import { SETS_C } from './ornament-sets-c.js';

/** @type {import('./ornament-set-pen.js').SetStyle[]} */
export const SETS = [...SETS_A, ...SETS_B, ...SETS_C];

/** The set ids, in canvas order. */
export const SET_IDS = SETS.map((s) => s.id);

/** The five roles of a set, in the order a screen is read. */
export const SET_ROLES_LIST = ['frame', 'rule', 'bar', 'bullets', 'strip'];

/** The knobs a set figure takes beyond speed and delay. */
const knobs = (style, role) => {
  const out = role === 'bar' ? ['value'] : [];
  if (style.id === 'chaotic') out.push('mess');
  return out;
};

/** The pen for one drawing of one set; the drawing carries the set's palette class (ornaments.css). */
const penFor = (svg, style, animate, p, shift) => {
  svg.classList.add('ak-orn-pal-' + style.id);
  return pen(svg, {
    animate, speed: p.speed, delay: p.delay, shift: shift || 0, ease: style.ease || null, popEase: style.popEase || null, seed: style.seed || 1,
  });
};

/**
 * The five figures of one set, keyed `<set>-<role>`.
 * @param {import('./ornament-set-pen.js').SetStyle} style
 */
function figuresOf(style) {
  /** @type {Record<string, any>} */
  const out = {};
  out[style.id + '-frame'] = {
    params: knobs(style, 'frame'),
    overlay: {
      pad: () => ({ x: 64, y: 64 }),
      draw: (layers, w, h, pad, p) => {
        const d = layers.under;
        if (d) style.frame(penFor(d.svg, style, d.animate, p, 0), { x: pad.x, y: pad.y, w, h }, p);
      },
    },
  };
  const run = (role, height, y, shift) => ({
    params: knobs(style, role),
    mount: (host, p, opts) => fillMount(host, height, 'ak-orn-strip--set', opts, (d, W) => {
      style[role](penFor(d.svg, style, d.animate, p, shift), { x0: 12, x1: W - 12, y }, p);
    }),
  });
  out[style.id + '-rule'] = run('rule', 44, 24, 0.2);
  out[style.id + '-bar'] = {
    params: knobs(style, 'bar'),
    mount: (host, p, opts) => {
      let value = p.value;
      const bh = style.barH || 12;
      const strip = fillMount(host, 56, 'ak-orn-strip--set ak-orn-strip--setbar', opts, (d, W) => {
        style.bar(penFor(d.svg, style, d.animate, p, 0.3), { x: 18, y: (56 - bh) / 2, w: W - 36, h: bh, v: value }, p);
      });
      return {
        render: strip.render,
        set: (v) => { value = Math.max(0, Math.min(1, Number(v) || 0)); strip.render(false); },
        teardown: strip.teardown,
      };
    },
  };
  out[style.id + '-bullets'] = {
    params: knobs(style, 'bullets'),
    mount: (host, p, opts) => {
      host.classList.add('ak-orn-bullets');
      /** @type {HTMLElement[]} */
      const marks = [];
      const clear = () => { for (const m of marks) m.remove(); marks.length = 0; };
      return {
        render: (animate) => {
          clear();
          let i = 0;
          for (const li of Array.from(host.children)) {
            if (li.tagName !== 'LI') continue;
            const m = document.createElement('span');
            m.className = 'ak-orn-sbullet';
            m.setAttribute('aria-hidden', 'true');
            li.insertBefore(m, li.firstChild);
            marks.push(m);
            const d = drawing(m, 30, 24, { animate, speed: opts.speed, delay: opts.delay, viewBox: true });
            style.bullet(penFor(d.svg, style, animate, p, 0.85), [11, 12], i, p);
            i++;
          }
        },
        teardown: () => { clear(); host.classList.remove('ak-orn-bullets'); },
      };
    },
  };
  out[style.id + '-strip'] = run('strip', 64, 32, 0.4);
  return out;
}

/** Every set figure, keyed `<set>-<role>`, in set order and then role order. */
export const SET_FIGURES = Object.assign({}, ...SETS.map(figuresOf));
