/**
 * @file src/services/docsign/verify-signatures.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The checks of a signing request's signatures: for each one, whether the sealed
 *   statement names this request and this document, whether the node's seal verifies, and whether the
 *   signer's own evidence (a passkey assertion or a key signature) verifies. Moved out of records.ts
 *   on 2026-10-25 unchanged, to keep that file under max-file-lines; records.ts exports both again,
 *   so every import of them is unchanged.
 * @structure SignatureCheck · verifyRecordSignatures(ctx, rec)
 * @usage const checks = await verifyRecordSignatures(ctx, rec);
 * @version-history
 *   v1.1.0 -- 2026-10-25 -- A check carries the caveats sealed into the statement (secaudit2026oct22, lead 3895).
 *   v1.0.0 -- 2026-10-25 -- Moved from records.ts (max-file-lines), bodies verbatim.
 */
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AimeatConfig } from '../../config.js';
import { verify as verifyEd25519 } from '../../auth/keypair.js';
import { intentChallenge, keyMessage, evidenceHash, verifySeal, type SignMethod, type Assurance, type StatementCaveat } from './statement.js';
import type { DocsignCtx, DocSignRecord, PasskeyEvidence } from './records.js';

export interface SignatureCheck {
  signer: string;
  signerName: string | null;
  signedAt: string;
  method: SignMethod;
  assurance: Assurance;
  /** The statement names this request and this document. */
  consistent: boolean;
  /** The node's seal verifies, with this node's current key. */
  sealValid: boolean;
  sealByThisNode: boolean;
  /** The signer's own evidence verifies (passkey assertion or key signature); null for session. */
  evidenceValid: boolean | null;
  valid: boolean;
  /** A wallet signature from an EU reference-wallet test certificate: a test with no legal effect. */
  test: boolean;
  /** What the node could not establish when it sealed the signature, as sealed; empty when nothing. */
  caveats: StatementCaveat[];
}

export async function verifyRecordSignatures(ctx: DocsignCtx, rec: DocSignRecord): Promise<SignatureCheck[]> {
  const nodeKey = await ctx.storage.getNodeKey();
  const out: SignatureCheck[] = [];
  for (const [signer, sig] of Object.entries(rec.signatures)) {
    const st = sig.statement;
    const consistent = st.request === rec.id && st.document.sha256 === rec.document.sha256 && st.signer === signer
      && st.evidence === evidenceHash(sig.passkey ?? sig.key ?? sig.wallet ?? null);
    const sealValid = await verifySeal(st, sig.seal);
    const sealByThisNode = !!nodeKey && sig.seal.publicKey === nodeKey.publicKey;
    let evidenceValid: boolean | null = null;
    if (sig.key) {
      evidenceValid = sig.key.message === keyMessage(rec.id, rec.document.sha256, signer)
        // eslint-disable-next-line aimeat/no-silent-catch -- a stored key or signature that will not decode is evidence that does not verify: false is the answer
        && await verifyEd25519(sig.key.publicKey, sig.key.message, sig.key.signature).catch(() => false);
    } else if (sig.passkey) {
      evidenceValid = await verifyPasskeyEvidence(ctx.config, rec, signer, sig.passkey);
    }
    out.push({
      signer, signerName: st.signerName, signedAt: st.signedAt, method: st.method, assurance: st.assurance,
      consistent, sealValid, sealByThisNode, evidenceValid,
      valid: consistent && sealValid && sealByThisNode && evidenceValid !== false,
      // The sealed mark, or for a statement sealed before the mark existed, the stored wallet evidence.
      test: st.test === true || sig.wallet?.validation.test === true,
      // Read from the sealed statement, so a caveat is shown only as the seal covers it.
      caveats: st.caveats ?? [],
    });
  }
  return out;
}

async function verifyPasskeyEvidence(config: AimeatConfig, rec: DocSignRecord, signer: string, ev: PasskeyEvidence): Promise<boolean> {
  if (ev.intent.request !== rec.id || ev.intent.document !== rec.document.sha256 || ev.intent.signer !== signer) return false;
  try {
    const v = await verifyAuthenticationResponse({
      response: ev.assertion as never,
      expectedChallenge: Buffer.from(intentChallenge(ev.intent)).toString('base64url'),
      expectedOrigin: ev.origin,
      expectedRPID: config.passkeyRpId,
      credential: { id: ev.credentialId, publicKey: new Uint8Array(Buffer.from(ev.publicKey, 'base64url')), counter: 0 },
      requireUserVerification: true,
    });
    return v.verified;
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- the library throws for an assertion that does not verify (wrong challenge, origin, signature); false is that answer
    return false;
  }
}
