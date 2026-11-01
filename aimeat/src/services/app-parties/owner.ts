/**
 * @file src/services/app-parties/owner.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's and the operator's side of an app's parties (plan doc-mvwxcas3dom3, D4.1,
 *   D4.3): the app's signup setting, the list of the people who registered, removing one, putting a
 *   party on the roster, and the operator's decision on an app's request under apps-ask.
 *
 *   THE SETTING (D4.3). off (the node's setting, or a node that shows its content to signed-in accounts
 *   only): 403 PARTY_REGISTRATION_OFF, and nothing changes. on: the owner opens or closes the signup.
 *   apps-ask: opening files a request (state `requested`), and the operator approves (state `open`) or
 *   refuses it (POST /v1/admin/app-party-registrations/{owner}/{app}); closing needs nobody.
 *
 *   WHO. The app's owner in person or the owner's principal holding the route's word (app:write to
 *   read, app:manage to change), checked by rosterContext as the member roster checks it, and the
 *   app's own token for its own app. A member who manages the roster does not manage its parties.
 *
 *   REMOVING A PARTY ends everything it held at once: it leaves the record (its token answers 401 on the
 *   next request), the roster, and every collection of party data it kept in the app.
 * @structure registrationView · getRegistration · setRegistration · listAppParties · removeAppParty ·
 *   setAppPartyStatus · setPartyMember · listRegistrationRequests · decideRegistration
 * @usage const out = await setRegistration(deps, caller, { owner, filename }, { open: true });
 * @version-history
 *   v1.2.0 — 2026-11-01 — setAppPartyStatus: the owner stops a registered person and lets it in again
 *     (POST .../parties/{name}/stop and /resume, aimeat_app_manage party_stop and party_resume; WP9d).
 *   v1.1.0 — 2026-11-01 — Each request in the operator's list names its app's `filename`, which the
 *     decision takes (WP9b: the Config page and aimeat_admin_app_party_registrations decide from the list).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D4.1, D4.3).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { UNCHANGED } from '../record-cas.js';
import { rosterContext, rosterAudit, rosterBucketOf, type RosterCaller } from '../app-roster-context.js';
import { done, refuse, type AppOpOutcome } from '../app-op-outcome.js';
import { getMember, putMember, removeMember } from '../app-members.js';
import { isManagerRole, roleShapeError } from '../app-member-rules.js';
import { parsePartyRef, partyRefOf } from '../parties/contract.js';
import { findParty } from '../parties/store.js';
import { APP_PARTIES_PREFIX, PARTY_DATA_PREFIX, appPartyView, parseAppPartiesValue, type AppPartyRegistration } from './contract.js';
import { appKeySegment } from '../app-record-keys.js';
import { appIdOf, changeAppParties, readAppParties, registrationMode, signupOpen } from './store.js';

type Deps = { storage: Storage; config: AimeatConfig };
type AppRef = { owner: string; filename: string };

/** What the signup setting reads as for this app now. */
export function registrationView(config: AimeatConfig, reg: AppPartyRegistration): Record<string, unknown> {
    return {
        node_setting: config.partySelfRegistration ?? 'off', effective: registrationMode(config),
        state: reg.state, open: signupOpen(config, reg), role: reg.role,
        ...(reg.requestedAt ? { requested_at: reg.requestedAt } : {}), ...(reg.decidedAt ? { decided_at: reg.decidedAt } : {}),
        ...(reg.reason ? { reason: reg.reason } : {}),
    };
}

/** The owner context, or the refusal: the app's owner only (its principal or its own token). */
async function ownerCtx(deps: Deps, caller: RosterCaller, ref: AppRef) {
    const c = await rosterContext(deps.storage, deps.config, caller, ref.owner, ref.filename);
    if (!c.ok) return c;
    if (!c.isOwner) return refuse(403, 'FORBIDDEN', 'Only the app\'s owner manages who registers to it.');
    return c;
}

