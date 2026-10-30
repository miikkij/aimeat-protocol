/**
 * @file src/services/design-book/ornament.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ORNAMENT kind of the Design Book: one figure of the Atelier kit's ornaments
 *   (src/data/atelier-ornaments.ts), or one whole SET of five figures in one style
 *   (src/data/atelier-ornament-sets.ts), with its knobs and the look it was proven on
 *   (wish-kasvavat-koristeet-atelieriin-ja-design-bookiin, wish-kymmenen-koristesetti-eri-tyyleiss).
 *
 *   THE BODY IS DATA, NEVER CODE: { ornament, params?, look? } or { set, params?, look? }. The
 *   figure is drawn by the kit an app already loads, so a part carries no markup and no script of
 *   its own, and its preview page is built here from the registry: for a figure, the element it
 *   was drawn for (a card, a badge, a bar, a heading…) with the figure on it; for a set, a whole
 *   screen (a card, a heading with its rule, a bar, a list and a foot strip) with the set on it.
 *   Either way one control grows it again, and a figure or set with a bar gets one that moves it.
 *
 *   TAKEN LIKE A COMPONENT, NOT MERGED. An ornament lives in the app's own code, on the element the
 *   app chooses, so adopting one writes nothing and answers the one line that puts it there.
 * @structure OrnamentBody · validateOrnamentBody(o) · ornamentPreviewHtml(part, theme) · ornamentSnippet(body)
 * @usage
 *   const body = validateOrnamentBody({ ornament: 'frame', params: { leaves: 2 } });
 *   const set = validateOrnamentBody({ set: 'art-deco', params: { value: 0.4 } });
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial.
 *   v1.1.0 — 2026-10-30 — A SET body ({ set, params?, look? }) previewed as a whole screen and
 *     adopted as one ornamentSet() line; the value control on every figure that takes a value.
 */
import { ORNAMENT_IDS, ornamentById, ornamentParamProblem, resolveOrnamentParams, type OrnamentWraps } from '../../data/atelier-ornaments.js';
import { ORNAMENT_SET_IDS, ornamentSetById } from '../../data/atelier-ornament-sets.js';
import { LOOKS } from '../../data/atelier-looks.js';
import { escapeHtml } from '../../utils/html-escape.js';
import { DesignBookError } from './errors.js';

/** The fields of a stored part the preview reads. */
interface OrnamentPart { title: string; summary: string; body: unknown }

export interface OrnamentBody {
  /** One figure; absent on a set. */
  ornament?: string;
  /** One set of five figures; absent on a figure. */
  set?: string;
  params?: Record<string, number>;
  look?: string;
}

const SHAPE = 'An ornament part\'s body is { ornament, params?, look? } for one figure or { set, params?, look? } for a set of five';

/** The propose-time bench for an ornament: a figure or a set the kit draws, knobs inside their bounds, a look this node ships. */
export function validateOrnamentBody(o: Record<string, unknown>): OrnamentBody {
  const isSet = o.set !== undefined;
  if (isSet && o.ornament !== undefined) {
    throw new DesignBookError('BODY_INVALID', `${SHAPE}; it names one of them, not both.`, 422);
  }
  let out: OrnamentBody;
  if (isSet) {
    if (typeof o.set !== 'string' || !ornamentSetById(o.set)) {
      throw new DesignBookError('BODY_INVALID', `${SHAPE}; "set" is one of ${ORNAMENT_SET_IDS.join(', ')}.`, 422);
    }
    // A set's bar takes every knob the set takes, so its bounds are the set's.
    const problem = ornamentParamProblem(`${o.set}-bar`, o.params);
    if (problem) throw new DesignBookError('BODY_INVALID', problem.replace(`"${o.set}-bar" takes`, `The ${o.set} set takes`), 422);
    out = { set: o.set };
  } else {
    if (typeof o.ornament !== 'string' || !ornamentById(o.ornament)) {
      throw new DesignBookError('BODY_INVALID', `${SHAPE}; "ornament" is one of ${ORNAMENT_IDS.join(', ')}.`, 422);
    }
    const problem = ornamentParamProblem(o.ornament, o.params);
    if (problem) throw new DesignBookError('BODY_INVALID', problem, 422);
    out = { ornament: o.ornament };
  }
  const params = resolveOrnamentParams(o.params as Record<string, number> | undefined);
  if (params) out.params = params;
  if (o.look !== undefined) {
    if (typeof o.look !== 'string' || !LOOKS.some((l) => l.id === o.look)) {
      throw new DesignBookError('BODY_INVALID',
        `"${String(o.look)}" is not a look this node ships. The looks it has: ${LOOKS.map((l) => l.id).join(', ')}.`, 422);
    }
    out.look = o.look;
  }
  const extra = Object.keys(o).filter((k) => !['ornament', 'set', 'params', 'look'].includes(k));
  if (extra.length) {
    throw new DesignBookError('BODY_INVALID', `${SHAPE}; ${extra.map((k) => `"${k}"`).join(', ')} is not part of it.`, 422);
  }
  return out;
}

