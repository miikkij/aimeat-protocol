/**
 * @file secretary/use-layout.js
 * @description Customizable two-column dashboard layout for the Secretary view. Each dashboard card
 *   can be moved between the left (main) and right column, reordered within its column, or hidden —
 *   persisted per owner in memory `secretary.layout` so the arrangement survives reloads. On narrow
 *   screens the two columns collapse to one (CSS); ordering still applies. `Today` (status band) and
 *   the setup/manage disclosure live outside this system and are rendered fixed by the view.
 * @structure
 *   - DASH_DEFAULT: ordered [{ key, col }] default arrangement of the movable cards
 *   - useLayout() -> { layout, swap, moveCol, hide, unhide, reset, hidden, ready }
 *   - LayoutCard({ entry, node, prevKey, nextKey, onSwap, onMoveCol, onHide }) -> card + ⋮ arrange menu
 * @usage const lay = useLayout(); ... LayoutCard({ entry, node, prevKey, nextKey, ...lay })
 * @version-history
 *   v0.1.0 — 2026-06-28 — Initial: pin-to-column + reorder + hide, persisted; mobile-safe.
 */
import { h } from 'preact';
import htm from 'htm';
import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import { apiGet, apiPost } from '/js/api.js';
import { t } from '/js/i18n.js';

const html = htm.bind(h);
const KEY = 'secretary.layout';

/** A clean copy of the default layout (normalized with hidden:false on every entry). */
const fresh = () => DASH_DEFAULT.map((e) => ({ key: e.key, col: e.col, hidden: false }));

// Default arrangement of the movable dashboard cards. New keys added here later are appended to a
// user's saved layout automatically (see merge() below), so customised users still get new cards.
export const DASH_DEFAULT = [
  { key: 'whatsNext', col: 'main' },
  { key: 'stand', col: 'main' },
  { key: 'actionItems', col: 'main' },
  { key: 'routines', col: 'main' },
  { key: 'decisions', col: 'main' },
  { key: 'feed', col: 'main' },
  { key: 'goals', col: 'main' },
  { key: 'decisionLog', col: 'main' },
  { key: 'chat', col: 'main' },
  { key: 'whatsNextCard', col: 'main' },
  { key: 'find', col: 'main' },
  { key: 'createResource', col: 'main' },
  { key: 'note', col: 'main' },
  { key: 'calendar', col: 'right' },
  { key: 'automation', col: 'right' },
  { key: 'triggers', col: 'right' },
  { key: 'specialists', col: 'right' },
];

// Merge a saved layout with the defaults: keep saved entries (col/hidden/order), drop unknown keys,
// append any default keys the saved layout doesn't have yet (at their default column).
function merge(saved) {
  if (!Array.isArray(saved) || !saved.length) return fresh();
  const known = new Set(DASH_DEFAULT.map((e) => e.key));
  const out = saved.filter((e) => e && known.has(e.key)).map((e) => ({ key: e.key, col: e.col === 'right' ? 'right' : 'main', hidden: !!e.hidden }));
  const have = new Set(out.map((e) => e.key));
  for (const d of DASH_DEFAULT) if (!have.has(d.key)) out.push({ key: d.key, col: d.col, hidden: false });
  return out;
}

export function useLayout() {
  const [layout, setLayout] = useState(fresh);
  const [ready, setReady] = useState(false);
  const dirty = useRef(false);

  useEffect(() => {
    let cancelled = false;
    apiGet(`/v1/memory/${KEY}`)
      .then((r) => { const v = r && r.data && r.data.value; if (!cancelled) setLayout(merge(v && v.layout)); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  // Persist after any user change (not the initial load).
  useEffect(() => {
    if (!ready || !dirty.current) return;
    apiPost('/v1/memory', { key: KEY, value: { layout }, visibility: 'private' }).catch(() => {});
  }, [layout, ready]);

  const mutate = useCallback((fn) => { dirty.current = true; setLayout((prev) => fn([...prev.map((e) => ({ ...e }))])); }, []);

  const swap = useCallback((a, b) => {
    if (!a || !b) return;
    mutate((arr) => { const ai = arr.findIndex((e) => e.key === a); const bi = arr.findIndex((e) => e.key === b); if (ai < 0 || bi < 0) return arr; const tmp = arr[ai]; arr[ai] = arr[bi]; arr[bi] = tmp; return arr; });
  }, [mutate]);

  const moveCol = useCallback((key) => {
    mutate((arr) => { const e = arr.find((x) => x.key === key); if (e) e.col = e.col === 'main' ? 'right' : 'main'; return arr; });
  }, [mutate]);

  const hide = useCallback((key) => { mutate((arr) => { const e = arr.find((x) => x.key === key); if (e) e.hidden = true; return arr; }); }, [mutate]);
  const unhide = useCallback((key) => { mutate((arr) => { const e = arr.find((x) => x.key === key); if (e) e.hidden = false; return arr; }); }, [mutate]);
  const reset = useCallback(() => { dirty.current = true; setLayout(fresh()); }, []);

  const hidden = useMemo(() => layout.filter((e) => e.hidden), [layout]);
  return { layout, swap, moveCol, hide, unhide, reset, hidden, ready };
}

/** One dashboard card + its floating ⋮ arrange menu (move column, reorder, hide). */
export function LayoutCard({ entry, node, prevKey, nextKey, onSwap, onMoveCol, onHide }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return html`
    <div class="sec-lc">
      <div class=${`sec-lc-menu${open ? ' open' : ''}`}>
        <button class="sec-lc-btn" title=${t('secretary.layout.arrange')} aria-label=${t('secretary.layout.arrange')} onClick=${() => setOpen((o) => !o)}>⋮</button>
        ${open ? html`
          <div class="sec-lc-pop" onMouseLeave=${close}>
            <button onClick=${() => { onMoveCol(entry.key); close(); }}>${entry.col === 'main' ? t('secretary.layout.toRight') : t('secretary.layout.toLeft')}</button>
            <button disabled=${!prevKey} onClick=${() => { onSwap(entry.key, prevKey); close(); }}>${t('secretary.layout.up')}</button>
            <button disabled=${!nextKey} onClick=${() => { onSwap(entry.key, nextKey); close(); }}>${t('secretary.layout.down')}</button>
            <button class="sec-lc-hide" onClick=${() => { onHide(entry.key); close(); }}>${t('secretary.layout.hide')}</button>
          </div>` : null}
      </div>
      ${node}
    </div>`;
}

export default useLayout;
