/**
 * @file extensions-tab.maturity.js
 * @description The AI-acceleration maturity badge for the Cortex Libraries cards — joins each
 *   library card onto the node's library-pack registry (GET /v1/library-packs) so a user browsing
 *   their libraries sees how mature/measured each is: its tier (any | frontier | needs-doc) and the
 *   per-model AEB proofs (which model was tested, pass/fail). Full scheme: tools/aeb/acceleration-tiers.md.
 * @structure useMaturityLedger() — fetch the tier/proof map once · maturityBadge(html, t, ledger, name)
 * @usage import { useMaturityLedger, maturityBadge } from './extensions-tab.maturity.js';
 * @version-history
 *   v1.0.0 — 2026-07-18 — initial: surface tier + proof ledger on the Cortex Libraries cards.
 */
import { useState, useEffect } from 'preact/hooks';

/** Fetch the node's library-pack tier/proof ledger once, keyed by pack id (public endpoint). */
export function useMaturityLedger() {
  const [ledger, setLedger] = useState({});
  useEffect(() => {
    fetch('/v1/library-packs').then(r => r.json()).then(d => {
      const map = {};
      for (const p of (d.data?.packs || [])) if (p.modelTier) map[p.id] = p;
      setLedger(map);
    }).catch(() => { /* older node without the endpoint — cards just omit the badge */ });
  }, []);
  return ledger;
}

/**
 * The tier + measured-on badge for a library card, or null when the pack has no registry tier
 * (e.g. a community cortex the node hasn't classified). `html` and `t` are passed in so this stays
 * a plain module (no htm/i18n binding of its own).
 */
export function maturityBadge(html, t, ledger, name) {
  const p = ledger[name];
  if (!p || !p.modelTier) return null;
  const proofs = p.proofs || [];
  const proven = proofs.map(pr => `${pr.model} → ${pr.verdict}${pr.tokens ? ' (' + Math.round(pr.tokens / 1000) + 'k)' : ''}`).join(', ');
  const title = t('profile.extensions.tier.' + p.modelTier)
    + ' · ' + (proofs.length ? t('profile.extensions.measuredOn') + ' ' + proven : t('profile.extensions.notMeasured'));
  // Show the instruction ("READ THE DOC"), not the raw key — `needs-doc` reads as
  // "documentation missing", which is the opposite of what the tier means.
  const label = t('profile.extensions.tierLabel.' + p.modelTier) || p.modelTier;
  return html`<span class="ext-tier ext-tier-${p.modelTier}${proofs.length ? ' ext-tier-measured' : ''}" title=${title}>${label}${proofs.length ? ' ✓' : ''}</span>`;
}
