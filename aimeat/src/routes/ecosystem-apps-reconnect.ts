/**
 * @file src/routes/ecosystem-apps-reconnect.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a pending ecosystem-app request says about the app's live connection: whether it
 *   reconnects an app the owner already connected and whether its key differs from the pinned one.
 *   Extracted from ecosystem-apps.ts by pure move to satisfy max-file-lines.
 * @structure keyFingerprint(publicKey) · reconnectView(pinnedKey, requestKey)
 * @usage ...reconnectView(connected.get(r.app), r.publicKey) in GET /v1/ecosystem-apps/pending.
 * @version-history
 *   v1.0.0 — 2026-10-27 — Extracted from ecosystem-apps.ts (max-file-lines), unchanged
 *     (secaudit2026oct26, token-pickup-without-pinned-key-proof made the route file grow).
 */
import { createHash } from 'node:crypto';

/**
 * A short, comparable name for a public key, for the owner to tell two keys apart. The input is a
 * PUBLIC key and the output is shown, so this is a display digest, not a stored secret: CodeQL
 * js/insufficient-password-hash (code scanning 1766) reads the pending record as a password source,
 * and that alert is dismissed as a false positive with this reason.
 */
export function keyFingerprint(publicKey: string): string {
  return createHash('sha256').update(publicKey).digest('hex').slice(0, 16).match(/.{4}/g)!.join(':');
}

/**
 * What a pending request says about the app's live connection: `reconnect` when the owner already
 * connected this app, `key_changed` when the request carries another key than the pinned one, and
 * then both fingerprints.
 */
export function reconnectView(pinnedKey: string | undefined, requestKey: string | undefined) {
  const reconnect = pinnedKey !== undefined;
  const keyChanged = reconnect && !!requestKey && requestKey !== pinnedKey;
  return {
    reconnect,
    key_changed: keyChanged,
    ...(keyChanged ? { pinned_key_fingerprint: keyFingerprint(pinnedKey!), key_fingerprint: keyFingerprint(requestKey!) } : {}),
  };
}