/** Whether people may sign up to the app now: public, so the app's page knows to offer it. */
export async function getRegistration(deps: Deps, ref: AppRef): Promise<AppOpOutcome> {
    const ownerGhii = await rosterBucketOf(deps.storage, deps.config, ref.owner);
    const rec = await readAppParties(deps.storage, ownerGhii, appIdOf(ref.owner, ref.filename));
    const view = registrationView(deps.config, rec.registration);
    return done({ open: view.open, effective: view.effective });
}

/** Open or close the app's signup, and set the role a registered party gets (see the file header). */
export async function setRegistration(deps: Deps, caller: RosterCaller, ref: AppRef, body: Record<string, unknown>): Promise<AppOpOutcome> {
    const c = await ownerCtx(deps, caller, ref);
    if (!c.ok) return c;
    const mode = registrationMode(deps.config);
    if (mode === 'off') return refuse(403, 'PARTY_REGISTRATION_OFF', 'This server does not let people register to its apps without an account. Ask its operator.');
    if (typeof body.open !== 'boolean') return refuse(400, 'INVALID_INPUT', 'open is true (people may register) or false.');
    const role = typeof body.role === 'string' && body.role.trim() ? body.role.trim() : undefined;
    if (role) {
        const shape = roleShapeError(role);
        if (shape) return refuse(400, 'INVALID_INPUT', shape);
        if (isManagerRole(c.plan, role)) return refuse(400, 'INVALID_INPUT', 'A registered person cannot get a role that manages the roster.');
    }
    const ownerGhii = await rosterBucketOf(deps.storage, deps.config, c.owner);
    const now = new Date().toISOString();
    const after = await changeAppParties(deps.storage, ownerGhii, c.appId, cur => {
        const reg = cur.registration;
        const next: AppPartyRegistration = { ...reg, ...(role ? { role } : {}), updatedAt: now };
        if (!body.open) Object.assign(next, { state: 'closed' });
        else if (mode === 'on') Object.assign(next, { state: 'open', decidedBy: undefined, decidedAt: undefined, reason: undefined });
        else if (!(reg.state === 'open' && reg.decidedBy)) Object.assign(next, { state: 'requested', requestedAt: now, decidedBy: undefined, decidedAt: undefined, reason: undefined });
        return { ...cur, registration: next };
    });
    await rosterAudit(deps.storage, deps.config, c, 'plan.changed', { account: null, partyRegistration: after.registration.state });
    return done({
        registration: registrationView(deps.config, after.registration),
        ...(after.registration.state === 'requested' ? { note: 'This server asks its operator to approve each app that lets people register. The signup opens when the operator approves it.' } : {}),
    });
}

/** The people who registered to the app, with the setting. */
export async function listAppParties(deps: Deps, caller: RosterCaller, ref: AppRef): Promise<AppOpOutcome> {
    const c = await ownerCtx(deps, caller, ref);
    if (!c.ok) return c;
    const rec = await readAppParties(deps.storage, await rosterBucketOf(deps.storage, deps.config, c.owner), c.appId);
    const parties = [];
    for (const p of rec.parties) {
        const ref2 = partyRefOf(c.owner, p.name, deps.config.nodeId);
        parties.push({ ...appPartyView(p, ref2), role: (await getMember(deps.storage, c.appId, ref2))?.role ?? null });
    }
    return done({
        registration: registrationView(deps.config, rec.registration), parties, total: parties.length,
        personal_data: 'The e-mail address of each person is personal data you hold as the app\'s owner. Remove a person who no longer uses the app.',
    });
}

