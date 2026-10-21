/**
 * @file src/services/upload-principal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Is the principal a presigned upload URL was minted for still there? Asked at
 *   PUT /v1/upload/:token before anything is written.
 *
 *   An upload token is a credential the PUT verifies itself, so it never passes the per-request
 *   revocation check every bearer passes (auth/credential-revoked.ts credentialRevoked). Without this
 *   an agent the owner deleted kept writing through a URL it minted earlier, for up to the token's
 *   hour, and stored the file under the deleted agent's GAII (secaudit 2026-10,
 *   PUT-v1-upload:no-live-principal-recheck). The questions are the ones credentialRevoked asks that
 *   a token carrying no session or grant id can answer:
 *     - its agent is gone: the agent the token was minted for has no record now, or its record is
 *       newer than the token (the name was released and registered again);
 *     - its ecosystem app is gone: no record, not active, or newer than the token;
 *     - its account refuses it: no account holds the name, the account is deactivated, or the
 *       account is newer than the token. Asked of the principal's account and, when the URL lands in
 *       another account's bucket (a shared app publish), of that account too.
 *
 *   WHO IS NOT ASKED. A visitor from another node names no account of this node, so the account
 *   question is not asked of it (its home node answers for it). A principal with a `#` that named no
 *   agent record at the mint (a scoped personal access token, an app) is asked only the account
 *   question; the token says which it was (`actor_agent`, services/upload-token.ts). A token minted
 *   before 2026-10-20 carries no `actor_agent`, so a missing agent record passes for it, but a record
 *   newer than it is still refused; such a token lives an hour at most.
 *
 *   NOT ASKED HERE. Whether the session or app grant that asked for the URL was signed out or revoked:
 *   the token carries neither id. The permission words are a separate question, asked by the publish
 *   gate from the agent's current record at the PUT (services/publish-requests/upload-gate.ts).
 * @structure uploadPrincipalRefusal(storage, verified) → string | null
 * @usage
 *   const refused = await uploadPrincipalRefusal(storage, verified);
 *   if (refused) return res.status(401).json({ success: false, error: 'TOKEN_INVALID', message: refused });
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (secaudit 2026-10, PUT-v1-upload:no-live-principal-recheck).
 */
import type { Storage } from '../storage/interface.js';
import type { VerifiedUploadToken } from './upload-token.js';
import { isGEAI, localAccountOf } from '../utils/gaii.js';
import { madeAfter, ownerRefuses, tokenIssuedAt, type IssuedAt } from '../auth/credential-age.js';

/** The answer a refused upload carries: what happened and what to do, in plain words. */
const GONE = 'The agent or app this upload URL was made for no longer exists, or was replaced. Nothing was stored.';
const ACCOUNT = 'The account this upload URL was made for is closed or no longer the same account. Nothing was stored.';

/** Is the agent or ecosystem app `principal` gone, as of a token issued at `issued`? */
async function principalGone(
    storage: Storage, principal: string, issued: IssuedAt | null, wasAgent: boolean,
): Promise<boolean> {
    if (!principal.includes('#')) return false;
    if (isGEAI(principal)) {
        const app = await storage.getEcosystemApp(principal);
        return !app || app.status !== 'active' || madeAfter(app.createdAt, issued);
    }
    const agent = await storage.getAgent(principal);
    if (!agent) return wasAgent;
    return madeAfter(agent.createdAt, issued);
}

/** Does the account `identity` names on this node refuse a token issued at `issued`? */
async function accountGone(storage: Storage, identity: string, issued: IssuedAt | null): Promise<boolean> {
    const account = localAccountOf(identity);
    if (!account) return false;
    return ownerRefuses(await storage.getOwner(account), issued);
}

/**
 * Null when the upload may go on; otherwise the sentence to refuse it with (401). Uncached, for the
 * reason the bearer checks are: an owner pressing Delete means now.
 */
export async function uploadPrincipalRefusal(
    storage: Storage,
    verified: Pick<VerifiedUploadToken, 'sub' | 'actor' | 'iat' | 'iatMs' | 'actorIsAgent'>,
): Promise<string | null> {
    const issued = tokenIssuedAt(verified);
    const actor = verified.actor || verified.sub;
    if (await principalGone(storage, actor, issued, verified.actorIsAgent)) return GONE;
    if (await accountGone(storage, actor, issued)) return ACCOUNT;
    if (localAccountOf(verified.sub) !== localAccountOf(actor) && await accountGone(storage, verified.sub, issued)) return ACCOUNT;
    return null;
}
