/**
 * @file src/services/handover-link.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A one-time sign-in link for the person this node was set up for, handed to the caller
 *   instead of mailed. The store's "Open your own AIMEAT" button uses it: the fleet's control service
 *   runs `aimeat handover-link` inside the place's container (cli/handover-link.ts) and passes the
 *   link to the thank-you page, so the buyer is signed in on the first press (Jouni, v27 P3,
 *   2026-10-31).
 *
 *   NO NETWORK ENDPOINT. The only caller is a command inside the node's own container, which already
 *   holds the database, so the link adds no reach that the caller did not have. An HTTP endpoint would
 *   need a credential the control service does not hold after the assignment (aimeat-commercial,
 *   2026-10-31).
 *
 *   THE LINK IS THE EMAILED ONE. issueLoginLink() writes the row the mail would carry, so the open
 *   endpoint (routes/ghii/login-link-open.ts) spends it once, checks that the account is live and
 *   still has the login link on, and runs the second factor when the account has one.
 *
 *   WHOSE LINK. A named account, or, with none named, the one account on this node that can open a
 *   link (active, a verified email, the login link on). Two or more such accounts and no name is a
 *   refusal that lists them: the command never guesses between people.
 *
 *   FRESH EACH TIME. Every call issues a new link; an earlier one stays valid until it is used or its
 *   ten minutes run out.
 * @structure issueHandoverLink(storage, config, { account?, lang? }) · HANDOVER_LINK_TTL_MS · HandoverResult
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (Jouni v27 P3: the store's button signs the buyer straight in).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, GHIIRecord } from '../storage/interface.js';
import { validateOwnerName } from '../utils/gaii.js';
import { issueLoginLink } from './login-link.js';

/** How long a handed-over link opens: long enough for a thank-you page to be read, short enough to be worthless once it is not. */
export const HANDOVER_LINK_TTL_MS = 10 * 60 * 1000;

/** Where the link lands: the person's own start page. */
const LANDING = '/v1/home';
const LANGS = ['fi', 'en', 'es'];

export type HandoverResult =
    | { ok: true; url: string; account: string; expires_at: string; lands_on: string }
    | { ok: false; code: 'INVALID_INPUT' | 'NOT_FOUND' | 'ACCOUNT_DISABLED' | 'LOGIN_LINK_OFF' | 'NO_OWNER' | 'AMBIGUOUS'; message: string; candidates?: string[] };

/** An account a link can open for: live, with a verified email and the login link on. */
function canOpen(ghii: GHIIRecord | null): ghii is GHIIRecord & { notificationEmail: string } {
    return !!ghii && ghii.magicLinkEnabled === true && typeof ghii.notificationEmail === 'string' && ghii.notificationEmail !== '';
}

/**
 * Issue the link. `account` names the person; without it, the single account a link can open for.
 * `lang` (fi, en or es) is carried to the landing page as ?lang=, so the first screen speaks it.
 */
export async function issueHandoverLink(
    storage: Storage, config: AimeatConfig, opts: { account?: string; lang?: string } = {},
): Promise<HandoverResult> {
    if (opts.lang !== undefined && !LANGS.includes(opts.lang)) {
        return { ok: false, code: 'INVALID_INPUT', message: `lang must be one of ${LANGS.join(', ')}.` };
    }
    let name = opts.account?.trim() ?? '';
    if (name) {
        const nameError = validateOwnerName(name);
        if (nameError) return { ok: false, code: 'INVALID_INPUT', message: `account: ${nameError}` };
    } else {
        const live = (await storage.listOwners()).filter(o => !o.disabledAt);
        const openable: string[] = [];
        for (const o of live) {
            if (canOpen(await storage.getGHII(`${o.name}@${config.nodeId}`))) openable.push(o.name);
        }
        if (openable.length === 0) return { ok: false, code: 'NO_OWNER', message: 'This node has no account with a verified email and the login link on yet.' };
        if (openable.length > 1) {
            return { ok: false, code: 'AMBIGUOUS', message: 'More than one account can open a link. Name one with --account.', candidates: openable.sort() };
        }
        name = openable[0];
    }

    const owner = await storage.getOwner(name);
    const ghii = owner ? await storage.getGHII(`${name}@${config.nodeId}`) : null;
    if (!owner || !ghii) return { ok: false, code: 'NOT_FOUND', message: `There is no account "${name}" on this node.` };
    if (owner.disabledAt) return { ok: false, code: 'ACCOUNT_DISABLED', message: `The account "${name}" is deactivated.` };
    if (!canOpen(ghii)) {
        return { ok: false, code: 'LOGIN_LINK_OFF', message: `The account "${name}" has no verified email with the login link on, so a link could not be opened.` };
    }

    const landsOn = opts.lang ? `${LANDING}?lang=${opts.lang}` : LANDING;
    const expiresAt = new Date(Date.now() + HANDOVER_LINK_TTL_MS).toISOString();
    const url = await issueLoginLink(storage, config, ghii, ghii.notificationEmail, HANDOVER_LINK_TTL_MS, landsOn);
    return { ok: true, url, account: name, expires_at: expiresAt, lands_on: landsOn };
}
