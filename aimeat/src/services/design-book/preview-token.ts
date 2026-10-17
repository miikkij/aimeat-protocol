/**
 * @file src/services/design-book/preview-token.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The token that lets a frame show a Design Book part that is not published yet.
 *   A published part's preview is public, as the published shelf is. A part still in proposal is
 *   for signed-in readers only, the same rule the list and the detail read follow, and a preview is
 *   loaded by an iframe, which carries no session. So the list and the detail read, answering a
 *   signed-in caller, hand each unpublished part a `preview_url` that carries this token, and
 *   GET /v1/designbook/:id/preview opens an unpublished part only with a token naming that part.
 *
 *   An EdDSA JWT signed with the node keys, like the page-frame and download tokens, valid for an
 *   hour, naming one part id. It opens nothing else and no published part needs it.
 * @structure initDesignBookPreviewTokenKeys() · designBookPreviewToken() · designBookPreviewTokenOpens() · DB_PREVIEW_TTL_SECONDS
 * @usage
 *   const t = await designBookPreviewToken(part.id);           // minted for a signed-in reader
 *   if (!(await designBookPreviewTokenOpens(req.query.t, id))) → 404
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial: a proposal's preview stops being public (plan doc-mvcn6c7e4e5q, V0.4).
 */
import { SignJWT, jwtVerify } from 'jose';
import { logger } from '../../utils/logger.js';

let _privateKey: CryptoKey | null = null;
let _publicKey: CryptoKey | null = null;

export function initDesignBookPreviewTokenKeys(privateKey: CryptoKey, publicKey: CryptoKey): void {
  _privateKey = privateKey;
  _publicKey = publicKey;
}

/** An hour, as the page frame: a gallery is looked at, not kept open for a day. */
export const DB_PREVIEW_TTL_SECONDS = 3600;

/** A token that opens the preview of the one part `id`. */
export async function designBookPreviewToken(id: string): Promise<string> {
  if (!_privateKey) throw new Error('Design Book preview token keys not initialized');
  return new SignJWT({ typ: 'dbpreview', id })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${DB_PREVIEW_TTL_SECONDS}s`)
    .sign(_privateKey);
}

/** True when `token` is a valid, unexpired preview token for exactly the part `id`. */
export async function designBookPreviewTokenOpens(token: unknown, id: string): Promise<boolean> {
  if (!_publicKey || typeof token !== 'string' || !token || token.length > 4096) return false;
  try {
    const p = (await jwtVerify(token, _publicKey, { algorithms: ['EdDSA'] })).payload as Record<string, unknown>;
    return p.typ === 'dbpreview' && p.id === id;
  } catch (err) {
    logger.debug('designbook preview: a token that opens nothing', { error: String(err) });
    return false;
  }
}