/** Remove one registered person: the record, the roster row and every collection it kept. */
export async function removeAppParty(deps: Deps, caller: RosterCaller, ref: AppRef, name: string): Promise<AppOpOutcome> {
    const c = await ownerCtx(deps, caller, ref);
    if (!c.ok) return c;
    const ownerGhii = await rosterBucketOf(deps.storage, deps.config, c.owner);
    let removed: { uid: string; name: string } | null = null;
    await changeAppParties(deps.storage, ownerGhii, c.appId, cur => {
        const p = cur.parties.find(x => x.name === name);
        if (!p) return UNCHANGED;
        removed = { uid: p.uid, name: p.name };
        return { ...cur, parties: cur.parties.filter(x => x.uid !== p.uid) };
    });
    const gone = removed as { uid: string; name: string } | null;
    if (!gone) return refuse(404, 'NOT_FOUND', `No registered person "${name}" in this app.`);
    await removeMember(deps.storage, c.appId, partyRefOf(c.owner, gone.name, deps.config.nodeId));
    const prefix = `${PARTY_DATA_PREFIX}${appKeySegment(c.appId)}.${gone.uid}.`;
    let dataDeleted = 0;
    for (const r of await deps.storage.listMemory(ownerGhii, { prefix })) {
        if (await deps.storage.deleteMemory(ownerGhii, r.key, ownerGhii)) dataDeleted++;
    }
    await rosterAudit(deps.storage, deps.config, c, 'member.removed', { account: partyRefOf(c.owner, gone.name, deps.config.nodeId), from: 'party', to: null });
    return done({ removed: true, name: gone.name, uid: gone.uid, data_deleted: dataDeleted });
}

/**
 * Stop a registered person, or let a stopped one in again (WP9d). Stopped: every request with its
 * sign-in answers 403 PARTY_STOPPED (appPartyFromRequest) and no new link is mailed to it, while its
 * roster row and its data stay, so a resume puts it back where it was. A pending person (the mailed
 * link never opened) cannot be resumed into active; it stays pending.
 */
export async function setAppPartyStatus(deps: Deps, caller: RosterCaller, ref: AppRef, name: string, to: 'stopped' | 'active'): Promise<AppOpOutcome> {
    const c = await ownerCtx(deps, caller, ref);
    if (!c.ok) return c;
    const ownerGhii = await rosterBucketOf(deps.storage, deps.config, c.owner);
    let found: { uid: string; name: string; status: string } | null = null;
    const now = new Date().toISOString();
    await changeAppParties(deps.storage, ownerGhii, c.appId, cur => {
        const i = cur.parties.findIndex(x => x.name === name);
        if (i < 0) return UNCHANGED;
        const p = cur.parties[i]!;
        const status = to === 'stopped' ? 'stopped' : (p.verifiedAt ? 'active' : 'pending');
        found = { uid: p.uid, name: p.name, status };
        if (p.status === status) return UNCHANGED;
        const parties = [...cur.parties];
        parties[i] = to === 'stopped'
            ? { ...p, status, stoppedBy: 'owner', stoppedAt: now, link: null }
            : { ...p, status, stoppedBy: undefined, stoppedAt: undefined };
        return { ...cur, parties };
    });
    const hit = found as { uid: string; name: string; status: string } | null;
    if (!hit) return refuse(404, 'NOT_FOUND', `No registered person "${name}" in this app.`);
    await rosterAudit(deps.storage, deps.config, c, to === 'stopped' ? 'party.stopped' : 'party.resumed', { account: partyRefOf(c.owner, hit.name, deps.config.nodeId), state: hit.status });
    return done({ name: hit.name, uid: hit.uid, status: hit.status });
}

/**
 * Put an outside party on the app's roster (D4.1): `party:<owner>/<name>@<node>` of the app's owner, a
 * person registered to this app or a party of the owner's own record. The row is keyed like any
 * member's; no exchange grant is issued, because a party holds no account to carry.
 */
