/**
 * @file src/services/portfolio-config.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where an owner's welcome page (the portfolio) and its switch live, and the writes of
 *   the switch. Moved out of routes/portfolio.ts by pure extraction, so a service (the publish
 *   request applier, services/publish-requests/apply-portfolio.ts) switches the page on through the
 *   same function PUT /v1/portfolio/config uses, without importing a route. routes/portfolio.ts
 *   re-exports every name for its importers.
 * @structure PORTFOLIO_HTML_KEY · PORTFOLIO_CONFIG_KEY · portfolioWriteGaii · portfolioReadGaiis ·
 *   mergePortfolioConfig · portfolioSwitchState · switchPortfolioOnUnlessTurnedOff
 * @usage await mergePortfolioConfig(storage, await portfolioWriteGaii(storage, owner, nodeId), { enabled: true });
 * @version-history
 *   v1.2.0 — 2026-10-18 — mergePortfolioConfig and switchPortfolioOnUnlessTurnedOff write the config
 *     on its version (record-cas.ts updateRecord); the switch decides again on the stored record, so
 *     an owner's switch-off at the same moment stays off (atomic-write round).
 *   v1.1.0 — 2026-10-18 — portfolioSwitchState also answers `access`, who may open the page (plan
 *     doc-mvcn6c7e4e5q, V3.10; services/page-access.ts).
 *   v1.0.0 — 2026-10-18 — Extracted from routes/portfolio.ts (the keys, portfolioWriteGaii,
 *     portfolioReadGaiis, switchPortfolioOnUnlessTurnedOff, and the PUT /v1/portfolio/config write as
 *     mergePortfolioConfig); portfolioSwitchState added for the publish gate (plan doc-mvcn6c7e4e5q, V4).
 */
import type { Storage } from '../storage/interface.js';
import { updateRecord, UNCHANGED } from './record-cas.js';

/** Where this owner's portfolio file and config live. */
export const PORTFOLIO_HTML_KEY = 'portfolio/index.html';
export const PORTFOLIO_CONFIG_KEY = 'portfolio.config';

/**
 * Which identity a NEW portfolio write is stored under.
 *
 * Historically this was always the owner's first agent, which was safe while a portfolio could
 * only ever be built by someone who already had one. The remake reverses that order: the welcome
 * mat IS the portfolio and it is made BEFORE any agent exists (03-welcome-mat.md), so an
 * agent-keyed write has no key to use.
 *
 * An owner with an agent keeps writing exactly where they always did — the old path is unchanged
 * byte for byte. An owner with none writes under their own GHII, which is an identity they have
 * from the moment the account exists.
 */
export async function portfolioWriteGaii(
  storage: Storage, ownerName: string, nodeId: string,
): Promise<string> {
  const agents = await storage.getAgentsByOwner(ownerName);
  return agents.length ? agents[0].gaii : `${ownerName}@${nodeId}`;
}

/**
 * Every identity a portfolio might be stored under, newest convention first. Reads try each in
 * turn: an account that made its mat before connecting an agent has it under the GHII, and must
 * keep seeing it after the agent arrives.
 */
export async function portfolioReadGaiis(
  storage: Storage, ownerName: string, nodeId: string,
): Promise<string[]> {
  const agents = await storage.getAgentsByOwner(ownerName);
  return [...agents.map(a => a.gaii), `${ownerName}@${nodeId}`];
}

/** The stored config as an object to merge onto; nothing stored reads as empty. */
const configOf = (v: unknown): Record<string, unknown> => ((v ?? {}) as Record<string, unknown>);

/**
 * The PUT /v1/portfolio/config write: MERGES `patch` onto what is stored under `target`. A caller
 * that wants a field gone sends it as null rather than omitting it.
 */
export async function mergePortfolioConfig(
  storage: Storage, target: string, patch: Record<string, unknown>,
): Promise<void> {
  // On the record's version: two saves at the same moment each merge onto what the other wrote.
  await updateRecord(storage, target, PORTFOLIO_CONFIG_KEY, configOf, (prev) => ({ ...prev, ...patch }),
    { tag: 'portfolio', tags: (patch.tags as string[] | undefined) || ['portfolio'], visibility: 'owner' });
}

/**
 * The switch as the reader sees it (the first identity holding a config), and when the stored page
 * was written: `enabled` true (served), false (the owner switched it off) or null (never set).
 * `access` is who may open the page as stored (null for anyone; services/page-access.ts).
 */
export async function portfolioSwitchState(
  storage: Storage, ownerName: string, nodeId: string,
): Promise<{ enabled: boolean | null; pageAt: string | null; access: string | null }> {
  const gaiis = await portfolioReadGaiis(storage, ownerName, nodeId);
  let enabled: boolean | null = null;
  let access: string | null = null;
  for (const gaii of gaiis) {
    const mem = await storage.getMemory(gaii, PORTFOLIO_CONFIG_KEY);
    if (mem?.value && typeof mem.value === 'object') {
      const value = mem.value as Record<string, unknown>;
      const v = value.enabled;
      enabled = v === true ? true : v === false ? false : null;
      access = typeof value.access === 'string' ? value.access : null;
      break;
    }
  }
  let pageAt: string | null = null;
  for (const gaii of gaiis) {
    const meta = await storage.getStorageFileMeta(gaii, PORTFOLIO_HTML_KEY);
    if (meta) { pageAt = meta.createdAt; break; }
  }
  return { enabled, pageAt, access };
}

/**
 * Whether the owner's page is served after a publish, switching it on when the caller asks to.
 *
 * The page is served only when `portfolio.config` says `enabled`, and storing a page does not set
 * that: the file and the switch are two acts (e2e-remake-home holds it). Only the welcome-mat paste
 * set the switch, so a card an AI published for a person who never pasted a mat answered 404 at the
 * address the tool handed back (measured 2026-10-03, e2e-home-journey test 5). With `enable`, which
 * the AI sends when the person approved the page and wants it public, the switch is set the way the
 * paste sets it, merged onto what is stored. An owner who switched their page OFF keeps it off: that
 * is their decision, and the caller says so instead of handing out a dark address.
 */
export async function switchPortfolioOnUnlessTurnedOff(
  storage: Storage, nodeId: string, ownerName: string, target: string, enable: boolean,
): Promise<boolean> {
  let current: Record<string, unknown> | null = null;
  for (const gaii of await portfolioReadGaiis(storage, ownerName, nodeId)) {
    const mem = await storage.getMemory(gaii, PORTFOLIO_CONFIG_KEY);
    if (mem?.value && typeof mem.value === 'object') { current = mem.value as Record<string, unknown>; break; }
  }
  if (current?.enabled === false) return false;
  if (current?.enabled === true) return true;
  if (!enable) return false;
  // Decided again on the target's record as it is stored, and written on its version: an owner who
  // switches the page off at the same moment keeps it off, and this caller is told so.
  let on = true;
  await updateRecord<Record<string, unknown> | null>(storage, target, PORTFOLIO_CONFIG_KEY,
    (v) => (v && typeof v === 'object' ? v as Record<string, unknown> : null),
    (stored) => {
      on = stored?.enabled !== false;
      if (stored?.enabled === false || stored?.enabled === true) return UNCHANGED;
      const prev = stored ?? current ?? {};
      return { ...prev, enabled: true, source: prev.source ?? 'ai' };
    }, { tag: 'portfolio', visibility: 'owner' });
  return on;
}