/** The element each kind of figure is shown on, as markup; `data-orn` marks where the figure goes. */
const STAGE: Record<OrnamentWraps, string> = {
  block: '<div class="orn-card" data-orn><h2>A card worth framing</h2><p>The ornament grows round the block once and then holds still. The words stay where they are.</p></div>',
  badge: '<div class="orn-badge" data-orn><span>A</span></div>',
  bar: '<div class="orn-bar" data-orn role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="64" aria-label="Progress"></div>',
  rule: '<p>The text above the rule ends here.</p><div class="orn-rule" data-orn></div><p>And the next part begins below it.</p>',
  heading: '<h1 class="orn-heading" data-orn>Atelier</h1>',
  text: '<p class="orn-text" data-orn>Ornaments grow round the content, never over it. A drop cap, a heading and a rule can be the same vine: one line that branches, curls and opens into a leaf. When the text changes, the ornament measures itself again.</p>',
  list: '<ul data-orn><li>The frame grows from the corners</li><li>The wreath goes round the badge</li><li>The vine follows the edge</li></ul>',
  button: '<div class="orn-buttons"><button type="button" class="orn-btn" data-orn>Continue</button></div>',
  column: '<div class="orn-column" data-orn></div>',
};

/** A whole screen for a set: each element carries the role its figure takes. */
const SET_STAGE = [
  '<div class="orn-set">',
  '<div class="orn-card" data-orn-role="frame"><h2>A card in the set</h2><p>The frame grows round the card while the rest of the set grows beside it.</p></div>',
  '<div class="orn-set__side">',
  '<h2 class="orn-set__title">A heading and its rule</h2><div data-orn-role="rule"></div>',
  '<p class="orn-set__label" id="orn-bar-label">Progress</p>',
  '<div data-orn-role="bar" role="progressbar" aria-labelledby="orn-bar-label" aria-valuemin="0" aria-valuemax="100" aria-valuenow="64"></div>',
  '<ul data-orn-role="bullets"><li>A mark before each item</li><li>The next item</li><li>And a third</li></ul>',
  '</div>',
  '<div class="orn-set__foot" data-orn-role="strip"></div>',
  '</div>',
].join('');

