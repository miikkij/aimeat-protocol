/**
 * @file src/services/app-parties/iam-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A person registered to an app (plan doc-mvwxcas3dom3, D4) as a member AIMEAT.iam can
 *   read, so an app has one member model for everybody: the account holders on its roster and the
 *   people who registered with an e-mail link (WP9d). Two endpoints take the app party token for this:
 *
 *   GET /v1/apps/{owner}/{filename}/members/me answers the party's standing in the shape it answers an
 *   account holder (rosterMe in services/app-roster-ops.ts), with `kind: 'party'`: the roster row
 *   without the owner's note, the role, never isOwner and never canManage. This is the read
 *   AIMEAT.iam.init, can() and guard() make on an app with no extension.
 *
 *   POST /v1/ext/{extension}/{action} runs an action of the app's IAM extension for the party. The
 *   SECURITY REASONING, since the path cannot say which app a token is for:
 *   - The auth middleware lets an app party token through on that path shape only
 *     (services/parties/contract.ts PARTY_TOKEN_ROUTES: two segments, POST). The instance form and the
 *     literal `<owner>/<name>/<action>` form stay refused 401 there.
 *   - routes/extensions/actions.ts sends every party token on it here before anything else reads the
 *     request, so it never falls through to the visitor path or to requireAuth.
 *   - appPartyForExtensionCall reads the app from the token's own signed claim, never from the request,
 *     and then runs appPartyFromRequest for that app: the token's epoch, the party's status, the node's
 *     setting and the Origin. A token of the owner's own parties (no `app` claim) is refused 401.
 *   - services/extension-invoke.ts then refuses, before the extension's status or its actions are
 *     read, every extension whose gated app (`config.app`, resolveGatedApp) is not the token's app:
 *     403 PARTY_NOT_FOR_EXTENSION, the same answer for an extension that does not exist, so a party
 *     learns nothing about the owner's other extensions. A priced action is refused 403
 *     PARTY_CANNOT_PAY, since a party holds no wallet.
 *   - The run sees `ctx.caller` naming the party (`gaii` and `owner` are its identity
 *     `party:<owner>/ap-…@<node>`, `party` holds its name and app), with `member` read from the app's
 *     roster by the node. It is never the app's owner and never anonymous. The capabilities that act
 *     for an account (wallet, files, data packages, workspace, notify, mail, purchases, AI jobs) are
 *     left out, as for a visitor; the extension's own memory reads and writes as for any caller.
 * @structure appOfPartyToken · partyRosterMe · appPartyForExtensionCall · partyBearer
 * @usage const v = await appPartyForExtensionCall(deps, req); if (!v.ok) return refuse(v);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP9d: AIMEAT.iam for every member of an app).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { getMember } from '../app-members.js';
import { done, type AppOpOutcome } from '../app-op-outcome.js';
import { PARTY_TOKEN_PREFIX } from '../parties/contract.js';
import { verifyPartyToken } from '../parties/token.js';
import { appPartyView } from './contract.js';
import { appPartyFromRequest, type AppPartyCtx, type AppRef } from './service.js';

type Deps = { storage: Storage; config: AimeatConfig };
type Headers = { headers: Record<string, string | string[] | undefined> };
type Refusal = { ok: false; status: number; code: string; message: string };

/** The Bearer value of the request when it is a party token, else null. */
export function partyBearer(req: Headers): string | null {
    const raw = req.headers.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (typeof header !== 'string' || !header.startsWith(`Bearer ${PARTY_TOKEN_PREFIX}`)) return null;
    return header.slice('Bearer '.length).trim();
}

/** The app an app party token is for, from its signed claim. Null for any other credential. */
export async function appOfPartyToken(req: Headers): Promise<AppRef | null> {
    const token = partyBearer(req);
    if (!token) return null;
    const claims = await verifyPartyToken(token);
    const app = claims?.app;
    if (!app) return null;
    const cut = app.indexOf('/');
    if (cut <= 0 || cut === app.length - 1) return null;
    return { owner: app.slice(0, cut), filename: app.slice(cut + 1) };
}

/** GET .../members/me for an app party: rosterMe's shape, for the party (see the file header). */
export async function partyRosterMe(deps: Deps, ctx: AppPartyCtx): Promise<AppOpOutcome> {
    const member = await getMember(deps.storage, ctx.appId, ctx.partyRef);
    // The row without the owner's side of it, as rosterMe answers an account holder.
    const own = member ? (({ note: _note, approvedBy: _by, ...rest }) => rest)(member) : null;
    return done({
        member: own, isOwner: false, canManage: false, kind: 'party',
        identity: ctx.partyRef, displayName: ctx.party.displayName || null,
        role: member?.role ?? null, requested: null,
        party: appPartyView(ctx.party, ctx.partyRef),
    });
}

/**
 * The app party behind POST /v1/ext/{extension}/{action}, or the refusal. The app is the one the
 * token's signed claim names; appPartyFromRequest then checks the party for that app. Which extension
 * the party may run is decided in services/extension-invoke.ts, from this context's appId.
 */
export async function appPartyForExtensionCall(deps: Deps, req: Headers): Promise<{ ok: true; ctx: AppPartyCtx } | Refusal> {
    const ref = await appOfPartyToken(req);
    if (!ref) {
        return { ok: false, status: 401, code: 'INVALID_PARTY_CREDENTIAL',
            message: 'This credential is not a sign-in to an app. A person registered to an app signs in to that app first.' };
    }
    return appPartyFromRequest(deps, ref, req);
}
