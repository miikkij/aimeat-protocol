/**
 * @file src/types/webcrypto-globals.d.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The global CryptoKey TYPE, taken from Node's own webcrypto. The JWT code types its
 *   keys as the global `CryptoKey` (auth/jwt.ts, services/upload-token.ts, services/draft-token.ts and
 *   others), because jose takes and returns WebCrypto keys. @types/node 24, which matches the Node we
 *   run, declares `CryptoKey` globally only as a value; the type came from lib.dom, which one script
 *   (scripts/design-lab-crops.ts) references and which tsconfig.audit-tests.json, without scripts/,
 *   does not load. This states the type once, the way @types/node 25 does, and merges with lib.dom's
 *   interface where that is loaded too.
 * @usage Nothing imports it; the compiler loads it through the tsconfig include of src/.
 * @version-history
 *   v1.0.0 — 2026-10-23 — Initial, for @types/node 24.
 */
import type { webcrypto } from 'node:crypto';

declare global {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- a declaration merge, not an empty type
    interface CryptoKey extends webcrypto.CryptoKey {}
}

export {};
