/**
 * @file src/utils/otk.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One-time-key (OTK) generator utility — produces random, prefixed OTK strings.
 *   (OTK/Tier 0.5 is a deprecated mechanism per the v4.0 spec.)
 *
 * @structure
 *   - generateOtk(): returns an `otk-<32 hex chars>` token from 16 random bytes
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { randomBytes } from 'node:crypto';

export function generateOtk(): string {
  return `otk-${randomBytes(16).toString('hex')}`;
}