/** Shapes the demo elements so each figure has the room it was drawn for. */
const STAGE_CSS = [
  'html, body { margin: 0; }',
  'body { background: var(--ak-bg); color: var(--ak-ink); font-family: var(--ak-font, Georgia, serif); }',
  'main { max-width: 760px; margin: 0 auto; padding: 32px 20px 96px; display: flex; flex-direction: column; gap: 28px; }',
  '.orn-head h1 { margin: 0 0 6px; font: var(--ak-weight-display, 600) 1.6rem/1.2 var(--ak-font-display, Georgia, serif); }',
  '.orn-head p { margin: 0; color: var(--ak-ink-dim); font-size: 1rem; line-height: 1.5; }',
  '.orn-stage { padding: 56px 0; }',
  '.orn-card { background: var(--ak-surface); border-radius: 18px; max-width: 520px; margin: 0 auto; }',
  '.orn-card h2 { margin: 0 0 8px; font-family: var(--ak-font-display, Georgia, serif); }',
  '.orn-card p, .orn-stage p { margin: 0; line-height: 1.55; }',
  '.orn-stage--jugend .orn-card { width: min(300px, 46vw); min-height: 380px; }',
  '.orn-badge { width: 168px; height: 168px; border-radius: 50%; background: var(--ak-surface); margin: 64px auto; display: grid; place-items: center; font: var(--ak-weight-display, 600) 64px/1 var(--ak-font-display, Georgia, serif); color: var(--ak-accent); }',
  '.orn-stage--guilloche .orn-badge { width: 260px; height: 260px; background: none; margin: 0 auto; }',
  '.orn-bar { max-width: 640px; margin: 0 auto; }',
  '.orn-stage--wrap .orn-bar { height: 28px; border-radius: 4px; background: var(--ak-surface); border: 1px solid var(--ak-line, currentColor); margin: 0 40px; }',
  '.orn-heading { margin: 0; text-align: center; font: var(--ak-weight-display, 600) clamp(2rem, 7vw, 3.4rem)/1.1 var(--ak-font-display, Georgia, serif); }',
  '.orn-stage--ribbon .orn-heading { width: fit-content; margin: 24px auto; font-size: clamp(1.4rem, 5vw, 2rem); }',
  '.orn-text { max-width: 560px; margin: 0 auto; line-height: 1.6; font-size: 1.1rem; }',
  '.orn-stage ul { max-width: 420px; margin: 0 auto; font-size: 1.1rem; line-height: 1.8; }',
  '.orn-buttons { display: flex; justify-content: center; }',
  '.orn-btn { min-height: 48px; padding: 0 32px; border-radius: 24px; border: 1px solid var(--ak-accent); background: var(--ak-surface); color: var(--ak-ink); font: inherit; }',
  '.orn-column { width: 64px; height: 380px; margin: 0 auto; background: var(--ak-surface); border: 1px solid var(--ak-line, currentColor); }',
  // A set's screen: the card on one side, the heading, bar and list on the other, the strip across the foot.
  '.orn-set { display: grid; gap: 56px 64px; grid-template-columns: 1fr; padding: 24px 40px; }',
  '@media (min-width: 720px) { .orn-set { grid-template-columns: 1fr 1fr; padding: 24px 16px; } }',
  '.orn-set .orn-card { width: 100%; max-width: none; box-sizing: border-box; padding: 32px; border-radius: 4px; align-self: start; }',
  '.orn-set__side { display: flex; flex-direction: column; gap: 10px; min-width: 0; }',
  '.orn-set__title { margin: 0; font: var(--ak-weight-display, 600) 1.5rem/1.2 var(--ak-font-display, Georgia, serif); }',
  '.orn-set__label { margin: 12px 0 0; color: var(--ak-ink-dim); font-size: 1rem; }',
  '.orn-set ul { margin: 8px 0 0; padding: 0; font-size: 1.05rem; line-height: 2.2; }',
  '.orn-set__foot { grid-column: 1 / -1; }',
  '.orn-controls { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; align-items: center; }',
  '.orn-controls label { font-size: 1rem; }',
  '.orn-controls input[type=range] { width: min(320px, 70vw); min-height: 44px; }',
].join('\n');

/** The look a part is previewed on: its own, else the first its figure or set was drawn for. */
function previewLook(body: OrnamentBody): string {
  if (body.look) return body.look;
  if (body.set) return ornamentSetById(body.set)?.fitsLooks[0] ?? 'vivid';
  return ornamentById(body.ornament ?? '')?.fitsLooks[0] ?? 'vivid';
}

/**
 * The preview page for one ornament part: the figure on the element it was drawn for, or the set
 * on a whole screen, in the part's look, with a control that grows it again and, where there is a
 * bar, one that moves its value.
 */
