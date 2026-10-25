/**
 * @file src/services/config-schema-rate-limits.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rate-limit settings on the admin Config tab. A pure move out of
 *   config-schema.ts (max-file-lines), as config-schema-morsels.ts was: CONFIG_FIELDS spreads these
 *   rows where they stood, so the Config tab lists them in the same order.
 * @structure RATE_LIMIT_CONFIG_FIELDS
 * @version-history
 *   v1.1.0 — 2026-10-25 — rate_limits.registration_invites and rate_limits.openrouter, which the loader
 *     read with no row (check:config-coverage backlog).
 *   v1.0.0 — 2026-10-11 — Moved from config-schema.ts, unchanged.
 */
// Typed by the keys alone, not AimeatConfig: config.ts reaches config-schema.ts, so importing the
// config type here would close an import cycle (config-schema-morsels.ts says the same).
import type { ConfigFieldShape } from './config-field-def.js';

type RateLimitKey = 'rlGlobal' | 'rlAuth' | 'rlWork' | 'rlMemory' | 'rlBoards' | 'rlOwners' | 'rlGhii'
  | 'rlFlags' | 'rlAppeals' | 'rlAdminSetup' | 'rlFederation' | 'rlCatalogue' | 'rlAuthChallenge'
  | 'rlRegistrationInvites' | 'rlOpenrouter';

export const RATE_LIMIT_CONFIG_FIELDS: ConfigFieldShape<RateLimitKey>[] = [
  // ── Rate Limits (mutable, per-endpoint with global fallback) ──
  { key: 'rlGlobal', dotPath: 'rate_limits.global', envVar: 'AIMEAT_RL_GLOBAL', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Global rate limit (requests/second)', range: '1-10000' },
  { key: 'rlAuth', dotPath: 'rate_limits.auth', envVar: 'AIMEAT_RL_AUTH', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Auth endpoint rate limit (req/s)', range: '1-10000' },
  { key: 'rlWork', dotPath: 'rate_limits.work', envVar: 'AIMEAT_RL_WORK', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Work queue rate limit (req/s)', range: '1-10000' },
  { key: 'rlMemory', dotPath: 'rate_limits.memory', envVar: 'AIMEAT_RL_MEMORY', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Memory read/write rate limit (req/s)', range: '1-10000' },
  { key: 'rlBoards', dotPath: 'rate_limits.boards', envVar: 'AIMEAT_RL_BOARDS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Board endpoint rate limit (req/s)', range: '1-10000' },
  { key: 'rlOwners', dotPath: 'rate_limits.owners', envVar: 'AIMEAT_RL_OWNERS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Owner endpoint rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlGhii', dotPath: 'rate_limits.ghii', envVar: 'AIMEAT_RL_GHII', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Identity (GHII) rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlFlags', dotPath: 'rate_limits.flags', envVar: 'AIMEAT_RL_FLAGS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Content flagging rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlAppeals', dotPath: 'rate_limits.appeals', envVar: 'AIMEAT_RL_APPEALS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Flag appeals rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlAdminSetup', dotPath: 'rate_limits.admin_setup', envVar: 'AIMEAT_RL_ADMIN_SETUP', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Admin setup rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlFederation', dotPath: 'rate_limits.federation', envVar: 'AIMEAT_RL_FEDERATION', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Federation peering rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlCatalogue', dotPath: 'rate_limits.catalogue', envVar: 'AIMEAT_RL_CATALOGUE', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Catalogue search rate limit (req/s, default: global)', range: '1-10000' },
  { key: 'rlAuthChallenge', dotPath: 'rate_limits.auth_challenge', envVar: 'AIMEAT_RL_AUTH_CHALLENGE', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Auth challenge rate limit (req/s, default: global)', range: '1-10000' },
  // Windows other than one second: an hour for the invitation emails, a minute for the OpenRouter proxy.
  { key: 'rlRegistrationInvites', dotPath: 'rate_limits.registration_invites', envVar: 'AIMEAT_RL_REGISTRATION_INVITES', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Invitation emails an hour from the open registration endpoint (default 5). It sends mail to an address a stranger types, so keep it small', range: '1-1000' },
  { key: 'rlOpenrouter', dotPath: 'rate_limits.openrouter', envVar: 'AIMEAT_RL_OPENROUTER', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1, immutable: false, description: 'Requests a minute to the OpenRouter proxy (default 30)', range: '1-10000' },
];
