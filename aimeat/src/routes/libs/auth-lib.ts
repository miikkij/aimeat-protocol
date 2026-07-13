/**
 * @file src/routes/libs/auth-lib.ts
 * @description aimeat-auth.js browser library generator; concatenates the three extracted source segments. Extracted from libs.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from libs.ts (max-file-lines)
 */
import type { AimeatConfig } from '../../config.js';
import { aimeatAuthLibPart1 } from './auth-lib-part1.js';
import { aimeatAuthLibPart2 } from './auth-lib-part2.js';
import { aimeatAuthLibPart3 } from './auth-lib-part3.js';

/**
 * Serves the self-contained aimeat-auth.js browser library: GHII registration, Ed25519
 * Web Crypto auth, JWT lifecycle, H-2 app-origin SSO, the login pill + sign-in modal.
 */
export function aimeatAuthLib(config: AimeatConfig): string {
  return aimeatAuthLibPart1(config) + aimeatAuthLibPart2() + aimeatAuthLibPart3();
}
