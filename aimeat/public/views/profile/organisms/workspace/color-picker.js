/**
 * @file public/views/profile/organisms/workspace/color-picker.js
 * @description The optional color-tag dot + inline swatch palette used by workspace sections,
 *   documents and records. Self-contained (a small fixed palette of theme tokens). Extracted from
 *   workspace.js to satisfy max-file-lines with no behaviour change.
 * @structure TAG_PALETTE (const), ColorPicker
 * @usage import { ColorPicker } from '/views/profile/organisms/workspace/color-picker.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from workspace.js (max-file-lines)
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

// Optional color tags for sections / documents / records. A small fixed palette of theme tokens
// (kept in CSS as .pj-tag-{key} → --pj-tag) so colors always match the active light/dark theme —
// never a free hex that could clash. null/absent = no color (the default, neutral).
const TAG_PALETTE = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];

// A dot that opens an inline swatch palette; picking a color (or ∅) calls onPick(key|null) and closes.
// Self-contained so it can sit in a section head, a document row or a record row alike.
export function ColorPicker({ value, onPick, title }) {
  const [open, setOpen] = useState(false);
  return html`
    <span class="pj-cp">
      <button class="pj-cp-dot ${value ? 'pj-colored pj-tag-' + value : 'pj-cp-empty'}" title=${title || (t('organisms.color') || 'Color')}
        onClick=${(e) => { e.stopPropagation(); e.preventDefault(); setOpen(o => !o); }}></button>
      ${open ? html`
        <span class="pj-cp-pop" onMouseLeave=${() => setOpen(false)}>
          <button class="pj-cp-sw pj-cp-none" title=${t('organisms.noColor') || 'No color'}
            onClick=${(e) => { e.stopPropagation(); e.preventDefault(); onPick(null); setOpen(false); }}>∅</button>
          ${TAG_PALETTE.map(c => html`<button key=${c} class="pj-cp-sw pj-colored pj-tag-${c}"
            onClick=${(e) => { e.stopPropagation(); e.preventDefault(); onPick(c); setOpen(false); }}></button>`)}
        </span>` : null}
    </span>`;
}
