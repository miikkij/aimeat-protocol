/**
 * @file src/services/app/playtest-member.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The member a signed-in playtest scenario runs as: a throwaway account the node makes
 *   for one run and erases after it (services/app/playtest-scenarios.ts).
 *
 *   WHY NOT THE OWNER. A scenario clicks and types like a person. Run as the owner, a step that
 *   deletes a record would delete the owner's real one, so a scenario would be a risk to run. A fresh
 *   account writes into its own namespace only, holds a grant for this one app with the scopes the
 *   app declares, and is gone when the run ends.
 *
 *   HOW IT IS MADE. The account rows come from createAccountRows (services/owner/provisioning.ts),
 *   the core every account door shares, and NOT from provisionOwner: that one also runs the
 *   operator's registration hooks, records an onboarding track and sends a welcome mail, none of
 *   which a test account may trigger. Its roles are `owner` and nothing else, so it can never be the
 *   operator; a node that takes no accounts (registration `closed`) runs no signed-in scenario. The
 *   grant comes from upsertAppGrant, the one writer of app grants, and the token is the app-grant
 *   token the consent flow mints (role `app`, the app's scopes, this grant), valid for TOKEN_TTL_S.
 *
 *   HOW IT GOES. eraseOwner (services/owner/erasure.ts), the account erasure, in a finally. Each name
 *   is first written to a node record (`playtest.members` in NS), so an account a crash left behind
 *   is erased by the next run that starts (sweepPlaytestMembers).
 * @structure makePlaytestMember(storage, config, app) · sweepPlaytestMembers(storage, config)
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-builder-scenarios-in-the-playtest-signed-in-four-widths-both).
 */
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { generateKeyPair } from '../../auth/keypair.js';
import { issueJWT } from '../../auth/jwt.js';
import { logger } from '../../utils/logger.js';
import { createAccountRows, createdAccountIsOperator } from '../owner/provisioning.js';
import { eraseOwner } from '../owner/erasure.js';
import { upsertAppGrant } from './grant-upsert.js';

/** The node namespace that lists the throwaway accounts not yet erased. */
const NS = 'app-playtest';
const MEMBERS_KEY = 'playtest.members';
/** How long the member's token lasts: one run of every scenario at every size, with room. */
const TOKEN_TTL_S = 600;
/** An account in the list older than this is left over from a run that did not finish. */
const LEFTOVER_MS = 15 * 60_000;

export interface PlaytestMember {
  name: string;
  ghii: string;
  token: string;
  scopes: string[];
  grantId: string;
  /** The app id the grant is for, `owner/filename`. */
  app: string;
  /** How long the token lasts, in seconds. */
  ttlSeconds: number;
  /** Erase the account and everything it wrote. Safe to call twice. */
  erase(): Promise<void>;
}

type MemberList = Array<{ name: string; at: string }>;

async function readList(storage: Storage): Promise<{ list: MemberList; version: number | null }> {
  const rec = await storage.getMemory(NS, MEMBERS_KEY);
  const list = Array.isArray(rec?.value) ? (rec!.value as MemberList) : [];
  return { list, version: rec ? rec.version : null };
}

/** Rewrite the list with `change` applied, on its version (a concurrent run rereads and tries again). */
async function updateList(storage: Storage, change: (l: MemberList) => MemberList): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { list, version } = await readList(storage);
    const now = new Date().toISOString();
    const value = change(list);
    const record = {
      key: MEMBERS_KEY, ownerGaii: NS, value, visibility: 'private' as const, tags: ['app-playtest'], ttlHours: null,
      version: (version ?? 0) + 1, createdAt: now, updatedAt: now,
    };
    const saved = version === null ? await storage.createMemoryIfAbsent(record) : await storage.setMemoryIfVersion(record, version);
    if (saved) return;
  }
  throw new Error('The playtest member list changed repeatedly.');
}

async function eraseOne(storage: Storage, config: AimeatConfig, name: string): Promise<void> {
  try {
    if (await storage.getOwner(name)) await eraseOwner(storage, config.nodeId, name, config);
  } finally {
    await updateList(storage, l => l.filter(m => m.name !== name));
  }
}

/** Erase every throwaway account a run that did not finish left behind. */
export async function sweepPlaytestMembers(storage: Storage, config: AimeatConfig, now = Date.now()): Promise<number> {
  const { list } = await readList(storage);
  const old = list.filter(m => now - Date.parse(m.at) > LEFTOVER_MS);
  for (const m of old) {
    await eraseOne(storage, config, m.name).catch(err => logger.warn('playtest member: leftover not erased', { name: m.name, error: String(err) }));
  }
  return old.length;
}

/**
 * A throwaway account signed in to one app, or the sentence that says why there is none. `app` is
 * `owner/filename`; `scopes` are the ones the app declares in aimeat-scopes.
 */
export async function makePlaytestMember(
  storage: Storage, config: AimeatConfig, app: { id: string; name: string; origin: string; scopes: string[] },
): Promise<PlaytestMember | { reason: string }> {
  if (config.registrationMode === 'closed') {
    return { reason: 'This node takes no new accounts, so a scenario cannot run as a signed-in member here; it ran signed out instead.' };
  }
  // On a node with no operator the shared account core makes a new account its operator
  // (createdAccountIsOperator): a throwaway account must never be that one.
  if (await createdAccountIsOperator(storage)) {
    return { reason: 'This node has no operator yet, and a new account would become it; the scenarios ran signed out.' };
  }
  await sweepPlaytestMembers(storage, config);
  const name = `playtest${randomBytes(6).toString('hex')}`;
  const ghii = `${name}@${config.nodeId}`;
  await updateList(storage, l => [...l, { name, at: new Date().toISOString() }]);
  let erased = false;
  const erase = async () => {
    if (erased) return;
    erased = true;
    await eraseOne(storage, config, name).catch(err => logger.warn('playtest member: not erased', { name, error: String(err) }));
  };
  try {
    const now = new Date().toISOString();
    const keys = await generateKeyPair();
    await createAccountRows(storage, config,
      { name, displayName: 'Playtest member', publicKey: keys.publicKey, roles: ['owner'], createdAt: now },
      { username: name, nodeId: config.nodeId, ghii, displayName: 'Playtest member', verificationLevel: 0, totpEnabled: false, morselBalance: 0, loginCount: 0, createdAt: now, updatedAt: now });
    const grant = await upsertAppGrant(storage, { app: app.id, appName: app.name, appOrigin: app.origin, owner: name, gaii: ghii, scopes: app.scopes }, null);
    const token = await issueJWT(
      { sub: ghii, owner: name, node: config.nodeId, roles: ['app'], scopes: grant.scopes, app_grant: grant.grantId, app: app.id },
      TOKEN_TTL_S,
    );
    return { name, ghii, token, scopes: grant.scopes, grantId: grant.grantId, app: app.id, ttlSeconds: TOKEN_TTL_S, erase };
  } catch (err) {
    await erase();
    logger.warn('playtest member: not made', { error: String(err) });
    return { reason: `A member account for the run could not be made (${(err as Error)?.message ?? 'unknown error'}); the scenarios ran signed out.` };
  }
}
