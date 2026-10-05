/**
 * @file src/services/app-dev-grant-ops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The per-app development right as operations: who may build this app, invite
 *   somebody to build it, take the right back. Each one holds the owner test, the refusals, the
 *   notification and the audit row its REST route held (GET, PUT and DELETE
 *   /v1/apps/:owner/:filename/dev-grants in routes/app-members.ts), and answers an AppOpOutcome. The
 *   route and the aimeat_app_manage MCP tool (builders, builder_set, builder_remove) both call these.
 *
 *   The rights themselves (the rungs, the roster row, the blanket list) are services/app-dev-grant.ts.
 * @structure DEV_RUNGS · listAppBuilders · setAppBuilder · removeAppBuilder
 * @usage const out = await setAppBuilder(storage, config, caller, { owner, filename }, account, body);
 * @version-history
 *   v1.0.0 — 2026-10-05 — Moved out of the dev-grants handlers of routes/app-members.ts by extraction;
 *     aimeat_app_manage calls the service in place of the route over loopback HTTP (secaudit 2026-10, M6).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { accountOf } from './app-members.js';
import {
  APP_DEV_LEVEL_LIST, actsFor, levelName, parseDevLevel, putDevGrant, removeDevGrant, listDevGrants, listBlanketGrants,
} from './app-dev-grant.js';
import { recordAppAudit } from './app-audit.js';
import { notify } from './notify.js';
import { memberAddress, appDeepLink, appStem } from './app-member-approve.js';
import { rosterContext, rosterBucketOf, type RosterCaller } from './app-roster-context.js';
import type { AppRef } from './app-roster-ops.js';
import { done, refuse, type AppOpOutcome } from './app-op-outcome.js';

/** The rungs as an endpoint answers them, so a client never has to hardcode the numbers. */
export const DEV_RUNGS = APP_DEV_LEVEL_LIST.map(l => ({ name: l.name, level: l.level, carries: actsFor(l.level) }));

/**
 * Where the owner sees and changes every development right: the Apps tab of their settings. An
 * agent that gives a right from a chat hands this address to the person, so the right can be read
 * back and taken away without asking an AI.
 */
const buildersPage = (config: AimeatConfig) => ({
  url: `${config.baseUrl.replace(/\/+$/, '')}/v1/profile?tab=apps`,
  section: 'Who else may build these',
});

/** What the invited person's AI does next, in the terms of the tools it holds. */
const builderNext = (owner: string, filename: string, account: string) =>
  `Tell ${account} the app is open to them; they were also notified on this server. `
  + `Their AI finds it with aimeat_app_list { building: true } and works on it with the app tools, `
  + `giving owner: "${owner}" and filename: "${filename}" (aimeat_app_get, the aimeat_app_draft_* tools, `
  + `and aimeat_app_publish when the level carries publishing). What the level allows is in carries. `
  + `Before it changes anything it reads the app's design spec, aimeat_app_manage { action: "spec", owner: "${owner}", `
  + `filename: "${filename}" }, and after a publish it writes the spec back with { action: "spec_set" }.`;

/** GET .../dev-grants: who can build this app. Owner only. */
export async function listAppBuilders(storage: Storage, config: AimeatConfig, caller: RosterCaller, ref: AppRef): Promise<AppOpOutcome> {
  const c = await rosterContext(storage, config, caller, ref.owner, ref.filename);
  if (!c.ok) return c;
  if (!c.isOwner) return refuse(403, 'FORBIDDEN', 'Only the app owner sees who may build it');
  const grants = await listDevGrants(storage, c.appId);
  // The people who may build EVERY app of this owner may build this one too, so "who can build
  // this app" names them beside the per-app list rather than leaving them out of the answer.
  const allApps = await listBlanketGrants(storage, c.owner);
  return done({
    grants: grants.map(g => ({ ...g, levelName: levelName(g.level), carries: actsFor(g.level) })),
    allApps: allApps.map(g => ({ account: g.grantee, level: g.level, levelName: levelName(g.level), carries: actsFor(g.level) })),
    levels: DEV_RUNGS,
    never: ['delete the app', 'change its price or licence', 'pass the right on'],
    page: buildersPage(config),
  });
}

