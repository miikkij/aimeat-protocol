/**
 * @file media-handoff.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A short-lived public address for one file a publish is about to send, for the
 *   provider that FETCHES media rather than taking it in the request (Instagram: `image_url`,
 *   `video_url`). The bytes are held in this process for fifteen minutes under a random 256-bit
 *   token, served by GET /v1/connections/media/:token, and dropped when the publish ends.
 *
 *   WHY IN MEMORY AND NOT A STORAGE VISIBILITY. The file stays private in the owner's storage; what
 *   is public is one unguessable address for the minutes Instagram needs to read it. A storage file
 *   made `public` for the publish would stay public until somebody remembered to undo it, and would
 *   be listed as public in the owner's own storage meanwhile. The file has already passed the
 *   classification check (`leave`) before anything gets here, because it is about to be published
 *   to the world anyway.
 *
 *   ONE PROCESS. A node run as several processes behind one address would answer the provider's
 *   fetch from a process that does not hold the bytes. AIMEAT nodes run as one process; a node that
 *   does not would need this map in shared storage.
 * @structure handOff · takeHandedOff · HANDOFF_TTL_MS
 * @usage const h = handOff(file, config.baseUrl); try { ... h.url ... } finally { h.release(); }
 * @version-history
 *   v1.0.0 — 2026-10-15 — For Instagram publishing.
 */

import { randomBytes } from 'node:crypto';

/** Long enough for Instagram to fetch and transcode a short video; short enough to be no archive. */
export const HANDOFF_TTL_MS = 15 * 60 * 1000;

/** A ceiling on what one process holds at once: a handful of videos, not a cache. */
const MAX_HELD_BYTES = 1024 * 1024 * 1024;

interface Held { bytes: Buffer; mimeType: string; expiresAt: number }

const held = new Map<string, Held>();

function sweep(now: number): void {
  for (const [k, v] of held) if (v.expiresAt <= now) held.delete(k);
}

function heldBytes(): number {
  let n = 0;
  for (const v of held.values()) n += v.bytes.length;
  return n;
}

/**
 * Hold one file and answer the address a provider can fetch it from. `release()` drops it at once;
 * the publish calls it when the provider has answered, whatever the answer was.
 */
export function handOff(
  file: { bytes: Buffer; mimeType: string; name: string }, baseUrl: string,
): { url: string; release: () => void } | { error: string } {
  const now = Date.now();
  sweep(now);
  if (heldBytes() + file.bytes.length > MAX_HELD_BYTES) {
    return { error: 'this node is handing too many files to providers at once; try again in a few minutes' };
  }
  const token = randomBytes(32).toString('base64url');
  held.set(token, { bytes: file.bytes, mimeType: file.mimeType, expiresAt: now + HANDOFF_TTL_MS });
  // The name rides on the end of the address only so a provider that reads the extension sees one;
  // the token alone decides what is served.
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80) || 'file';
  return {
    url: `${baseUrl.replace(/\/$/, '')}/v1/connections/media/${token}/${safeName}`,
    release: () => { held.delete(token); },
  };
}

/** The bytes behind a token, or null when there are none (never held, released, or expired). */
export function takeHandedOff(token: string): { bytes: Buffer; mimeType: string } | null {
  const now = Date.now();
  const h = held.get(token);
  if (!h) return null;
  if (h.expiresAt <= now) { held.delete(token); return null; }
  return { bytes: h.bytes, mimeType: h.mimeType };
}
