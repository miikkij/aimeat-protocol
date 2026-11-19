/**
 * @file src/services/kyc/screening/index.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sanctions screening for anti-money-laundering customer due diligence (Regulation (EU)
 *   2024/1624): the EU Financial Sanctions Files and the UN Security Council consolidated list parsed
 *   into one entry shape (lists.ts), and a person or legal entity matched against them (match.ts).
 *   The caller fetches the list bytes and stores the results; nothing here does I/O.
 * @structure re-exports of lists.ts and match.ts
 * @usage import { listOf, screen } from '../kyc/screening/index.js';
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial.
 */
export {
  MAX_LIST_BYTES, listOf, listVersion, parseEuFsf, parseUnConsolidated,
  type SanctionsEntry, type SanctionsList, type SanctionsSource,
} from './lists.js';
export {
  DEFAULT_THRESHOLD, LEGAL_FORM_TOKENS, jaroWinkler, normaliseName, screen,
  type Hit, type ScreenOptions, type Subject,
} from './match.js';
