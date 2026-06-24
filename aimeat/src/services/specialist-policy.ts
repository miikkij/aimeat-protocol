/**
 * @file specialist-policy.ts
 * @description The operating-model (capability bands) taxonomy for specialist agents — the SAME model
 *   as the personal Secretary's (bands act/draft/ask/off per capability + a stop-spending hard switch +
 *   a daily morsel budget), so a specialist's bands/cost-guard behave exactly like the Secretary's
 *   (Secretary P5 / S-A). This is the backend mirror of the frontend
 *   `public/js/services/secretary-policy.js`; the two MUST stay in sync (this node schema wins on any
 *   mismatch). Stored per-specialist in owner memory `specialist.<name>.config.policy`.
 * @structure BANDS · SPECIALIST_CAPABILITIES · defaultSpecialistPolicy() · mergeSpecialistPolicy()
 * @version-history
 *   v1.0.0 — 2026-06-24 — Initial: backend operating-model taxonomy for specialist agents (S-A)
 */

/** Autonomy bands, least → most restrictive. Mirrors secretary-policy.js BANDS. */
export const BANDS = ['act', 'draft', 'ask', 'off'] as const;
export type Band = typeof BANDS[number];

/** A specialist capability + its conservative Community default band. Mirrors SECRETARY_CAPABILITIES. */
export interface SpecialistCapability {
  id: string;
  defaultBand: Band;
  locked?: boolean;     // user cannot change it (discover stays act)
  free?: boolean;       // costs no morsels, never blocked by stop-spending
  costs?: boolean;      // money/outbound action
  enterprise?: boolean; // needs scopes the Community edition withholds
}

/** The specialist operating surface — identical to the Secretary's (see secretary-policy.js). */
export const SPECIALIST_CAPABILITIES: SpecialistCapability[] = [
  { id: 'discover',            defaultBand: 'act',   locked: true, free: true },
  { id: 'file_intake',         defaultBand: 'act' },
  { id: 'briefing',            defaultBand: 'act' },
  { id: 'reminders',           defaultBand: 'act' },
  { id: 'curate_knowledge',    defaultBand: 'draft' },
  { id: 'draft_replies',       defaultBand: 'draft' },
  { id: 'create_resource',     defaultBand: 'ask' },
  { id: 'delegate',            defaultBand: 'ask',   costs: true },
  { id: 'resource_invoke',     defaultBand: 'ask',   costs: true, enterprise: true },
  { id: 'third_party_message', defaultBand: 'ask',   costs: true, enterprise: true },
  { id: 'spend',               defaultBand: 'ask',   costs: true, enterprise: true },
];

export interface SpecialistPolicy {
  stopSpending: boolean;
  dailyMorselBudget: number | null;
  bands: Record<string, Band>;
}

/** The conservative default operating model seeded when a specialist is created. */
export function defaultSpecialistPolicy(): SpecialistPolicy {
  const bands: Record<string, Band> = {};
  for (const c of SPECIALIST_CAPABILITIES) bands[c.id] = c.defaultBand;
  return { stopSpending: false, dailyMorselBudget: null, bands };
}

/**
 * Merge a stored (possibly partial / older) policy onto the current defaults so new capabilities always
 * get a band and locked ones stay correct. Mirrors secretary-policy.js mergePolicy().
 */
export function mergeSpecialistPolicy(stored: unknown): SpecialistPolicy {
  const base = defaultSpecialistPolicy();
  const p = (stored && typeof stored === 'object') ? stored as Partial<SpecialistPolicy> : {};
  const storedBands = (p.bands && typeof p.bands === 'object') ? p.bands as Record<string, string> : {};
  const bands: Record<string, Band> = { ...base.bands };
  for (const [k, v] of Object.entries(storedBands)) {
    if ((BANDS as readonly string[]).includes(v)) bands[k] = v as Band;
  }
  // Locked capabilities are always forced to their default band.
  for (const c of SPECIALIST_CAPABILITIES) if (c.locked) bands[c.id] = c.defaultBand;
  return {
    stopSpending: !!p.stopSpending,
    dailyMorselBudget: (typeof p.dailyMorselBudget === 'number' && p.dailyMorselBudget >= 0) ? p.dailyMorselBudget : null,
    bands,
  };
}
