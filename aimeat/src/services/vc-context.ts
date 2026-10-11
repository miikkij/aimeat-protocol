/**
 * @file src/services/vc-context.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The JSON-LD context of the AIMEAT identity credential: its address in the node's own
 *   namespace (https://aimeat.io/ns/), the context document every node serves at that path, and the
 *   contexts a verifier accepts.
 *
 * @structure
 *   - CREDENTIALS_CONTEXT: the context a new credential names
 *   - LEGACY_CREDENTIALS_CONTEXTS: contexts earlier releases issued under, still accepted when verifying
 *   - ACCEPTED_CREDENTIALS_CONTEXTS: both, in that order
 *   - credentialsContextDocument(): what GET /ns/credentials/v1 serves on every node (routes/ns.ts)
 *
 * @version-history
 *   v1.0.0 — 2026-10-11 — The credential named https://aimeat.spechops.com/ns/credentials/v1, a host
 *     this project does not serve. A credential issued that way is valid for a year and keeps
 *     verifying: the old context stays accepted while any of them can still be valid
 *     (wish-vc-n-context-url-noden-omaan-nimiavaruuteen-aimeat-spechops-).
 */
import { AIMEAT_NS } from '../utils/onto-context.js';

/** The W3C base context every credential names first. */
export const W3C_CREDENTIALS_CONTEXT = 'https://www.w3.org/ns/credentials/v2';
/** Where the identity credential's own terms are defined: https://aimeat.io/ns/credentials/v1. */
export const CREDENTIALS_CONTEXT = `${AIMEAT_NS}credentials/v1`;
/** Issued by 3.26.1 and earlier; a signed credential lives 365 days, so a verifier keeps accepting it. */
export const LEGACY_CREDENTIALS_CONTEXTS = ['https://aimeat.spechops.com/ns/credentials/v1'] as const;
export const ACCEPTED_CREDENTIALS_CONTEXTS: readonly string[] = [CREDENTIALS_CONTEXT, ...LEGACY_CREDENTIALS_CONTEXTS];

/** The JSON-LD context document: the credential's type names and subject fields, in the aimeat: namespace. */
export function credentialsContextDocument(): Record<string, unknown> {
  return {
    '@context': {
      '@protected': true,
      aimeat: AIMEAT_NS,
      xsd: 'http://www.w3.org/2001/XMLSchema#',
      AIMEATIdentityCredential: 'aimeat:IdentityCredential',
      AIMEATUser: 'aimeat:User',
      verificationLevel: { '@id': 'aimeat:verificationLevel', '@type': 'xsd:integer' },
      memberSince: { '@id': 'aimeat:memberSince', '@type': 'xsd:date' },
      displayName: 'aimeat:displayName',
    },
  };
}
