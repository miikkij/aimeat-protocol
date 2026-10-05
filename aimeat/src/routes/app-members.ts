/**
 * @file app-members.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The member roster for an app, as a node capability rather than something each app
 *   rebuilds. Six apps on this node had built their own and disagreed six ways; the deciding reason
 *   to move it here is that three of the jobs cannot be done from an app at all. Telling the
 *   approved person they were approved: the sandbox notify reaches the CALLER, so an approval
 *   notifies the approver. Keeping the list private: an `ext:` namespace is world-readable by
 *   default, and every fork that stored a roster there served it to anyone who asked for the key.
 *   Taking free access away with the role: a demotion that leaves the grants behind keeps billing
 *   the provider for someone they removed.
 *
 *   The split this preserves: the node owns WHO is a member and everything that follows from a
 *   change; the extension keeps WHAT a member may do, because a capability vocabulary is genuinely
 *   per-app and a browser can never enforce it.
 *
 *   Authorisation is the app's owner, resolved through the identity table rather than compared as a
 *   string, so the owner's own agents administer the roster too (an owner who manages members from
 *   an AI chat is the normal case here, not an edge one). A member whose role the carry plan lists
 *   in `manageRoles` manages the roster beside the owner, except the plan, the sweep and the
 *   managing roles themselves (services/app-roster-context.ts). Everyone else may only ask, and read
 *   their own standing.
 *
 *   Each per-app handler is the route's gate (requireAuth plus the scope word) and one service call:
 *   the roster logic is in services/app-roster-ops.ts and services/app-roster-write.ts, the per-app
 *   development right in services/app-dev-grant-ops.ts, so the aimeat_app_manage MCP tool calls the
 *   same functions. The blanket development right stays here: no MCP action reaches it.
 * @structure appMembersRouter(config, storage) — GET/POST/DELETE members, GET/POST requests, GET me,
 *   GET/PUT plan, sweep, seen, GET/PUT/DELETE dev-grants (per app), GET/PUT/DELETE /v1/app-dev-grants
 *   (across all of them). The audit read and the invitation cancel are in routes/app-members-extra.ts.
 * @usage app.use(appMembersRouter(config, storage))
 * @version-history
 *   v1.7.0 — 2026-10-05 — The handlers' logic (owner and manager tests, validation, refusals, grant
 *     sync, notifications, audit rows) moved to services/app-roster-ops.ts, app-roster-write.ts and
 *     app-dev-grant-ops.ts; the routes answer the same statuses, codes and data. aimeat_app_manage
 *     calls the service in place of the route over loopback HTTP (secaudit 2026-10, M6).
 *   v1.6.0 — 2026-10-05 — Secaudit 2026-10. APP-1: the app's own token may not change a plan's access,
 *     manageRoles or rosterVisibility. APP-3: adding by email looks the address up only for the owner
 *     in person; any other caller gets an invitation, so the answer says nothing about who has an
 *     account. APP-5: dismissing a guest writes an audit row only when there was a visit.
 *   v1.5.1 — 2026-10-02 — builderNext tells the invited person's AI to read the app's design spec
 *     before changing anything and to write it back after a publish (services/app-design-spec.ts).
 *   v1.5.0 — 2026-10-02 — The per-app dev-grants answers are written for an agent working from a
 *     chat (aimeat_app_manage builders, builder_set): GET names the people who may build every app
 *     of the owner (`allApps`) and the settings page where the rights are seen (`page`); PUT says
 *     what the invited person's AI does next (`next`) and names the same page; the 404 for an
 *     unknown account says how to find the right name.
 *   v1.4.0 — 2026-10-01 — An invitation by email carries a sign-up link (services/app-invite-link.ts)
 *     and lives 7 days; the answer gives the inviter `acceptUrl` only when no email left.
 *   v1.3.2 — 2026-10-01 — The owner's roster names each person's address from the owner's own address book.
 *   v1.3.1 — 2026-10-01 — The invitation's audit row names the address, so the history can say whom.
 *   v1.3.0 — 2026-10-01 — IAM round 2. The roster answers display names (A1) and is searched and
 *     paged with `q`, `limit` and `offset`, with `total` per list (A5). POST members takes `email`:
 *     an address of a verified account approves that account, any other address stores an invitation
 *     and emails it (A2). A role change notifies the member (A4). Members holding a role listed in
 *     the plan's `manageRoles` manage the roster, never the plan, the sweep or a managing role (B1).
 *     Every decision writes an audit row (B2). A decline notifies the person, who may ask again after
 *     7 days and is refused with REASK_TOO_SOON before that; declining nobody's ask answers 404 (B3).
 *     The notifications are in the recipient's language (B4). The request path reads one page of the
 *     roster for the suggested role, never the whole of it, and never suggests a managing role. The
 *     app's own token may set the plan, but not add offerings to it. The request context and the
 *     approval moved out by extraction (routes/app-members-context.ts, services/app-member-approve.ts).
 *   v1.2.0 — 2026-10-01 — The IAM defect round. Every roster route that reads or changes membership
 *     needs a scope word (app:write to read, app:manage to decline or dismiss, exchange:grant to
 *     sweep, approve or remove), except for the app's own token, which manages its own roster and
 *     may not name offerings. The app must exist. An approval refuses a role named "owner" or of
 *     the wrong shape, an account nobody holds, and an unreadable date, and keeps 400 characters of
 *     its note. /me reads one request by key and leaves the owner's records off the member's row.
 *     An identity of another node is notified at its own address. A removal always reconciles the
 *     grants, and keeps a development right.
 *   v1.1.2 — 2026-09-24 — The dev-grant DELETE comment says what the revoke now does to a row that
 *     only carried the right (A6-5, services/app-dev-grant.ts). No behaviour change in this file.
 *   v1.1.1 — 2026-09-12 — bucketOf hands resolveGhii the node; composing `${owner}@${nodeId}` at the
 *     call site is what the helper does now. wish-identity-gate-sees-resolveghii.
 *   v1.1.0 — 2026-09-08 — The DEVELOPMENT right: who, other than the owner, may build this app. Three
 *     rungs from services/app-dev-grant.ts, written on the roster row because it is the same person
 *     keyed the same way, and a blanket "any app of mine" list that is its own record so an owner can
 *     see and withdraw it in one place. The per-app door is app management and the owner's agents do
 *     it; the blanket door is the account holder in person, because a right over every app they will
 *     ever publish is not app management.
 *   v1.0.0 — 2026-07-30 — Initial (TARGET-055 phase 2): the roster becomes a platform capability,
 *     with the notification and the grant withdrawal that an app could not do for itself.
 */