/** PUT .../dev-grants/:account: invite somebody to build it. Owner only. */
export async function setAppBuilder(
  storage: Storage, config: AimeatConfig, caller: RosterCaller, ref: AppRef, rawAccount: string, body: unknown,
): Promise<AppOpOutcome> {
  const c = await rosterContext(storage, config, caller, ref.owner, ref.filename);
  if (!c.ok) return c;
  if (!c.isOwner) return refuse(403, 'FORBIDDEN', 'Only the app owner says who may build it');

  const b = (body ?? {}) as Record<string, unknown>;
  const level = parseDevLevel(b.level);
  if (level === null) {
    return refuse(400, 'INVALID_INPUT', `level must be one of: ${APP_DEV_LEVEL_LIST.map(l => l.name).join(', ')}.`, { levels: DEV_RUNGS });
  }
  const account = accountOf(rawAccount);
  if (!account) return refuse(400, 'INVALID_INPUT', 'account is required');
  if (account === c.callerAccount) {
    return refuse(400, 'INVALID_INPUT', 'You already own this app. A development right is for somebody else.');
  }
  // Both of these are refusals BEFORE anything is written. A grant to a name nobody answers to
  // waits forever and looks, on the owner's own page, exactly like a grant that works.
  if (!(await storage.getGHIIByOwner(account))) {
    return refuse(404, 'NOT_FOUND',
      `No owner named "${account}" on this node. A development right goes to an account on this same server: `
      + 'find the person\'s account name from their email address with aimeat_contact_resolve_email, or ask them to sign up here first.');
  }
  const ownerGhii = await rosterBucketOf(storage, config, c.owner);
  if (!(await storage.getApp(ownerGhii, c.filename))) return refuse(404, 'NOT_FOUND', 'No such app.');

  const note = typeof b.note === 'string' ? b.note.slice(0, 400) : undefined;
  const rec = await putDevGrant(storage, {
    appId: c.appId, account, level, grantedBy: c.callerGaii, ...(note !== undefined ? { note } : {}),
  });
  await recordAppAudit(storage, {
    ownerGhii, filename: c.filename, by: c.callerGaii,
    action: 'dev.granted', detail: { account, level, levelName: levelName(level) },
  });
  try {
    await notify(storage, memberAddress(account, config.nodeId), {
      type: 'app_dev_grant',
      title: `${c.owner} invited you to build ${appStem(c.filename)}`,
      body: `You may ${actsFor(level).join(', ')} on this app. Your agents are covered by the same invitation.`,
      link: appDeepLink(c.appId),
    });
  } catch (err) {
    logger.warn('app-members: dev-grant notification failed, the grant stands', { error: String(err) });
  }
  return done({
    granted: true, account, level, levelName: levelName(level), carries: actsFor(level), member: rec,
    next: builderNext(c.owner, c.filename, account),
    page: buildersPage(config),
  });
}

/**
 * DELETE .../dev-grants/:account: take the right back. Owner only.
 * A member's roster row survives: somebody can pay for an app they no longer help build, and
 * deleting the row here would take their access away with the right. A row that existed only to
 * carry the right goes with it (removeDevGrant), so a pure builder does not stay on as a member.
 */
export async function removeAppBuilder(
  storage: Storage, config: AimeatConfig, caller: RosterCaller, ref: AppRef, rawAccount: string,
): Promise<AppOpOutcome> {
  const c = await rosterContext(storage, config, caller, ref.owner, ref.filename);
  if (!c.ok) return c;
  if (!c.isOwner) return refuse(403, 'FORBIDDEN', 'Only the app owner says who may build it');
  const account = accountOf(rawAccount);
  const had = await removeDevGrant(storage, c.appId, account);
  if (had) {
    await recordAppAudit(storage, {
      ownerGhii: await rosterBucketOf(storage, config, c.owner), filename: c.filename, by: c.callerGaii,
      action: 'dev.revoked', detail: { account },
    });
  }
  return done({ revoked: had, account });
}
