/**
 * @file src/services/finance/accountant-grant-ask.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step: the accountant grants from before grant times were kept, whose
 *   holder the estimate cannot place, are asked of the client with one press: "Does <name> still get to
 *   read your books?". Allow keeps the grant and records it as confirmed; Don't allow removes it. Until
 *   the client answers, the grant works as before.
 *
 *   WHY. An account name is released for reuse when its account is erased, and a grant names the
 *   accountant by `name@node`. Round 8 dated each new grant (grantedAt) and dated an older entry by its
 *   list's last write (services/finance/accountant-access.ts grantedToCurrentHolder): an account
 *   registered after that is a later holder and reads nothing. An account registered after the list was
 *   first written and no later than its last write may be the person the grant was made for, or a later
 *   holder of the name whose grant was made to someone erased in between; the estimate cannot tell
 *   (secaudit2026oct26, finance/accountant-access:grant-survives-erasure-rebinds-on-name-reuse). Entries
 *   the estimate decides with certainty are not touched.
 *
 *   THE QUESTION. Filed in the client's request store under the approval standard
 *   (services/approval-standard.ts, publish-requests/store.ts, kind 'accountant-grant'): the client gets
 *   a notice with Allow and Don't allow, sees it pending on GET /v1/publish-requests/:id and the MCP tool
 *   aimeat_publish_requests, and an agent of the client holding finance:write may answer it. Allow
 *   (publish-requests/apply-accountant-grant.ts) dates the entry now and records it as confirmed;
 *   Don't allow (declineAccountantGrant) removes it from the client's list, as the client's own revoke
 *   does. An entry that changed holder since the question, or is gone, ends the question `outdated`.
 * @structure ACCOUNTANT_GRANT_ASK_STEP_KEY · askUncertainAccountantGrantsOnce · declineAccountantGrant
 * @usage await askUncertainAccountantGrantsOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v1.0.0 -- 2026-10-29 -- Initial (secaudit2026oct26 round 8c, finance/accountant-access:grant-survives-erasure-rebinds-on-name-reuse).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { listAllMemoryPages } from '../../storage/memory-pages.js';
import { localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { claimOnceOnlyStep } from '../once-only-step.js';
import { filePublishRequest, type PublishRequest, type PublishStoreCtx } from '../publish-requests/store.js';
import { uncertainAccountantEntries, revokeAccountant } from './accountant-access.js';

/** The record under `system@<nodeId>` that says the step has run. */
export const ACCOUNTANT_GRANT_ASK_STEP_KEY = 'migrations.secaudit2026oct26.accountant-grant-ask';

/**
 * File one question per uncertain entry, in the client's own request store. Changes no grant.
 * Throws when a read fails, and then leaves no record, so the next start tries again; a question that
 * cannot be filed is logged and the grant keeps working as before.
 * @returns the questions filed, as `<client> <accountant>`, or null on a node that ran the step before
 */
export async function askUncertainAccountantGrantsOnce(storage: Storage, config: AimeatConfig): Promise<string[] | null> {
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, ACCOUNTANT_GRANT_ASK_STEP_KEY);
  if (!claim) return null;
  try {
    const asked: string[] = [];
    const { items } = await listAllMemoryPages(storage, { prefix: 'finance.accountants' });
    for (const rec of items) {
      if (rec.key !== 'finance.accountants') continue;
      for (const { accountant, registeredAt } of await uncertainAccountantEntries(storage, rec)) {
        const filed = await askClient({ storage, config }, rec.ownerGaii, accountant, registeredAt);
        if (filed) asked.push(`${rec.ownerGaii} ${accountant}`);
      }
    }
    await claim.finish({ at: new Date().toISOString(), asked });
    if (asked.length) logger.info(`${asked.length} older accountant grant(s) are asked of their clients`);
    return asked;
  } catch (err) {
    await claim.release();
    throw err;
  }
}

async function askClient(ctx: PublishStoreCtx, clientGhii: string, accountant: string, registeredAt: string): Promise<boolean> {
  const name = localAccountName(accountant);
  const filed = await filePublishRequest(ctx, clientGhii, {
    kind: 'accountant-grant',
    target: { accountant, registered_at: registeredAt },
    title: `whether ${name} still reads your books`,
    name,
    change: { field: 'accountant', from: accountant, to: 'confirmed' },
    // The node asks on the client's own account: nobody else asked, and the client hears no answer
    // from themselves (approval-standard.ts tellAsker).
    requested_by: { principal: clientGhii, kind: 'person', sub: clientGhii },
    approval: {
      approver: 'owner',
      asks: `confirm that ${name} still gets to read your books`,
      why: `You gave ${name} the right to read your books before the server kept the date of each right. The account named ${name} was created after you began giving rights, so the server cannot tell whether it is the person you gave the right to: a deleted account's name can be registered again by someone else. Until you answer, ${name} reads your books as before. If you do not allow it, the right is removed.`,
      approve_scope: 'finance:write',
      change: { link: '/v1/profile?tab=pnl', key: 'approval_change.accountants' },
      i18n: { key: 'approval_accountant_grant', vars: { name } },
    },
  });
  if (!filed.ok) {
    logger.warn('finance: an older accountant grant could not be asked of the client; it works as before', { client: clientGhii, accountant, error: filed.message });
    return false;
  }
  return true;
}

/** Don't allow: the entry leaves the client's list, as the client's own revoke takes it off. */
export async function declineAccountantGrant(ctx: PublishStoreCtx, clientGhii: string, request: PublishRequest): Promise<void> {
  const accountant = String(request.target.accountant ?? '');
  if (!accountant) return;
  await revokeAccountant(ctx.config, ctx.storage, clientGhii, localAccountName(accountant));
  logger.info('finance: the client did not allow an older accountant grant; it is removed', { client: clientGhii, accountant });
}