import { Router, type Request } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireOwnerPrincipal, requireScope } from '../auth/middleware.js';
// Every roster route that reads or changes membership: a scope word for an agent or another app,
// none for the app's own token, which is the app managing its own roster (auth/app-own-gate.ts).
import { requireScopeOrOwnApp } from '../auth/app-own-gate.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { listAppRecords } from '../services/app-record-keys.js';
import { accountOf, isLive } from '../services/app-members.js';
import {
  APP_DEV_LEVEL_LIST, actsFor, levelName, parseDevLevel,
  putBlanketGrant, listBlanketGrants, removeBlanketGrant,
} from '../services/app-dev-grant.js';
import { notify } from '../services/notify.js';
import { logger } from '../utils/logger.js';
import { appMembersExtraRouter } from './app-members-extra.js';
import { memberAddress } from '../services/app-member-approve.js';
import {
  listRoster, rosterMe, readCarryPlan, dismissGuest, sweepRoster, requestMembership, declineRequest, type AppRef,
} from '../services/app-roster-ops.js';
import { setCarryPlan, setMember, removeRosterMember } from '../services/app-roster-write.js';
import { DEV_RUNGS, listAppBuilders, setAppBuilder, removeAppBuilder } from '../services/app-dev-grant-ops.js';
import { sendAppOp } from './app-op-answer.js';

/** The app a per-app route addresses. */
const refOf = (req: Request): AppRef => ({ owner: String(req.params.owner ?? ''), filename: String(req.params.filename ?? '') });
const accountParam = (req: Request): string => String(req.params.account ?? '');

