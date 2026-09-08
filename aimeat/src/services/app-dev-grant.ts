/**
 * @file src/services/app-dev-grant.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who, other than the owner, may build this app — and the one place that turns that
 *   question into the bucket an app write lands in.
 *
 *   WHAT THIS IS FOR. An app on this node has exactly one owner, and every write door decides where
 *   the bytes land by looking at the CALLER rather than at the path: `canonicalOwner` on the REST
 *   side, `resolveAppOwnerScope` on the MCP side. That is why two people cannot build one app today,
 *   and why forking — a copy into a second bucket with its own version counter — has been the only
 *   answer. The owner can now invite somebody else's agents to work on the real thing.
 *
 *   THE RIGHT IS GIVEN TO A PERSON, NOT TO AN AGENT. The owner granting it does not know the other
 *   side's agent names and has no business knowing them: that person changes their own agents
 *   without anybody else's list needing an edit. So the roster row — which has always been keyed to
 *   the account rather than the principal — carries it, and every one of that person's agents is
 *   covered by the one row.
 *
 *   A LADDER, WITH FULL RIGHTS AT THE TOP. The point of the top rung is that an invited agent can
 *   work as freely as it would on its owner's own app, because an agent that hits a wall halfway
 *   through a job is an agent that does the job badly. Three acts are outside every rung, and the
 *   test for the line is whether leaving the act out stops the work: deleting the app is not
 *   building it, the price is the owner's business relationship with a buyer, and passing the right
 *   on would turn one grant into a key whose travels nobody can trace. A fourth, naming the natural
 *   person who answers for the app, is already impossible for ANY agent including the owner's own.
 *
 *   HOW THE DOORS STAY HONEST. The three excluded acts are not values in `AppDevAct`, so a door that
 *   performs one cannot express the ask in the first place; there is no flag to get wrong. And the
 *   doors that CAN be delegated all reach the same `resolveAppTarget`, which refuses before anything
 *   is written rather than after.
 * @structure
 *   - APP_DEV_LEVELS / AppDevAct / mayAct — the ladder and what each rung carries
 *   - putDevGrant / getDevGrant / removeDevGrant — the per-app right, on the roster row
 *   - putBlanketGrant / listBlanketGrants / removeBlanketGrant — "all my apps", in one place
 *   - effectiveDevLevel — the two sources, and which one wins
 *   - resolveAppTarget — the seam: which owner's bucket this act lands in, or a refusal
 * @usage
 *   const t = await resolveAppTarget(storage, config, { callerOwner, requestedOwner, filename, act: 'publish' });
 *   if (!t.ok) return res.status(t.status).json(error(config.nodeId, t.code, t.message));
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial. The ladder, both grant records, and the seam. No door passes a
 *     `requestedOwner` yet, so nothing that exists today behaves differently: the delegated branch
 *     is built and tested here first, and the doors are opened one at a time after it.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import {
  accountOf, getMemberRow, isLive, memberKey, sameApp, slugOf, writePrivateRecord,
  type AppMemberRecord,
} from './app-members.js';

/** The roster's own namespace, because the per-app right lives on the roster row. */
const NS_MEMBER = 'app-member';
/** The owner's blanket grants: one record per (owner, grantee), so the owner sees them as a list. */
const NS_BLANKET = 'app-dev-blanket';

/**
 * The rungs. BBS-ordinal like everything else here: a LOWER number is more power, and the gaps leave
 * room to put something between two rungs without renumbering what people already hold.
 */
export const APP_DEV_LEVELS = {
  /** Works on the app as if it were their own, short of the three acts no rung carries. */
  full: 0,
  /** Builds and ships it, and keeps how it presents itself. Nothing commercial, nothing legal. */
  publisher: 10,
  /** Writes the draft. The owner looks at it and presses the button. */
  drafter: 20,
} as const;

export type AppDevLevelName = keyof typeof APP_DEV_LEVELS;

