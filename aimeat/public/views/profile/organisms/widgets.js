/**
 * @file widgets.js
 * @description Organism-domain widgets shared across the organisms tab modules. Currently the
 *   collapsible OKF-style structure-overview panel (used at organism and workspace level).
 *   Extracted from organisms-tab.js with no behaviour change.
 * @structure StructureOverview
 * @usage import { StructureOverview } from '/views/profile/organisms/widgets.js';
 * @version-history
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner } from '/views/profile/shared.js';
import { Markdown } from '/components/Markdown.js';

/** Collapsible OKF-style structure-overview panel. A button that, on first expand, lazy-loads a
 *  deterministic Markdown structure map (server projection — never persisted) and renders it via the
 *  safe Markdown component. Used at organism level (every workspace's space breakdown) and workspace
 *  level (per-space recent ids + titles). Collapsed by default so it costs nothing until asked for.
 * @param {{ load: () => Promise<string>, label: string }} props */
export function StructureOverview({ load, label }) {
  const [open, setOpen] = useState(false);
  const [md, setMd] = useState(null);   // null = not loaded yet; '' = loaded but empty/failed
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && md === null && !busy) {
      setBusy(true);
      // For the human view, strip the OKF YAML frontmatter (machine metadata — kept in the raw
      // server/MCP output) AND the leading "# … — structure overview" H1 (the panel toggle already
      // names it; the page header already shows the org/workspace name). The body starts at the
      // description / totals line.
      try {
        const raw = (await load()) || '';
        setMd(raw.replace(/^---\n[\s\S]*?\n---\n+/, '').replace(/^#\s+.*\n+/, ''));
      } finally { setBusy(false); }
    }
  };
  return html`
    <div class="pj-struct-overview">
      <button class="pj-struct-toggle" aria-expanded=${open} onClick=${toggle}>
        <span class="pj-struct-caret">${open ? '▾' : '▸'}</span>
        <span>${'📐 '}${label}</span>
      </button>
      ${open ? html`
        <div class="pj-struct-body card-detail">
          ${busy
            ? html`<${Spinner} text=${t('organisms.loading') || 'Loading...'} />`
            : (md
              ? html`<${Markdown} text=${md} />`
              : html`<div class="section-desc">${t('organisms.structEmpty') || 'No structure to show yet.'}</div>`)}
        </div>` : null}
    </div>`;
}
