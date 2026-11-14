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
 *   v1.3.0 — 2026-11-14 — 'secret-share-code' and 'secret-share-deposit': a secret share's pickup code
 *     and a secret request's deposit token.
 *   v1.2.1 — 2026-11-08 — The 'receiver' kind's text says incoming webhook and API key; the kind keeps
 *     its name (secaudit2026nov08b round 15b).
 *   v1.2.0 — 2026-11-07 — 'receiver': an outside program's key for one receiver of an owner
 *     (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 *   v1.1.0 — 2026-11-05 — 'intake-visitor', 'docsign-wallet', 'party-optional', 'federation-peer',
 *     'package-seller', 'package-claimant' (codebase analysis 2026-11-03, decision 2 of 2026-11-05).
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
    party: {
        credential: 'An outside party of an owner: HTTP Basic <owner>/<party name> with the party key, or a party token from '
            + 'POST /v1/parties/token (services/parties/verify.ts). No credential is 401, a stopped party 403.',
        admitsNoCredential: false,
    },
    'app-party': {
        credential: 'A person registered to one app without an account: the app party token from the app\'s sign-in link, '
            + 'checked for this app, its epoch, the party\'s status, the node setting and the Origin '
            + '(services/app-parties/service.ts appPartyFromRequest). No credential is 401.',
        admitsNoCredential: false,
    },
    'ucp-platform': {
        credential: 'A UCP 2026-08-25 platform buying for a person with no account: UCP-Agent names its profile, and a '
            + 'request signed under RFC 9421 is verified against that profile\'s keys. An unsigned request is taken, '
            + 'because UCP lets a business keep checkout open; the checkout id and its bound profile decide the rest.',
        admitsNoCredential: true,
    },
    'ucp-platform-signed': {
        credential: 'A UCP 2026-08-25 platform that must prove itself: UCP-Agent names its profile and the request is '
            + 'signed under RFC 9421 with a key of that profile. Unsigned is 401.',
        admitsNoCredential: false,
    },
    'intake-visitor': {
        credential: 'A visitor with no account in a conversation through a public intake form: the token the node gave '
            + 'when the conversation started, in the body, opening that conversation of that form and no other '
            + '(services/intake/visitor-thread.ts). No token, or one that opens nothing, is 404 THREAD_NOT_FOUND.',
        admitsNoCredential: false,
    },
    'docsign-wallet': {
        credential: 'An EU Digital Identity Wallet in a signing session: the 128-bit wallet session id only the person who '
            + 'started it was given, with the document token or the session state the request object named '
            + '(services/docsign/eudi.ts). An unknown session or a wrong token is 404, a wrong state 400.',
        admitsNoCredential: false,
    },
    'party-optional': {
        credential: 'An outside party buying again, when it presents its credential (the same as \'party\'): a credential '
            + 'that names no live party is refused as there, and a request with none is taken, because buying with '
            + 'no account is what the door is for.',
        admitsNoCredential: true,
    },
    'federation-peer': {
        credential: 'A peer node of this node: active, entitled to the door\'s capability, its key on file '
            + '(services/federation-peer-gate.ts), and an Ed25519 signature by that key over the exact text the door '
            + 'signs, always verified. A missing or unknown peer is 403, a missing or forged signature 401.',
        admitsNoCredential: false,
    },
    'package-seller': {
        credential: 'A seller node of a package on this repository: a request signed by an active peer over its method, '
            + 'path and body (services/packages/sale/package-sale-auth.ts), from a node the package\'s author names a '
            + 'seller. Unsigned is 401, a node that sells nothing here 403.',
        admitsNoCredential: false,
    },
    receiver: {
        credential: 'An outside program writing through an incoming webhook of an owner (the credential kind `receiver`): '
            + 'its API key as Authorization: Bearer aimeat_rcv_… for the route\'s :owner and :name, compared with the '
            + 'webhook\'s stored SHA-256 in constant time (services/receivers/verify.ts). No API key, a wrong API key and '
            + 'no such webhook are the same 401; an API key in the address is 400; a paused, stopped, expired or '
            + 'unapproved webhook 403; incoming webhooks switched off 503.',
        admitsNoCredential: false,
    },
    'package-claimant': {
        credential: 'A node redeeming a package claim code: a request signed with the key its own body names, by the node '
            + 'its body names (services/packages/sale/package-sale-auth.ts verifyRequestWithKey). Unsigned is 401.',
        admitsNoCredential: false,
    },
    'secret-share-code': {
        credential: 'A holder of a secret share\'s pickup code: the code in the body\'s `code` (or `code_verifier` for an '
            + 'end-to-end share), compared as an HMAC under the node key for the route\'s :id (services/secret-shares/pickup.ts '
            + 'verifyShareCode). No code and an unknown share are 404, a wrong code 403, ten wrong codes per share or address '
            + 'in 15 minutes 429.',
        admitsNoCredential: false,
    },
    'secret-share-deposit': {
        credential: 'A holder of a secret request\'s deposit link: the token in the body\'s `token`, compared as an HMAC under '
            + 'the node key for the route\'s :id (services/secret-shares/service.ts verifyDepositToken). No token, a wrong one '
            + 'and an unknown request are the same 404.',
        admitsNoCredential: false,
    },
} as const satisfies Record<string, CredentialKindInfo>;

export type CredentialKind = keyof typeof CREDENTIAL_KINDS;

/** The kinds, for the inventory. */
export const CREDENTIAL_KIND_NAMES = Object.keys(CREDENTIAL_KINDS) as CredentialKind[];