/** Every rung, most powerful first, for a door that has to render or validate the list. */
export const APP_DEV_LEVEL_LIST: ReadonlyArray<{ name: AppDevLevelName; level: number }> = [
  { name: 'full', level: APP_DEV_LEVELS.full },
  { name: 'publisher', level: APP_DEV_LEVELS.publisher },
  { name: 'drafter', level: APP_DEV_LEVELS.drafter },
];

/** The name of a rung, for a message a person reads. Falls back to the number for a stored oddity. */
export function levelName(level: number): string {
  return APP_DEV_LEVEL_LIST.find(l => l.level === level)?.name ?? `level ${level}`;
}

/** A level a door may accept from a request: one of the three rungs, or null. */
export function parseDevLevel(input: unknown): number | null {
  if (typeof input === 'number' && APP_DEV_LEVEL_LIST.some(l => l.level === input)) return input;
  if (typeof input === 'string') {
    const byName = APP_DEV_LEVELS[input as AppDevLevelName];
    if (typeof byName === 'number') return byName;
    const asNumber = Number(input);
    if (Number.isInteger(asNumber) && APP_DEV_LEVEL_LIST.some(l => l.level === asNumber)) return asNumber;
  }
  return null;
}

/**
 * What a delegated caller can be doing. These four are the whole delegable vocabulary, and the list
 * is deliberately short: deleting the app, changing its price or licence, and granting the right
 * onwards are NOT here, so no door can ask for them on somebody else's behalf.
 *
 * - `draft`        reading the app's source and writing its draft
 * - `publish`      turning a draft into a live version
 * - `presentation` how the app introduces itself: name, description, icon, tags, screenshot
 * - `operate`      everything else about how it is offered: SEO, marks, legal pages, the data map,
 *                  bundled agents, app tools, parking, protection, forkability
 */
export type AppDevAct = 'draft' | 'publish' | 'presentation' | 'operate';

/** What each rung carries. A rung carries an act when its list names it. */
const ACTS_BY_LEVEL: Record<number, ReadonlyArray<AppDevAct>> = {
  [APP_DEV_LEVELS.full]: ['draft', 'publish', 'presentation', 'operate'],
  [APP_DEV_LEVELS.publisher]: ['draft', 'publish', 'presentation'],
  [APP_DEV_LEVELS.drafter]: ['draft'],
};

/** May somebody holding this rung do this? An unknown rung carries nothing. */
export function mayAct(level: number | null | undefined, act: AppDevAct): boolean {
  if (typeof level !== 'number') return false;
  return (ACTS_BY_LEVEL[level] ?? []).includes(act);
}

/** The acts a rung carries, for the message that says what the holder CAN do instead. */
export function actsFor(level: number): ReadonlyArray<AppDevAct> {
  return ACTS_BY_LEVEL[level] ?? [];
}

// ── The per-app right, on the roster row ──────────────────────────────────────────────────────────

/**
 * Give (or change) one person's development right on one app.
 *
 * Written onto the roster row, creating one when the person is not already a member: somebody
 * building the app is a member of it in every sense that matters, and a second list keyed the same
 * way would be a second thing to keep in step. The role string stays empty for a pure developer,
 * which is what keeps the carry plan from issuing them any of the app's paid offerings for free —
 * the plan carries by ROLE, and the empty role carries nothing.
 */
export async function putDevGrant(
  storage: Storage,
  input: { appId: string; account: string; level: number; grantedBy: string; note?: string },
): Promise<AppMemberRecord> {
  const account = accountOf(input.account);
  const prev = await getMemberRow(storage, input.appId, account);
  const now = new Date().toISOString();
  const rec: AppMemberRecord = {
    appId: input.appId,
    owner: account,
    role: prev?.role ?? '',
    level: prev?.level ?? null,
    since: prev?.since ?? now,
    updatedAt: now,
    note: input.note ?? prev?.note ?? '',
    approvedBy: prev?.approvedBy ?? input.grantedBy,
    offerings: prev?.offerings ?? [],
    expiresAt: prev?.expiresAt ?? null,
    renewal: prev?.renewal ?? null,
    dev: input.level,
    devSince: prev?.devSince ?? now,
    devBy: input.grantedBy,
  };
  await writePrivateRecord(storage, NS_MEMBER, memberKey(input.appId, account), rec, {
    createdAt: prev ? undefined : now,
  });
  return rec;
}

