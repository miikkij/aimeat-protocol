/**
 * @file atelier/konsole.js
 * @description The console — a log vane in the terminal register: monospace lines with a time,
 *   a tone and the words, newest visible, capped so the DOM never grows without bound. The
 *   block every ops screen hand-rolls as a <pre> that overflows and forgets its scroll. Data
 *   in, tail out: set() replaces the lines; append() pushes new ones and follows the tail only
 *   while the reader is AT the tail (reading old lines is never yanked away). Nothing animates
 *   at idle; a fresh line enters with the kit's motion and reduced-motion drops the entrance.
 *
 *   (The file and function are `konsole` because `console` would shadow the global inside this
 *   module; the block and the namespace surface are still `console` — AIMEAT.atelier.console.)
 * @structure konsole(spec) → { el, set, append, destroy }
 * @usage
 *   var log = AIMEAT.atelier.console({ target: host, data: { lines: [
 *     { ts: '2026-08-29T10:00:00Z', tone: 'ok', text: 'import finished, 8 000 rows' } ] } });
 *   log.append([{ tone: 'err', text: 'row 8 001 refused: missing id' }]);
 * @version-history
 *   v0.33.0 — 2026-08-29 — Initial (TARGET-074 next level: the admin panel vocabulary).
 */
import { el, clear, resolve, reducedMotion } from './dom.js';
import { t } from './i18n.js';
import { emptyState } from './state.js';

const CAP_DEFAULT = 400;
const TONES = ['ok', 'warn', 'err', 'plain'];

function stamp(ts) {
  if (ts == null) return '';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * The console.
 * @param {{ target?: string|Element, title?: string, cap?: number,
 *   data?: { lines: Array<{ ts?: string|number|Date, tone?: string, text: string }> }|null,
 *   empty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data: object|null }) => void,
 *   append: (lines: Array<object>) => void, destroy: () => void }}
 */
export function konsole(spec) {
  const cap = typeof spec.cap === 'number' && spec.cap > 0 ? Math.min(spec.cap, 2000) : CAP_DEFAULT;
  const root = el('div', { class: 'ak-root ak-console' });
  if (spec.target) resolve(spec.target).appendChild(root);
  const vane = el('div', { class: 'ak-console__vane', role: 'log', 'aria-live': 'polite', tabindex: '0' });
  root.appendChild(vane);
  let emptyCard = null;

  function atTail() {
    return vane.scrollHeight - vane.scrollTop - vane.clientHeight < 24;
  }
  function lineNode(line, entering) {
    const tone = TONES.indexOf(line.tone) >= 0 ? line.tone : 'plain';
    const node = el('div', { class: 'ak-console__line ak-console__line--' + tone }, [
      line.ts != null ? el('span', { class: 'ak-console__ts', text: stamp(line.ts) }) : null,
      el('span', { class: 'ak-console__text', text: String(line.text == null ? '' : line.text) }),
    ]);
    if (entering && !reducedMotion()) node.classList.add('ak-console__line--enter');
    return node;
  }
  function trim() {
    while (vane.children.length > cap) vane.removeChild(vane.firstChild);
  }

  function render(data) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(vane);
    const lines = (data && Array.isArray(data.lines)) ? data.lines : [];
    if (!lines.length) {
      const e = spec.empty || {};
      emptyCard = emptyState({ target: vane, tone: 'quiet', title: e.title || t('consoleEmpty'), hint: e.hint || '' });
      return;
    }
    for (const line of lines.slice(-cap)) vane.appendChild(lineNode(line, false));
    vane.scrollTop = vane.scrollHeight;
  }

  render(spec.data);
  return {
    el: root,
    set(patch) { if (patch && 'data' in patch) render(patch.data); },
    /** @param {Array<{ ts?: any, tone?: string, text: string }>} lines */
    append(lines) {
      if (!Array.isArray(lines) || !lines.length) return;
      if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
      const follow = atTail();
      for (const line of lines) vane.appendChild(lineNode(line, true));
      trim();
      if (follow) vane.scrollTop = vane.scrollHeight;
    },
    destroy() { if (emptyCard) emptyCard.destroy(); root.remove(); },
  };
}
