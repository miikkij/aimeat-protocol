/**
 * @file atelier/state.js
 * @description The designed states: the empty state a list shows before anything exists, and the
 *   skeleton a region shows while its data is on the way. They exist so an Atelier app never
 *   ships a grey box, a spinner with no words, or a bare "Error" — the states are part of the
 *   kit, not something each app remembers to design.
 *
 *   THE EMPTY STATE IS NEVER BLANK. It always carries a spot mark (a themed shape drawn by the
 *   stylesheet — no image request, no generation cost), a title, and usually a hint or an action.
 *   This is the zero-image fallback the anti-flat gate accepts: designed, not grey.
 * @structure emptyState(spec) → { el, set, destroy } · skeleton(spec) → { el, destroy }
 * @usage  AIMEAT.atelier.emptyState({ target: host, title: 'No errands yet',
 *           action: { label: 'Add one', onClick } });
 * @version-history
 *   v0.1.0 — 2026-08-27 — Initial (TARGET-074 phase 1, slice 1).
 */
import { el, clear, resolve, enter } from './dom.js';

/**
 * A designed empty / error / notice card.
 * @param {{
 *   target?: string|Element, tone?: 'quiet'|'error'|'celebrate',
 *   title: string, hint?: string,
 *   action?: { label: string, onClick?: () => void } | null,
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: any) => void, destroy: () => void }}
 */
export function emptyState(spec) {
  const state = { title: spec.title, hint: spec.hint, action: spec.action || null };
  const tone = spec.tone || 'quiet';

  const mark = el('div', { class: 'ak-empty__mark', 'aria-hidden': 'true' }, [
    el('span', { class: 'ak-empty__mark-a' }),
    el('span', { class: 'ak-empty__mark-b' }),
    el('span', { class: 'ak-empty__mark-c' }),
  ]);
  const title = el('h3', { class: 'ak-empty__title' });
  const hint = el('p', { class: 'ak-empty__hint' });
  const actions = el('div', { class: 'ak-empty__actions' });

  const root = el('div', {
    class: 'ak-root ak-empty ak-empty--' + tone,
    role: tone === 'error' ? 'alert' : null,
  }, [mark, title, hint, actions]);

  if (spec.target) resolve(spec.target).appendChild(root);

  function render() {
    title.textContent = state.title;
    hint.textContent = state.hint || '';
    hint.hidden = !state.hint;
    clear(actions);
    actions.hidden = !state.action;
    if (state.action) {
      actions.appendChild(el('button', {
        type: 'button', class: 'ak-btn ak-btn--primary',
        on: { click: function () { if (state.action && state.action.onClick) state.action.onClick(); } },
      }, state.action.label));
    }
  }
  render();
  enter(root);

  return {
    el: root,
    /** @param {{ title?: string, hint?: string, action?: any }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.title != null) state.title = patch.title;
      if (patch.hint !== undefined) state.hint = patch.hint;
      if (patch.action !== undefined) state.action = patch.action;
      render();
    },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * A loading skeleton: shimmering placeholder rows the real content replaces. Finite by
 * construction — the shimmer stops after a few passes (the stylesheet's iteration count), so an
 * abandoned skeleton never keeps the page repainting forever.
 * @param {{ target?: string|Element, rows?: number, lines?: number }} [spec]
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function skeleton(spec) {
  const s = spec || {};
  const rows = Math.max(1, Math.min(8, s.rows || 3));
  const lines = Math.max(1, Math.min(4, s.lines || 2));
  const root = el('div', { class: 'ak-root ak-skeleton', role: 'status', 'aria-live': 'polite' });
  for (let r = 0; r < rows; r++) {
    const row = el('div', { class: 'ak-skeleton__row' });
    for (let l = 0; l < lines; l++) {
      row.appendChild(el('span', {
        class: 'ak-skeleton__line' + (l === 0 ? ' ak-skeleton__line--lead' : ''),
        'aria-hidden': 'true',
      }));
    }
    root.appendChild(row);
  }
  if (s.target) resolve(s.target).appendChild(root);
  return {
    el: root,
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