/** The right this person holds on this app, or null. A lapsed membership holds none. */
export async function getDevGrant(
  storage: Storage, appId: string, principal: string, now: Date = new Date(),
): Promise<number | null> {
  const row = await getMemberRow(storage, appId, principal);
  if (!row || !isLive(row, now)) return null;
  return typeof row.dev === 'number' ? row.dev : null;
}

/**
 * Take the development right away, leaving the membership behind.
 *
 * The row survives on purpose: somebody can be a paying member of an app they no longer help build,
 * and deleting the row here would take their access with it. Returns whether there was a right.
 */
export async function removeDevGrant(storage: Storage, appId: string, principal: string): Promise<boolean> {
  const account = accountOf(principal);
  const prev = await getMemberRow(storage, appId, account);
  if (!prev || typeof prev.dev !== 'number') return false;
  const rec: AppMemberRecord = { ...prev, updatedAt: new Date().toISOString() };
  delete rec.dev;
  delete rec.devSince;
  delete rec.devBy;
  await writePrivateRecord(storage, NS_MEMBER, memberKey(appId, account), rec);
  return true;
}

/** Everybody who holds a development right on one app, with the rung each one holds. */
export async function listDevGrants(
  storage: Storage, appId: string, now: Date = new Date(),
): Promise<Array<{ account: string; level: number; since: string; grantedBy: string }>> {
  // PINNED TO THE PLATFORM'S OWN NAMESPACE. A prefix scan without `ownerPrefix` reads across every
  // namespace, including the ones principals write to, so anybody could put a row at
  // `appmember.<slug>.<name>` in their own space and appear on somebody else's list of builders. It
  // would grant nothing — the gate reads one key in NS_MEMBER, which no principal can address — but a
  // list of who holds power over your app has to be true on the screen as well as in the check.
  const { items } = await storage.listAllMemory({
    ownerPrefix: NS_MEMBER, prefix: `appmember.${slugOf(appId)}.`, limit: 2000,
  });
  return items
    .filter(r => r.ownerGaii === NS_MEMBER)
    .map(r => r.value as AppMemberRecord)
    .filter(v => v && sameApp(v.appId, appId) && typeof v.dev === 'number' && isLive(v, now))
    .map(v => ({
      account: v.owner,
      level: v.dev as number,
      since: v.devSince ?? v.since,
      grantedBy: v.devBy ?? v.approvedBy,
    }))
    .sort((a, b) => a.level - b.level || a.account.localeCompare(b.account));
}

// ── The blanket right, in one place ───────────────────────────────────────────────────────────────

/**
 * "This person may build any app of mine."
 *
 * Its own record rather than a row on forty rosters, and that is the whole reason it exists as a
 * separate thing: a right written into every app's roster is a right the owner cannot see in one
 * place and cannot take back in one act. Here it is one list, one revoke.
 */
export interface AppDevBlanketGrant {
  /** The app owner who gave it. Bare account name, lowercased. */
  owner: string;
  /** The person who holds it. Bare account name, lowercased. */
  grantee: string;
  level: number;
  since: string;
  updatedAt: string;
  grantedBy: string;
  note: string;
  /** When it lapses, or null. A term costs nothing to offer and is how a trial ends by itself. */
  expiresAt: string | null;
}

export const blanketKey = (owner: string, grantee: string) =>
  `appdevall.${accountOf(owner)}.${accountOf(grantee)}`;

/** A blanket grant is live if it has no term, or its term has not run out. */
function blanketLive(rec: AppDevBlanketGrant | null | undefined, now: Date): boolean {
  if (!rec) return false;
  if (!rec.expiresAt) return true;
  return new Date(rec.expiresAt).getTime() > now.getTime();
}

