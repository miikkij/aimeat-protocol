/**
 * @file src/auth/credential-kinds.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The credential kinds a route can declare with acceptCredential()
 *   (./credential-strategies.ts), as data: what each credential is, and whether the strategy also lets
 *   through a request that carries none. A leaf with no imports, because the door inventory
 *   (scripts/inventory/principals.ts) reads it to decide which callers a declared door admits, and a
 *   script must not load the services a strategy calls.
 *
 *   `admitsNoCredential` is the honest half of the ratchet in check:open-writes: a door whose strategy
 *   admits a request with no credential is still a door that takes no credential, so it keeps its
 *   written reason in security/open-write-exemptions.json. Only a strategy that refuses a missing
 *   credential takes the door off that list.
 * @structure CREDENTIAL_KINDS · CredentialKind
 * @usage import { CREDENTIAL_KINDS, type CredentialKind } from './credential-kinds.js';
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item B8).
 */

export interface CredentialKindInfo {
    /** What the caller presents, in one sentence, for the inventory and the exemption reasons. */
    credential: string;
    /** True when the strategy lets a request with no credential of this kind through to the handler. */
    admitsNoCredential: boolean;
}

export const CREDENTIAL_KINDS = {
    'dsp-participant': {
        credential: 'A Dataspace Protocol participant: a DCP self-issued token verified against the participant\'s did:web, '
            + 'or one of the operator\'s static tokens (services/dataspace/verifier.ts). No credential is 401.',
        admitsNoCredential: false,
    },
} as const satisfies Record<string, CredentialKindInfo>;

export type CredentialKind = keyof typeof CREDENTIAL_KINDS;

/** The kinds, for the inventory. */
export const CREDENTIAL_KIND_NAMES = Object.keys(CREDENTIAL_KINDS) as CredentialKind[];
