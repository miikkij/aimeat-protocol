/**
 * @file src/services/contact-handles.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A handle saying "this owner chose this contact, for this app, just now".
 *
 *   The problem it exists for: an app must be able to reach one person out of the owner's address
 *   book without being able to READ the address book. Every alternative gives it the list. So the
 *   user picks, on a page the app cannot see into, and the app is handed an opaque handle it can
 *   spend and nothing else. The address never crosses into the app, and the app never learns who
 *   else is in there.
 *
 *   Shape and lifetime follow routes/extensions/internal-pass.ts, which is this project's existing
 *   answer to the same question: a random token held in this process's memory, minted only by the
 *   node, never derived from caller input, expiring on its own. Two deliberate differences. It
 *   lasts MINUTES rather than seconds, because a person is choosing rather than a loopback call
 *   completing; and it is reusable until it expires, because "you may write to Anna" that stops
 *   working after one message is a permission an app cannot build on.
 *
 *   It is NOT persisted, and that is the honest limit: a node restart, or a second process,
 *   forgets every outstanding handle and the app has to ask the user again. The same is true of
 *   the OAuth codes in routes/app-grants.ts, for the same reason — a short-lived permission that
 *   survives a restart is a credential, and this is not meant to be one. Anything an app should
 *   hold across restarts is a grant, and a grant is asked for on a consent screen.
 * @structure ContactHandle · mintContactHandle · resolveContactHandle
 * @usage
 *   const handle = mintContactHandle({ ownerGhii, app, contactId });   // the picker, owner session
 *   const chosen = resolveContactHandle(handle, ownerGhii, app);       // the send, app-grant token
 * @version-history
 *   v1.0.0 — 2026-08-17 — TARGET-063 phase 3: the app gets a handle, never the address book.
 */
import { randomBytes } from 'node:crypto';

/** What a handle stands for. All three are server-derived; none comes from the app. */
export interface ContactHandle {
  /** The owner whose address book was opened. */
  ownerGhii: string;
  /** The app grant target the picker was framed by, `owner/filename`. */
  app: string;
  /** The address-book id the person chose. */
  contactId: string;
}

/**
 * Ten minutes. Long enough that a person can pick a contact, read what the app is about to do and
 * confirm it; short enough that a handle left in a closed tab is gone before it matters.
 */
const TTL_MS = 10 * 60_000;

/**
 * A ceiling on outstanding handles, so a script that opens the picker in a loop cannot grow this
 * map without bound. Reaching it drops the OLDEST handle, which is the one whose chooser has most
 * likely walked away.
 */
const MAX_HANDLES = 5_000;

const handles = new Map<string, { handle: ContactHandle; expiresAt: number }>();

/** Drop anything expired. Cheap: the map holds at most the picks in flight. */
function sweep(now: number): void {
  for (const [token, held] of handles) {
    if (held.expiresAt <= now) handles.delete(token);
  }
}

export function mintContactHandle(handle: ContactHandle): string {
  const now = Date.now();
  sweep(now);
  // Insertion order is creation order in a Map, so the first key is the oldest.
  while (handles.size >= MAX_HANDLES) {
    const oldest = handles.keys().next().value;
    if (oldest === undefined) break;
    handles.delete(oldest);
  }
  const token = randomBytes(24).toString('base64url');
  handles.set(token, { handle, expiresAt: now + TTL_MS });
  return token;
}

/**
 * Resolve a handle, and PROVE it belongs to this caller.
 *
 * Both bindings are checked, not just the token's existence. Being unforgeable is not the same as
 * being about this call: a handle minted while owner A had app X framed must not be spendable by
 * app Y, nor on owner B's behalf. Every failure answers the same way — null, meaning "there is no
 * such choice", never "wrong app".
 */
export function resolveContactHandle(
  token: string | undefined | null, ownerGhii: string, app: string | undefined,
): ContactHandle | null {
  if (!token || !ownerGhii || !app) return null;
  const held = handles.get(token);
  if (!held) return null;
  if (held.expiresAt <= Date.now()) { handles.delete(token); return null; }
  if (held.handle.ownerGhii !== ownerGhii || held.handle.app !== app) return null;
  return held.handle;
}

/** Drop every handle for one (owner, contact) — used when that contact is removed. */
export function revokeContactHandles(ownerGhii: string, contactId: string): void {
  for (const [token, held] of handles) {
    if (held.handle.ownerGhii === ownerGhii && held.handle.contactId === contactId) handles.delete(token);
  }
}