/** Give (or change) a blanket right. */
export async function putBlanketGrant(
  storage: Storage,
  input: { owner: string; grantee: string; level: number; grantedBy: string; note?: string; expiresAt?: string | null },
): Promise<AppDevBlanketGrant> {
  const owner = accountOf(input.owner);
  const grantee = accountOf(input.grantee);
  const key = blanketKey(owner, grantee);
  const prev = (await storage.getMemory(NS_BLANKET, key))?.value as AppDevBlanketGrant | undefined;
  const now = new Date().toISOString();
  const rec: AppDevBlanketGrant = {
    owner,
    grantee,
    level: input.level,
    since: prev?.since ?? now,
    updatedAt: now,
    grantedBy: input.grantedBy,
    note: input.note ?? prev?.note ?? '',
    expiresAt: input.expiresAt !== undefined ? input.expiresAt : (prev?.expiresAt ?? null),
  };
  await writePrivateRecord(storage, NS_BLANKET, key, rec, {
    tags: ['app-dev-grant'],
    createdAt: prev ? undefined : now,
  });
  return rec;
}

/** Every blanket right one owner has given. The page that answers "who can touch my apps". */
export async function listBlanketGrants(
  storage: Storage, owner: string, now: Date = new Date(),
): Promise<AppDevBlanketGrant[]> {
  // Pinned to NS_BLANKET for the same reason listDevGrants is pinned to NS_MEMBER.
  const { items } = await storage.listAllMemory({
    ownerPrefix: NS_BLANKET, prefix: `appdevall.${accountOf(owner)}.`, limit: 2000,
  });
  return items
    .filter(r => r.ownerGaii === NS_BLANKET)
    .map(r => r.value as AppDevBlanketGrant)
    .filter(v => v && v.owner === accountOf(owner) && blanketLive(v, now))
    .sort((a, b) => a.level - b.level || a.grantee.localeCompare(b.grantee));
}

/** Take a blanket right back. Returns whether there was one. */
export async function removeBlanketGrant(storage: Storage, owner: string, grantee: string): Promise<boolean> {
  const key = blanketKey(owner, grantee);
  const prev = (await storage.getMemory(NS_BLANKET, key))?.value as AppDevBlanketGrant | undefined;
  if (!prev) return false;
  await storage.deleteMemory(NS_BLANKET, key);
  return true;
}

/** The blanket rung this person holds over this owner's apps, or null. */
export async function getBlanketLevel(
  storage: Storage, owner: string, principal: string, now: Date = new Date(),
): Promise<number | null> {
  const rec = (await storage.getMemory(NS_BLANKET, blanketKey(owner, principal)))?.value as AppDevBlanketGrant | undefined;
  if (!blanketLive(rec, now)) return null;
  return typeof rec!.level === 'number' ? rec!.level : null;
}

// ── Which right actually applies ──────────────────────────────────────────────────────────────────

export interface DelegatedDev {
  level: number;
  /** `app` when the right is on this app's own row, `all` when it comes from the blanket grant. */
  via: 'app' | 'all';
}

/**
 * The rung this person holds over this app, and where it came from.
 *
 * THE SPECIFIC ONE WINS. A row on the app's own roster answers even when a blanket grant would say
 * something else, in either direction: it is how an owner opens one app wider than the rest, and
 * how they narrow one without withdrawing everything. A blanket grant is the fallback, not a floor.
 *
 * `filename` may be absent — a listing asks about no app in particular — and then only the blanket
 * grant can answer.
 */
export async function effectiveDevLevel(
  storage: Storage,
  input: { owner: string; filename?: string | null; principal: string },
  now: Date = new Date(),
): Promise<DelegatedDev | null> {
  const owner = accountOf(input.owner);
  if (input.filename) {
    const perApp = await getDevGrant(storage, `${owner}/${input.filename}`, input.principal, now);
    if (typeof perApp === 'number') return { level: perApp, via: 'app' };
  }
  const blanket = await getBlanketLevel(storage, owner, input.principal, now);
  return typeof blanket === 'number' ? { level: blanket, via: 'all' } : null;
}

