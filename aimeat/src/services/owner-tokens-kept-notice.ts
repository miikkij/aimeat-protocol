/**
 * @file src/services/owner-tokens-kept-notice.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description After a password reset, a password change or "sign out everywhere", the person is told
 *   which of their own access tokens still act as them (secaudit2026oct26,
 *   owner-session.ts:endPersonSessionsAfterPasswordChange:owner-level-pat-session-survives-reset).
 *
 *   An access token made with "Full" (grant_owner) or the operator level is a durable credential the
 *   person made for a program, and none of these three acts ends it: ending them would stop every
 *   program the person runs on one. But a reset is what a person does when someone else may have
 *   had the account, and such a token is how that someone would keep it. So the act stays as it is,
 *   and the person gets a bell notice that names each such token and opens the Access page, where
 *   each one is removed with one press. Scoped tokens act as a test agent, not as the person, and
 *   are not named.
 * @structure OWNER_TOKENS_KEPT_TYPE · ownerTokensKeptNotice · tellOwnerTokensKept
 * @usage void tellOwnerTokensKept(storage, config, ownerName);
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PatRecord } from '../storage/repositories/pat.repository.js';
import { notify, type NotifyInput } from './notify.js';
import { logger } from '../utils/logger.js';

export const OWNER_TOKENS_KEPT_TYPE = 'owner_tokens_kept';

/** The access tokens that act as the person (Full or operator level) and still work at `now`. */
function ownerLevel(pats: PatRecord[], now: number): PatRecord[] {
  return pats.filter(p => !p.revoked && (p.grantOwner || p.grantOperator)
    && (!p.expiresAt || Date.parse(p.expiresAt) > now));
}

/** The bell notice naming the tokens; null when there is none to name. */
export function ownerTokensKeptNotice(pats: PatRecord[], now = Date.now()): NotifyInput | null {
  const kept = ownerLevel(pats, now);
  if (kept.length === 0) return null;
  const names = kept.map(p => `"${p.label}"`).join(', ');
  return {
    type: OWNER_TOKENS_KEPT_TYPE,
    title: 'Your access tokens still work',
    body: `Signing out and a new password do not end your access tokens. These can still act as you: ${names}. `
      + 'If you do not know one of them, remove it on your Access page.',
    link: '/v1/profile#access',
    i18n: { key: OWNER_TOKENS_KEPT_TYPE, vars: { names, count: kept.length } },
    actions: [{ id: 'open', label: 'Open the Access page', kind: 'navigate', link: '/v1/profile#access', i18n: { key: `${OWNER_TOKENS_KEPT_TYPE}.open` } }],
  };
}

/** Tell the person, in the bell, which tokens still act as them. Never throws: the act already stands. */
export async function tellOwnerTokensKept(storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, ownerName: string): Promise<void> {
  try {
    const notice = ownerTokensKeptNotice(await storage.listPats(ownerName));
    if (notice) await notify(storage, `${ownerName}@${config.nodeId}`, notice);
  } catch (err) {
    logger.warn('owner-tokens-kept: the person could not be told which access tokens still work', { owner: ownerName, error: String(err) });
  }
}