export function ornamentPreviewHtml(part: OrnamentPart, theme: 'light' | 'dark' = 'light'): string {
  const body = part.body as OrnamentBody;
  const look = previewLook(body);
  const isSet = typeof body.set === 'string';
  const entry = isSet ? undefined : ornamentById(body.ornament ?? '');
  const wraps: OrnamentWraps = entry?.wraps ?? 'block';
  const spec = JSON.stringify(isSet ? { set: body.set, params: body.params ?? {} } : { id: body.ornament, params: body.params ?? {} }).replace(/</g, '\\u003c');
  const bar = isSet || (entry?.params.includes('value') ?? false);
  const stageClass = isSet ? `orn-stage orn-stage--set-${escapeHtml(body.set ?? '')}` : `orn-stage orn-stage--${escapeHtml(body.ornament ?? '')}`;
  return [
    `<!DOCTYPE html><html lang="en" data-theme="${theme === 'dark' ? 'dark' : 'light'}"><head><meta charset="utf-8">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<link rel="stylesheet" href="/lib/aimeat-atelier.css">',
    `<style>${STAGE_CSS}</style></head><body data-ak-look="${escapeHtml(look)}">`,
    '<main>',
    `<header class="orn-head"><h1>${escapeHtml(part.title)}</h1><p>${escapeHtml(part.summary)}</p></header>`,
    `<section class="${stageClass}">${isSet ? SET_STAGE : STAGE[wraps]}</section>`,
    '<div class="orn-controls">',
    '<button type="button" class="ak-btn ak-btn--primary" data-orn-replay>Grow it again</button>',
    bar ? '<label for="orn-value">Value</label><input id="orn-value" type="range" min="0" max="100" value="64">' : '',
    '</div>',
    '</main>',
    '<script src="/v1/libs/aimeat-atelier.js"></scr' + 'ipt>',
    '<script>',
    `var SPEC = ${spec};`,
    'var handle, host;',
    'if (SPEC.set) {',
    '  var targets = {};',
    '  ["frame", "rule", "bar", "bullets", "strip"].forEach(function (r) { targets[r] = document.querySelector("[data-orn-role=" + r + "]"); });',
    '  host = targets.bar;',
    '  var whole = AIMEAT.atelier.ornamentSet(SPEC.set, targets, SPEC.params);',
    '  handle = whole && { replay: whole.replay, set: whole.update };',
    '} else {',
    '  host = document.querySelector("[data-orn]");',
    '  handle = AIMEAT.atelier.ornament(host, SPEC.id, SPEC.params);',
    '}',
    'document.querySelector("[data-orn-replay]").addEventListener("click", function () { if (handle) handle.replay(); });',
    'var range = document.getElementById("orn-value");',
    'if (range) range.addEventListener("input", function () { if (handle) handle.set(range.value / 100); host.setAttribute("aria-valuenow", range.value); });',
    '</scr' + 'ipt></body></html>',
  ].join('\n');
}

/** What adopting an ornament answers: the one line that puts it on an element (or a set on a screen), and what it needs. */
export function ornamentSnippet(body: OrnamentBody): { ornament?: string; set?: string; code: string; use: string } {
  const opts = body.params ? `, ${JSON.stringify(body.params)}` : '';
  const kit = 'Load the Atelier kit (/lib/aimeat-atelier.css and /v1/libs/aimeat-atelier.js)';
  if (body.set) {
    const s = ornamentSetById(body.set);
    return {
      set: body.set,
      code: `AIMEAT.atelier.ornamentSet('${body.set}', { frame: card, rule: hr, bar: meter, bullets: list, strip: foot }${opts});`,
      use: `${kit} and call the line with your page's elements: frame a card or a panel, rule an empty element under a heading, bar a progress bar, bullets a <ul>, strip an empty element at the foot. Leave out a role you do not want. ${s ? s.summary : ''} The call returns { handles, replay(), update(v), destroy() }; update(v) moves the bar. One figure alone: AIMEAT.atelier.ornament(el, '${body.set}-frame').`,
    };
  }
  const entry = ornamentById(body.ornament ?? '');
  return {
    ornament: body.ornament,
    code: `AIMEAT.atelier.ornament(el, '${body.ornament}'${opts});`,
    use: `${kit} and call the line with the element it decorates: ${entry ? entry.summary : ''} The call returns { replay(), set(v), destroy() }.`,
  };
}