export function appMembersRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  // The audit read and the invitation cancel live in their own module and are mounted here, so
  // the roster stays one mount in routes-loader, ahead of the parameterized app routes.
  router.use(appMembersExtraRouter(config, storage));
  const addressOf = (account: string) => memberAddress(account, config.nodeId);
  const answer = (res: import('express').Response, out: Parameters<typeof sendAppOp>[2]) => sendAppOp(res, config.nodeId, out);

  // ── GET /v1/apps/:owner/:filename/members — the roster. Owner and managers; members when the app shows it to them. ──
  router.get('/v1/apps/:owner/:filename/members', requireAuth(), requireScopeOrOwnApp('app:write'), async (req, res) =>
    answer(res, await listRoster(storage, config, req.auth!, refOf(req), req.query as Record<string, unknown>)));

  // ── GET .../members/me — the caller's own standing. Any authenticated caller. ──
  // An agent asks this and gets its HUMAN's answer, which is the whole point of keying on the person.
  router.get('/v1/apps/:owner/:filename/members/me', requireAuth(), async (req, res) =>
    answer(res, await rosterMe(storage, config, req.auth!, refOf(req))));

  // ── GET/PUT .../members/plan — what each role is CARRIED on. Owner only. ──
  router.get('/v1/apps/:owner/:filename/members/plan', requireAuth(), requireScopeOrOwnApp('app:write'), async (req, res) =>
    answer(res, await readCarryPlan(storage, config, req.auth!, refOf(req))));

  // The app's own token may set the plan, but never ADD an offering to a role (setCarryPlan).
  router.put('/v1/apps/:owner/:filename/members/plan', requireAuth(), requireScopeOrOwnApp('commerce:sell'), async (req, res) =>
    answer(res, await setCarryPlan(storage, config, req.auth!, refOf(req), req.body)));

  // ── DELETE .../members/seen/{account} — dismiss a guest from the list. Owner and managers. ──
  router.delete('/v1/apps/:owner/:filename/members/seen/:account', requireAuth(), requireScopeOrOwnApp('app:manage'), async (req, res) =>
    answer(res, await dismissGuest(storage, config, req.auth!, refOf(req), accountParam(req))));

  // ── POST .../members/sweep — close every lapsed membership NOW. Owner only. ──
  router.post('/v1/apps/:owner/:filename/members/sweep', requireAuth(), requireScopeOrOwnApp('exchange:grant'), async (req, res) =>
    answer(res, await sweepRoster(storage, config, req.auth!, refOf(req))));

  // ── POST .../members — approve someone, or change their role. Owner and managers. ──
  // `exchange:grant`, because approveMember issues the same exchange grants that
  // POST /v1/exchange/grants issues, and that endpoint has always demanded the word: giving away
  // free access to what the owner sells is the operation, whichever endpoint it is reached through.
  // Owner sessions bypass scopes, so the person's own Members screen is untouched; what needs the
  // word is a machine doing it.
  router.post('/v1/apps/:owner/:filename/members', requireAuth(), requireScopeOrOwnApp('exchange:grant'), async (req, res) =>
    answer(res, await setMember(storage, config, req.auth!, refOf(req), req.body)));

  // ── DELETE .../members/:account — remove a member. Owner and managers. ──
  // Same word as the approval above, and for the same reason one route over: this withdraws the
  // grants, which is what POST /v1/exchange/grants/revoke does and demands `exchange:grant` for.
  router.delete('/v1/apps/:owner/:filename/members/:account', requireAuth(), requireScopeOrOwnApp('exchange:grant'), async (req, res) =>
    answer(res, await removeRosterMember(storage, config, req.auth!, refOf(req), accountParam(req))));

  // ── POST .../members/requests — ask to be let in. Any authenticated caller. ──
  router.post('/v1/apps/:owner/:filename/members/requests', requireAuth(), requireScopeOrOwnApp('social:write'), async (req, res) =>
    answer(res, await requestMembership(storage, config, req.auth!, refOf(req), (req.body ?? {}).note)));

  // ── DELETE .../members/requests/:account — decline an ask. Owner and managers. ──
  router.delete('/v1/apps/:owner/:filename/members/requests/:account', requireAuth(), requireScopeOrOwnApp('app:manage'), async (req, res) =>
    answer(res, await declineRequest(storage, config, req.auth!, refOf(req), accountParam(req))));

  // ── The development right: who, other than the owner, may BUILD this app ────────────────────────
  //
  // Beside the roster rather than somewhere of its own, because it is written on the same row and
  // keyed to the same person. What separates the two is what they are about: a role says what
  // somebody may do INSIDE the app, and this says what they may do TO it.

  // ── GET .../dev-grants — who can build this app. Owner only. ──
  // app:write, not a read word: the app domain carries write and manage, and an agent that may
  // manage an app may read who else builds it. Without a scope this list is readable by any
  // app-grant token whatever single word its owner ticked.
  router.get('/v1/apps/:owner/:filename/dev-grants', requireAuth(), requireScope('app:write'), async (req, res) =>
    answer(res, await listAppBuilders(storage, config, req.auth!, refOf(req))));

  // ── PUT .../dev-grants/:account — invite somebody to build it. Owner only. ──
  router.put('/v1/apps/:owner/:filename/dev-grants/:account', requireAuth(), requireScope('app:manage'), async (req, res) =>
    answer(res, await setAppBuilder(storage, config, req.auth!, refOf(req), accountParam(req), req.body)));

  // ── DELETE .../dev-grants/:account — take the right back. Owner only. ──
  router.delete('/v1/apps/:owner/:filename/dev-grants/:account', requireAuth(), requireScope('app:manage'), async (req, res) =>
    answer(res, await removeAppBuilder(storage, config, req.auth!, refOf(req), accountParam(req))));

  // ── The blanket right: "this person may build ANY app of mine" ──────────────────────────────────
  //
  // Its own list rather than a row on every roster, and that is the entire reason it exists
  // separately: a right written into forty rosters is a right its owner cannot see in one place and
  // cannot take back in one act.
  //
  // Behind the account holder in person, unlike the per-app grant. An owner handing out one app is
  // doing app management, which their agents do for them all day. An owner handing out every app
  // they will ever publish is doing something to the account, and this repo's rule for that is the
  // person, not something acting in their name.

  router.get('/v1/app-dev-grants', requireAuth(), requireScope('app:write'), async (req, res) => {
    const me = accountOf(resolveIdentity(req.auth!, config.nodeId));
    const grants = await listBlanketGrants(storage, me);
    const perApp: Record<string, unknown[]> = {};
    if (req.query.include_apps === 'true') {
      const rows = await listAppRecords(storage, 'app-member', 'appmember.');
      for (const { value } of rows.items) {
        const row = value as import('../services/app-members.js').AppMemberRecord;
        if (!row?.appId || accountOf(row.appId.split('/')[0]) !== me || typeof row.dev !== 'number' || !isLive(row)) continue;
        (perApp[row.appId] ??= []).push({ account: row.owner, level: row.dev, levelName: levelName(row.dev), since: row.devSince, grantedBy: row.devBy });
      }
    }
    return res.json(success(config.nodeId, {
      grants: grants.map(g => ({ ...g, levelName: levelName(g.level), carries: actsFor(g.level) })),
      levels: DEV_RUNGS,
      ...(req.query.include_apps === 'true' ? { per_app: perApp } : {}),
      meaning: 'These people may build any app of yours, including ones you have not published yet. A right on a single app is set on that app instead.',
    }));
  });

  router.put('/v1/app-dev-grants/:account', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const me = accountOf(resolveIdentity(req.auth!, config.nodeId));
    const level = parseDevLevel((req.body ?? {}).level);
    if (level === null) {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        `level must be one of: ${APP_DEV_LEVEL_LIST.map(l => l.name).join(', ')}.`, 400, { levels: DEV_RUNGS }));
    }
    const account = accountOf(String(req.params.account ?? ''));
    if (!account) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'account is required'));
    if (account === me) {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'These are your own apps already.'));
    }
    if (!(await storage.getGHIIByOwner(account))) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No owner named "${account}" on this node.`));
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rec = await putBlanketGrant(storage, {
      owner: me, grantee: account, level, grantedBy: resolveIdentity(req.auth!, config.nodeId),
      ...(typeof body.note === 'string' ? { note: body.note.slice(0, 400) } : {}),
      ...(typeof body.expires_at === 'string' ? { expiresAt: body.expires_at } : {}),
    });
    try {
      await notify(storage, addressOf(account), {
        type: 'app_dev_grant',
        title: `${me} invited you to build their apps`,
        body: `You may ${actsFor(level).join(', ')} on any app of theirs. Your agents are covered by the same invitation.`,
      });
    } catch (err) {
      logger.warn('app-members: blanket dev-grant notification failed, the grant stands', { error: String(err) });
    }
    return res.json(success(config.nodeId, { granted: true, grant: rec, levelName: levelName(level), carries: actsFor(level) }));
  });

  router.delete('/v1/app-dev-grants/:account', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const me = accountOf(resolveIdentity(req.auth!, config.nodeId));
    const account = accountOf(String(req.params.account ?? ''));
    const had = await removeBlanketGrant(storage, me, account);
    return res.json(success(config.nodeId, { revoked: had, account }));
  });

  return router;
}