export async function setPartyMember(
    deps: Deps, c: { appId: string; owner: string; isOwner: boolean; plan: { manageRoles?: string[] } | null; callerAccount: string },
    party: string, role: string, note: string | undefined,
): Promise<AppOpOutcome> {
    const ref = parsePartyRef(party);
    if (!ref || ref.node !== deps.config.nodeId) return refuse(400, 'INVALID_INPUT', `party is party:<owner>/<name>@${deps.config.nodeId}.`);
    if (ref.owner.toLowerCase() !== c.owner.toLowerCase()) return refuse(403, 'FORBIDDEN', 'An app\'s roster takes the parties of the app\'s own owner only.');
    if (!c.isOwner && isManagerRole(c.plan, role)) return refuse(403, 'FORBIDDEN', 'Only the app owner gives a role that manages the roster.');
    const shape = roleShapeError(role);
    if (shape) return refuse(400, 'INVALID_INPUT', shape);
    const ownerGhii = await rosterBucketOf(deps.storage, deps.config, c.owner);
    const inApp = (await readAppParties(deps.storage, ownerGhii, c.appId)).parties.some(p => p.name === ref.name);
    if (!inApp && !(await findParty(deps.storage, ownerGhii, ref.name))) return refuse(404, 'PARTY_NOT_FOUND', `The owner has no party called "${ref.name}".`);
    const before = await getMember(deps.storage, c.appId, party);
    const member = await putMember(deps.storage, { appId: c.appId, account: party, role, approvedBy: c.callerAccount, offerings: [], ...(note ? { note } : {}) });
    return done({ member, created: !before, party: true, note: 'An outside party has no account here, so the role carries no free access to what the owner sells.' }, before ? 200 : 201);
}

/** The apps that asked to let people register, for the operator (apps-ask). */
export async function listRegistrationRequests(deps: Deps): Promise<AppOpOutcome> {
    const { items } = await deps.storage.listAllMemory({ prefix: APP_PARTIES_PREFIX, limit: 2000 });
    const out = [];
    for (const r of items) {
        if (!r.ownerGaii.endsWith(`@${deps.config.nodeId}`) || r.ownerGaii.includes('#')) continue;
        const v = parseAppPartiesValue(r.value);
        if (v.registration.state === 'closed') continue;
        // `filename`: the app the decision names (POST .../app-party-registrations/{owner}/{filename}).
        const filename = v.appId && v.appId.includes('/') ? v.appId.slice(v.appId.indexOf('/') + 1) : null;
        out.push({ owner: r.ownerGaii.slice(0, -(deps.config.nodeId.length + 1)), key: r.key, filename, ...registrationView(deps.config, v.registration), parties: v.parties.length });
    }
    return done({ setting: deps.config.partySelfRegistration ?? 'off', effective: registrationMode(deps.config), apps: out, total: out.length });
}

/** The operator approves or refuses one app's request (apps-ask). */
export async function decideRegistration(deps: Deps, operatorGaii: string, ref: AppRef, body: Record<string, unknown>): Promise<AppOpOutcome> {
    if (body.decision !== 'approve' && body.decision !== 'refuse') return refuse(400, 'INVALID_INPUT', 'decision is "approve" or "refuse".');
    if (registrationMode(deps.config) === 'off') return refuse(409, 'PARTY_REGISTRATION_OFF', 'Registration is off on this server, so there is nothing to approve. Change the setting first.');
    const ownerGhii = await rosterBucketOf(deps.storage, deps.config, ref.owner);
    const appId = appIdOf(ref.owner, ref.filename);
    if (!(await deps.storage.getApp(ownerGhii, ref.filename))) return refuse(404, 'NOT_FOUND', 'No such app.');
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : undefined;
    const now = new Date().toISOString();
    let asked = false;
    const after = await changeAppParties(deps.storage, ownerGhii, appId, cur => {
        if (cur.registration.state !== 'requested' && !(body.decision === 'refuse' && cur.registration.state === 'open')) return UNCHANGED;
        asked = true;
        return { ...cur, registration: { ...cur.registration, state: body.decision === 'approve' ? 'open' : 'refused', decidedAt: now, decidedBy: operatorGaii, ...(reason ? { reason } : {}), updatedAt: now } };
    });
    if (!asked) return refuse(409, 'NOT_REQUESTED', 'This app has not asked to let people register.');
    return done({ app: appId, registration: registrationView(deps.config, after.registration) });
}