// ── The seam ──────────────────────────────────────────────────────────────────────────────────────

export interface AppTargetAsk {
  /**
   * The caller's own bare owner name, derived by the door in whatever way it already derives it.
   * Deliberately not a raw principal: the REST door reads an `owner` claim and the MCP door parses a
   * GAII, they disagree about which strings are acceptable, and folding that disagreement into this
   * function would change what each one accepts.
   */
  callerOwner: string;
  /** The owner named in the request. Absent, empty or the caller's own name means their own app. */
  requestedOwner?: string | null;
  /** The app the ask is about. Absent when the ask is not about one app. */
  filename?: string | null;
  /** What the caller means to do with it. */
  act: AppDevAct;
}

/**
 * The caller's own scope: the bucket their app writes have always landed in.
 *
 * This is the expression both doors carried a copy of, and the copies were not identical in what
 * they accepted as a principal, which is why each door still does its OWN extraction and hands the
 * finished owner name over. What was genuinely the same in both is this: strip nothing further,
 * resolve the identity record, fall back to `owner@node` when there is none.
 */
export async function ownAppScope(
  storage: Storage, config: AimeatConfig, callerOwner: string,
): Promise<{ ownerName: string; ownerGhii: string }> {
  const owner = String(callerOwner ?? '').trim();
  return { ownerName: owner, ownerGhii: await resolveGhii(storage, owner, `${owner}@${config.nodeId}`) };
}

export type AppTargetResolution =
  | { ok: true; ownerName: string; ownerGhii: string; delegated: DelegatedDev | null }
  | { ok: false; status: number; code: string; message: string };

/**
 * Which owner's bucket this act lands in — the ONE place that decides it.
 *
 * Both doors used to answer this for themselves, and both answered "the caller's own, always". They
 * still get exactly that answer when no other owner is named, which is what makes moving them here a
 * change of shape rather than of behaviour.
 *
 * The order matters and is the point. The owner is resolved, the grant is read and the rung is
 * checked BEFORE anything is written — the failure this repo keeps meeting is bytes that land while
 * the name they land under is still being decided.
 */
export async function resolveAppTarget(
  storage: Storage, config: AimeatConfig, ask: AppTargetAsk,
): Promise<AppTargetResolution> {
  // The caller's name is taken EXACTLY as the door handed it over, capitals and all. Owner names are
  // matched exactly in both storage providers, so folding the case here would address a bucket that
  // is not theirs: a data move disguised as tidying up.
  const caller = String(ask.callerOwner ?? '').trim();
  if (!caller) {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'No owner on the caller.' };
  }

  const requested = String(ask.requestedOwner ?? '').trim();
  // Compared as key segments, so `Alice` asking about `alice`'s app is asking about her own.
  if (!requested || accountOf(requested) === accountOf(caller)) {
    return { ok: true, ...(await ownAppScope(storage, config, caller)), delegated: null };
  }

  // Somebody else's app. It has to be somebody: a typo must not become a grant that waits forever
  // for an account that will never exist.
  const target = await storage.getGHIIByOwner(requested);
  if (!target) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: `No owner named "${requested}" on this node.` };
  }

  const held = await effectiveDevLevel(storage, {
    owner: requested, filename: ask.filename, principal: caller,
  });
  if (!held) {
    return {
      ok: false, status: 403, code: 'FORBIDDEN',
      message: `You have no development right on ${requested}'s apps. The owner grants it per app or across all of theirs.`,
    };
  }
  if (!mayAct(held.level, ask.act)) {
    const carries = actsFor(held.level);
    return {
      ok: false, status: 403, code: 'FORBIDDEN',
      message: `Your right on ${requested}'s app is "${levelName(held.level)}", which covers ${carries.join(', ')} and not ${ask.act}.`,
    };
  }

  return {
    ok: true,
    // The owner's own spelling, from the identity record rather than from the request: it is what
    // every app id, bucket key and URL for this app is already built from.
    ownerName: target.ownerName,
    ownerGhii: target.ghii,
    delegated: held,
  };
}
