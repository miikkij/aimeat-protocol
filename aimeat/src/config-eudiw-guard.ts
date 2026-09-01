/**
 * @file src/config-eudiw-guard.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A boot refusal, and a specification of what has to be true before it is deleted.
 *
 *   THE GAP. `services/sd-jwt.ts` verifies the ISSUER's signature on a presented credential and
 *   checks nothing else: no holder binding (no key-binding JWT, so nothing ties the presentation to
 *   the wallet the credential was issued to) and no nonce (so the authorization request's own
 *   challenge is generated in `services/eudiw.ts` and never read back). A presented credential is
 *   therefore REPLAYABLE by anyone who has seen one, and what it buys is an identity verification.
 *
 *   IT IS DORMANT, AND DORMANT IS NOT THE SAME AS SAFE. `AIMEAT_EUDIW_ENABLED` defaults to false, so
 *   nothing is reachable today. A flag is a thing somebody turns on — to try a wallet, to demo the
 *   flow, to see whether it works — and the person who turns it on will not have read this file.
 *   So the flag refuses instead of the code silently accepting.
 *
 *   WHY A REFUSAL AND NOT A WARNING. `config-posture.ts` is warn-only by contract, and rightly so:
 *   every entry there is an operator choosing a risk they can see. This is not that. An operator
 *   turning this on is choosing a feature and getting a hole they were not told about, which is the
 *   one shape a warning cannot cover — it scrolls past in a boot log and the node runs anyway.
 *
 *   WHAT DELETES THIS FILE. Holder binding and replay defence in the SD-JWT verification path:
 *     1. A key-binding JWT (SD-JWT VC §4.3) presented with the credential, verified against the
 *        `cnf` claim in the credential itself, so the presenter is the holder it was issued to.
 *     2. The KB-JWT's `nonce` compared against the nonce this node put in its own authorization
 *        request, and that nonce spent — `services/assertion-spend.ts` is the existing shape.
 *     3. The KB-JWT's `aud` equal to this node's verifier client id, so a presentation made for
 *        somebody else does not work here.
 *   With those three, delete this file and its call in `loadConfig`, and the flag means what it
 *   says. Anything less and the flag is a way to turn on a replayable login.
 *
 * @structure assertEudiwNotHalfBuilt()
 * @usage called from loadConfig(), beside the node-type refusal
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial. Named during the Agent v2 A2A review as a replay-adjacent path
 *     outside that work; closed as "cannot be enabled" rather than by implementing holder binding.
 */

/**
 * Refuse to start when EUDIW is switched on, because the verification behind it is half built.
 *
 * Reads `process.env` directly rather than a resolved config, for the same reason the node-type
 * refusal does: this has to fire before anything is constructed from the value it is refusing.
 */
export function assertEudiwNotHalfBuilt(): void {
  if (process.env.AIMEAT_EUDIW_ENABLED !== 'true') return;
  throw new Error([
    'AIMEAT_EUDIW_ENABLED=true, and this node will not start with it on.',
    '',
    'What is missing: the SD-JWT verification in services/sd-jwt.ts checks the issuer signature and',
    'nothing else. There is no holder binding — no key-binding JWT verified against the credential\'s',
    'own `cnf` claim — and the nonce this node puts in its authorization request is never read back.',
    'A credential presented to it can therefore be replayed by anyone who has seen one, and what it',
    'buys is an identity verification.',
    '',
    'The flag exists for development against a spec this node has not finished implementing. Turn it',
    'off. When holder binding, nonce checking and audience checking are built, the guard in',
    'src/config-eudiw-guard.ts is deleted and this message goes with it.',
  ].join('\n'));
}
