/**
 * @file libraries-tab.js
 * @description Profile tab: the full client-library catalogue with AI-acceleration maturity. Lists
 *   EVERY library pack the node serves — SDK wrappers (auth/data/ai/storage…), vendored third-party
 *   libs (pixi/three/chartjs/p5/phaser/styling/mermaid) AND ready-made cortex UI — from
 *   GET /v1/library-packs, grouped by kind, each showing its tier (any | frontier | needs-doc), its
 *   per-model AEB proofs VISIBLY (tested on which model → pass/fail), and status (preview/stable).
 *   Clicking a card opens a detail view (GET /v1/library-packs/:id) with the full AI usage doc,
 *   changelog, include lines, API surface and the complete proof ledger. Reuses the polished
 *   ext-card / ext-detail-section styling so it matches the Extensions tab. (Extensions shows only
 *   cortex libs; this shows all.) Full scheme: tools/aeb/acceleration-tiers.md.
 * @structure LibrariesTab() — list (filter/group/ext-cards) ⇄ detail (ext-detail-sections)
 * @usage registered in profile.js TABS as id 'libraries'.
 * @version-history
 *   v1.2.0 — 2026-07-18 — reuse ext-card / badge / ext-detail-section styling to match Extensions.
 *   v1.1.0 — 2026-07-18 — clickable cards → full detail view (ai_doc, changelog, includes, proofs).
 *   v1.0.0 — 2026-07-18 — initial: unified library catalogue + maturity.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Spinner } from './shared.js';
import { CopyButton } from '/components/CopyButton.js';
const html = htm.bind(h);

const KIND_GROUPS = [
  { key: 'sdk', label: 'librariesTab.group.sdk' },
  { key: 'vendored', label: 'librariesTab.group.vendored' },
  { key: 'cortex', label: 'librariesTab.group.cortex' },
  { key: 'community', label: 'librariesTab.group.community' },
];
const TIER_FILTERS = ['all', 'any', 'frontier', 'needs-doc'];

// The tier is an INSTRUCTION to the reader ("this API has no training-data priors, so an
// AI must fetch its doc"), not a statement that documentation is missing. The raw key
// `needs-doc` read as "docs missing" to everyone including the registry's own author, so
// the badge shows the instruction and keeps the key only as a CSS/filter value.
function tierLabel(tier) {
  return t('profile.extensions.tierLabel.' + tier) || tier;
}

function tierBadge(p) {
  if (!p.modelTier) return null;
  const measured = p.proofs && p.proofs.length;
  return html`<span class="ext-tier ext-tier-${p.modelTier}${measured ? ' ext-tier-measured' : ''}"
    title=${t('profile.extensions.tier.' + p.modelTier)}>${tierLabel(p.modelTier)}</span>`;
}

function statusBadge(p) {
  const cls = p.status === 'stable' ? 'badge-success' : p.status === 'deprecated' ? 'badge-danger' : 'badge-muted';
  return html`<span class="badge ${cls}">${t('librariesTab.status.' + p.status) || p.status}</span>`;
}

function proofChips(p) {
  const proofs = p.proofs || [];
  if (!proofs.length) return html`<span class="lib-proof-none">${t('librariesTab.notTested')}</span>`;
  return proofs.map(pr => html`
    <span class="lib-proof-item lib-proof-${pr.verdict}">
      ${pr.model} ${pr.verdict === 'pass' ? '✓' : '✗'}${pr.tokens ? ' · ' + Math.round(pr.tokens / 1000) + 'k' : ''}
    </span>`);
}

export default function LibrariesTab() {
  const [packs, setPacks] = useState(null);
  const [tier, setTier] = useState('all');
  const [measuredOnly, setMeasuredOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    fetch('/v1/library-packs').then(r => r.json())
      .then(d => setPacks(d.data?.packs || []))
      .catch(() => setPacks([]));
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    setDetail(null);
    fetch('/v1/library-packs/' + encodeURIComponent(selectedId)).then(r => r.json())
      .then(d => setDetail(d.data?.pack || { error: true }))
      .catch(() => setDetail({ error: true }));
  }, [selectedId]);

  if (!packs) return html`<${Spinner} text=${t('librariesTab.loading')} />`;

  // ── Detail view ──────────────────────────────────────────────────────────
  if (selectedId) {
    if (!detail) return html`<${Spinner} text=${t('librariesTab.loading')} />`;
    const p = detail;
    return html`
      <div class="pf-section lib-detail ext-detail-wrap">
        <button class="btn-outline lib-back" onClick=${() => setSelectedId(null)}>← ${t('librariesTab.back')}</button>
        <div class="ext-card-header lib-detail-head">
          <span class="lib-detail-title">${p.title || p.id}</span>
          ${p.version ? html`<span class="ext-card-version">${p.version}</span>` : null}
          ${tierBadge(p)}
          ${statusBadge(p)}
        </div>
        <div class="lib-detail-desc">${p.description || ''}</div>
        <div class="lib-detail-metaline">
          ${p.apiSurface ? html`<span><b>${t('librariesTab.apiSurface')}:</b> <code>${p.apiSurface}</code></span>` : null}
          ${p.license ? html`<span><b>${t('librariesTab.license')}:</b> ${p.license}</span>` : null}
          ${p.sizeEstimate ? html`<span><b>${t('librariesTab.size')}:</b> ${p.sizeEstimate}</span>` : null}
          ${p.sourceUrl ? html`<a href=${p.sourceUrl} target="_blank" rel="noopener">${t('librariesTab.source')} ↗</a>` : null}
        </div>

        <div class="ext-detail-section">
          <div class="ext-detail-section-title">${'\u{1F3AF}'} ${t('librariesTab.maturityHeading')}</div>
          ${p.modelTier ? html`<div class="lib-tier-line">${tierBadge(p)} <span>${t('profile.extensions.tier.' + p.modelTier)}</span></div>` : null}
          ${p.apiCaveat ? html`<div class="lib-caveat">⚠ ${p.apiCaveat}</div>` : null}
          ${(p.proofs && p.proofs.length)
            ? html`<ul class="lib-proof-list">${p.proofs.map(pr => html`
                <li class="lib-proof-row lib-proof-${pr.verdict}">
                  <span class="lib-proof-model">${pr.model}</span>
                  <span class="lib-proof-verdict">${pr.verdict === 'pass' ? '✓ ' + t('librariesTab.pass') : '✗ ' + t('librariesTab.fail')}</span>
                  ${pr.tokens ? html`<span class="lib-proof-tok">${Math.round(pr.tokens / 1000)}k tok</span>` : null}
                  ${pr.date ? html`<span class="lib-proof-date">${pr.date}</span>` : null}
                  ${pr.evidence ? html`<span class="lib-proof-ev">${pr.evidence}</span>` : null}
                </li>`)}</ul>`
            : html`<div class="lib-proof-none">${t('librariesTab.notTested')}</div>`}
        </div>

        ${(p.include && p.include.length) ? html`
          <div class="ext-detail-section">
            <div class="ext-detail-section-title">${'\u{1F4E6}'} ${t('librariesTab.includeHeading')} <${CopyButton} text=${p.include.join('\n')} /></div>
            <div class="ext-detail-code">${p.include.join('\n')}</div>
          </div>` : null}

        ${p.ai_doc ? html`
          <div class="ext-detail-section">
            <div class="ext-detail-section-title">${'\u{1F4D6}'} ${t('librariesTab.aiDocHeading')} <${CopyButton} text=${p.ai_doc} /></div>
            <div class="ext-detail-code">${p.ai_doc}</div>
          </div>` : null}

        ${(p.changelog && p.changelog.length) ? html`
          <div class="ext-detail-section">
            <div class="ext-detail-section-title">${'\u{1F552}'} ${t('librariesTab.changelogHeading')}</div>
            <ul class="lib-changelog">${p.changelog.map(c => html`
              <li><span class="lib-cl-ver">${c.version}</span> <span class="lib-cl-date">${c.date}</span> — ${c.summary}${c.breaking ? html` <span class="lib-cl-breaking">${t('librariesTab.breaking')}: ${c.breaking}</span>` : null}</li>`)}
            </ul>
          </div>` : null}
      </div>`;
  }

  // ── List view ────────────────────────────────────────────────────────────
  const q = query.trim().toLowerCase();
  const shown = packs.filter(p => {
    if (tier !== 'all' && p.modelTier !== tier) return false;
    if (measuredOnly && !(p.proofs && p.proofs.length)) return false;
    if (q && !((p.id + ' ' + (p.title || '') + ' ' + (p.description || '')).toLowerCase().includes(q))) return false;
    return true;
  });
  const groupOf = p => (p.scope === 'community' ? 'community' : p.kind);

  return html`
    <div class="pf-section">
      <div class="section-title">${'\u{1F4DA}'} ${t('librariesTab.title')}</div>
      <div class="section-desc">${t('librariesTab.desc')}</div>

      <div class="lib-controls">
        <input type="text" class="lib-search" placeholder=${t('librariesTab.searchPlaceholder')}
          value=${query} onInput=${e => setQuery(e.target.value)} />
        <div class="lib-tier-filters">
          ${TIER_FILTERS.map(tf => html`
            <button class=${'btn-ghost lib-tier-btn' + (tier === tf ? ' lib-tier-active' : '')}
              onClick=${() => setTier(tf)}>${tf === 'all' ? t('librariesTab.tierAll') : tierLabel(tf)}</button>`)}
        </div>
        <label class="lib-measured-toggle">
          <input type="checkbox" checked=${measuredOnly} onChange=${e => setMeasuredOnly(e.target.checked)} />
          ${t('librariesTab.measuredOnly')}
        </label>
      </div>

      ${KIND_GROUPS.map(g => {
        const items = shown.filter(p => groupOf(p) === g.key);
        if (!items.length) return null;
        return html`
          <div class="lib-group">
            <div class="ext-installed-heading">${t(g.label)} (${items.length})</div>
            <div class="ext-grid">
              ${items.map(p => html`
                <div class="ext-card" onClick=${() => setSelectedId(p.id)}>
                  <div class="ext-card-header">
                    <span class="ext-card-name">${p.title || p.id}</span>
                    ${p.version ? html`<span class="ext-card-version">${p.version}</span>` : null}
                  </div>
                  <div class="ext-card-tags">
                    ${statusBadge(p)}
                    ${tierBadge(p)}
                  </div>
                  <div class="ext-card-desc">${p.description || ''}</div>
                  <div class="ext-card-footer lib-card-footer">
                    <span class="lib-tested"><span class="lib-tested-label">${t('librariesTab.tested')}:</span> ${proofChips(p)}</span>
                  </div>
                </div>`)}
            </div>
          </div>`;
      })}

      ${shown.length === 0 ? html`<div class="empty">${t('librariesTab.noneMatch')}</div>` : null}
    </div>`;
}
