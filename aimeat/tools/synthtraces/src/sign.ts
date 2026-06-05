/**
 * @file sign.ts
 * @description Ed25519 signing helper for AIMEAT auth challenges, mirroring the
 *   proven recipe in test/api-full.ts. Owners sign `owner + nodeId + timestamp`;
 *   agents sign `gaii + timestamp`. The node verifies against the stored public key.
 * @structure signMsg(privateKeyB64, message) -> base64 signature
 * @usage import { signMsg } from './sign.js';
 * @version-history
 *   v0.1.0 -- 2026-06-05 -- Initial PoC
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

// Ed25519 needs a synchronous sha512 for some paths; wire node:crypto in.
// Cast: the assignable hook is not in @noble/ed25519 v3's public `etc` type.
(ed.etc as unknown as { sha512Sync: (...m: Uint8Array[]) => Uint8Array }).sha512Sync = (...m: Uint8Array[]) =>
  new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

export async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const privKey = Buffer.from(privateKeyB64, 'base64');
  const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
  return Buffer.from(sig).toString('base64');
}
