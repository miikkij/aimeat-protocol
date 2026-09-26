/**
 * @file src/services/app-isolation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How this node keeps a published app away from the sign-in of the person who opens
 *   it, decided in one place. Three answers:
 *     - app-origin      every app runs on an address of its own (`<name>.apps.<domain>`), where the
 *                       node's session does not exist at all. The full isolation, and aimeat.io's.
 *     - isolated-frame  several people have an account here and apps have no address of their own,
 *                       so an app runs in a frame on the node's own address whose origin is opaque:
 *                       it reads no cookie, no storage and no session of the node, and it reaches
 *                       the node only with a grant of its own, which the page holding the frame gets
 *                       for it (routes/apps/inline-frame.ts, src/static/app-frame.js).
 *     - shared-origin   one person has an account here and apps have no address of their own: an app
 *                       runs on the node's own address with that person's sign-in, because every app
 *                       on the node is theirs. This is how every node without an app origin worked
 *                       before, and it stays that way for the one-person node.
 *   Audit A7-1 (2026-09-24): on a node several people shared without an app origin, an app ran on the
 *   node's own address, where another person's session lives, and the node links other people's apps
 *   from its front page. Ruled by the developer: such apps run in an isolated frame that shares no
 *   session with the main site and talk to the node through the app's own token.
 * @structure
 *   - peopleWhoPublish(storage, opts) — accounts that can publish an app (the shared anonymous
 *     identity cannot), counted with a short memory
 *   - appIsolationMode(config, storage) — the answer every door asks
 *   - resetAppIsolationCache() — tests only
 * @usage
 *   import { appIsolationMode } from '../services/app-isolation.js';
 *   if (await appIsolationMode(config, storage) === 'isolated-frame') { ... }
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial (audit A7-1: apps on shared nodes without an app origin).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

export type AppIsolationMode = 'app-origin' | 'isolated-frame' | 'shared-origin';

/** The shared identity anonymous visitors hold. It has no `app:write`, so it publishes nothing. */
const ANONYMOUS_OWNER = 'anonymous';

/**
 * How long a count of ONE is believed. A second account can appear at any moment (a registration, a
 * directory sync), and until the node notices, that person's apps would run on the node's own
 * address. Two seconds is the whole exposure, and what it saves is a listOwners() per app open on a
 * one-person node, which answers with a row or two.
 */
const ONE_PERSON_TTL_MS = 2000;

/**
 * The last count, per storage. A count above one is kept for the life of the process: a node that
 * has served several people keeps isolating apps until it restarts, even if accounts are deleted
 * down to one, because the mistake in that direction is a frame the node did not need.
 */
let cached: { storage: Storage; people: number; at: number } | null = null;

/**
 * How many people with an account here can publish an app. The shared anonymous identity is left
 * out: it holds no `app:write` (auth/anonymous-scopes.ts), so it never has an app to run.
 *
 * A storage failure answers "several", which isolates: an app in a frame it did not need is a far
 * smaller fault than an app beside another person's session.
 */
export async function peopleWhoPublish(storage: Storage, opts: { fresh?: boolean } = {}): Promise<number> {
  const now = Date.now();
  if (!opts.fresh && cached && cached.storage === storage
      && (cached.people > 1 || now - cached.at < ONE_PERSON_TTL_MS)) {
    return cached.people;
  }
  try {
    const owners = await storage.listOwners();
    const people = owners.filter(o => o.name !== ANONYMOUS_OWNER).length;
    cached = { storage, people, at: now };
    return people;
  } catch (err) {
    logger.warn('app-isolation: could not count the accounts, so apps are isolated', { error: String(err) });
    return 2;
  }
}

/** Which of the three answers this node gives right now. */
export async function appIsolationMode(config: AimeatConfig, storage: Storage): Promise<AppIsolationMode> {
  if (config.appOriginEnabled && config.appHost) return 'app-origin';
  return (await peopleWhoPublish(storage)) > 1 ? 'isolated-frame' : 'shared-origin';
}

/** Forget the count. For unit tests that build more than one node in a process. */
export function resetAppIsolationCache(): void {
  cached = null;
}
