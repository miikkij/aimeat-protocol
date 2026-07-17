/**
 * @file libraries-tab.js
 * @description Profile tab: the full client-library catalogue with AI-acceleration maturity. Lists
 *   EVERY library pack the node serves — SDK wrappers (auth/data/ai/storage…), vendored third-party
 *   libs (pixi/three/chartjs/p5/phaser/styling/mermaid) AND ready-made cortex UI — from
 *   GET /v1/library-packs, grouped by kind, each showing its tier (any | frontier | needs-doc), its
 *   per-model AEB proofs VISIBLY (tested on which model → pass/fail), and status (preview/stable). So
 *   a user can see, in one place, how mature + measured each library is. Full scheme:
 *   tools/aeb/acceleration-tiers.md. (The Extensions tab shows only cortex libs; this shows all.)
 * @structure LibrariesTab() — fetch /v1/library-packs → filter (kind/tier/measured/search) → grouped cards
 * @usage registered in profile.js TABS as id 'libraries'.
 * @version-history
 *   v1.0.0 — 2026-07-18 — initial: unified library catalogue + maturity (tier + per-model proofs).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Spinner } from './shared.js';
const html = htm.bind(h);

// Display order + labels for the kind groups (SDK first — the platform baseline — then the
// vendored accelerators, then the ready-made cortex UI, then community-published packs).
const KIND_GROUPS = [
  { key: 'sdk', label: 'librariesTab.group.sdk' },
  { key: 'vendored', label: 'librariesTab.group.vendored' },
  { key: 'cortex', label: 'librariesTab.group.cortex' },
  { key: 'community', label: 'librariesTab.group.community' },
];
const TIER_FILTERS = ['all', 'any', 'frontier', 'needs-doc'];

export default function LibrariesTab() {
  const [packs, setPacks] = useState(null);
  const [tier, setTier] = useState('all');
  const [measuredOnly, setMeasuredOnly] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetch('/v1/library-packs').then(r => r.json())
      .then(d => setPacks(d.data?.packs || []))
      .catch(() => setPacks([]));
  }, []);

  if (!packs) return html`<${Spinner} text=${t('librariesTab.loading')} />`;

  const q = query.trim().toLowerCase();
  const shown = packs.filter(p => {
    if (tier !== 'all' && p.modelTier !== tier) return false;
    if (measuredOnly && !(p.proofs && p.proofs.length)) return false;
    if (q && !((p.id + ' ' + (p.title || '') + ' ' + (p.description || '')).toLowerCase().includes(q))) return false;
    return true;
  });
  const groupOf = p => (p.scope === 'community' ? 'community' : p.kind);

  const proofLine = (p) => {
    const proofs = p.proofs || [];
    if (!proofs.length) return html`<span class="lib-proof lib-proof-none">${t('librariesTab.notTested')}</span>`;
    return html`<span class="lib-proof">${proofs.map(pr => html`
      <span class="lib-proof-item lib-proof-${pr.verdict}">
        ${pr.model} → ${pr.verdict === 'pass' ? '✓ ' + t('librariesTab.pass') : '✗ ' + t('librariesTab.fail')}${pr.tokens ? ' · ' + Math.round(pr.tokens / 1000) + 'k' : ''}
      </span>`)}</span>`;
  };

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
              onClick=${() => setTier(tf)}>${tf === 'all' ? t('librariesTab.tierAll') : tf}</button>`)}
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
            <div class="lib-group-heading">${t(g.label)} (${items.length})</div>
            <div class="lib-grid">
              ${items.map(p => html`
                <div class="lib-card">
                  <div class="lib-card-head">
                    <span class="lib-card-name">${p.title || p.id}</span>
                    ${p.version ? html`<span class="lib-card-version">${p.version}</span>` : null}
                    ${p.modelTier ? html`<span class="ext-tier ext-tier-${p.modelTier}${(p.proofs && p.proofs.length) ? ' ext-tier-measured' : ''}" title=${t('profile.extensions.tier.' + p.modelTier)}>${p.modelTier}</span>` : null}
                    <span class="lib-status lib-status-${p.status}">${t('librariesTab.status.' + p.status) || p.status}</span>
                  </div>
                  <div class="lib-card-desc">${p.description || ''}</div>
                  <div class="lib-card-meta">
                    <span class="lib-tested-label">${t('librariesTab.tested')}:</span> ${proofLine(p)}
                  </div>
                  ${(p.include && p.include.length) ? html`<code class="lib-include">${p.include[0]}</code>` : null}
                </div>`)}
            </div>
          </div>`;
      })}

      ${shown.length === 0 ? html`<div class="empty">${t('librariesTab.noneMatch')}</div>` : null}
    </div>`;
}
