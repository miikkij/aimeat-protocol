/**
 * @file src/config-data-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may reach an owner's data, and how long the trail of it is kept: the consent
 *   layer's settings (moved here unchanged from config.ts, which is at the line ceiling) and the
 *   classification switch (TARGET-082).
 *
 *   CLASSIFICATION IS OFF BY DEFAULT. Off, no read, write, AI call or export changes. `owner` lets
 *   each owner switch it on for their own content; `all` switches it on for every owner, and an
 *   owner cannot switch it off, because that would dilute the node's setting.
 * @structure ClassificationMode · ClassificationConfig · CLEARANCE_ID_PATTERN · parseAgentClearanceDefault() ·
 *   dataAccessDefaults()
 * @usage
 *   import { dataAccessDefaults } from './config-data-access.js';
 *   const config = { ...dataAccessDefaults(), ... };
 * @version-history
 *   v1.2.0 — 2026-10-18 — agentClearanceDefault (AIMEAT_AGENT_CLEARANCE_DEFAULT): the clearance a new
 *     agent gets, '' = no limit (plan doc-mvdipuyqraas, L2.1).
 *   v1.1.0 — 2026-10-11 — consentMaxPerUser (AIMEAT_CONSENT_MAX_PER_USER) removed: no code read it.
 *   v1.0.0 — 2026-09-29 — Initial. consentEnabled, consentAuditRetentionDays, accountEventWindow,
 *     executionLogRetentionDays and consentMaxPerUser moved from config.ts unchanged;
 *     classificationMode added (AIMEAT_CLASSIFICATION, TARGET-082).
 */

/** The node's classification switch. */
export type ClassificationMode = 'off' | 'owner' | 'all';

const CLASSIFICATION_MODES: readonly ClassificationMode[] = ['off', 'owner', 'all'];

/**
 * Named here rather than in config-types.ts, for the reason config-decide.ts gives: AimeatConfig
 * extends this interface, and the spread in loadConfig is where the compiler checks the two agree.
 */
export interface ClassificationConfig {
  /** off (default): nothing changes. owner: each owner decides for their own content. all: on for everyone. */
  classificationMode: ClassificationMode;
  /**
   * The clearance a NEW agent gets: the id of the highest classification label it may read (plan
   * doc-mvdipuyqraas, L2.1). '' (the default, decision 10.5) = no limit, today's behaviour. Agents
   * that already exist keep what they have. Matters only while classification is on.
   */
  agentClearanceDefault: string;
}

/** A label id as the classification policy writes one (levels.ts ID); '' is none. */
export const CLEARANCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The setting's value, or '' for anything that is not a label id. */
export function parseAgentClearanceDefault(v: unknown): string {
  return typeof v === 'string' && CLEARANCE_ID_PATTERN.test(v) ? v : '';
}

/** An unknown value is `off`, the one that changes nothing. */
export function parseClassificationMode(v: unknown): ClassificationMode {
  return CLASSIFICATION_MODES.find(m => m === v) ?? 'off';
}

/** The consent layer's settings and the classification switch, from the environment. */
export function dataAccessDefaults() {
  return {
    consentEnabled: process.env.AIMEAT_CONSENT_ENABLED !== 'false',
    consentAuditRetentionDays: parseInt(process.env.AIMEAT_CONSENT_AUDIT_RETENTION_DAYS ?? '365', 10),
    accountEventWindow: parseInt(process.env.AIMEAT_ACCOUNT_EVENT_WINDOW ?? '100', 10),
    executionLogRetentionDays: parseInt(process.env.AIMEAT_EXECUTION_LOG_RETENTION_DAYS ?? '30', 10),
    classificationMode: parseClassificationMode(process.env.AIMEAT_CLASSIFICATION),
    agentClearanceDefault: parseAgentClearanceDefault(process.env.AIMEAT_AGENT_CLEARANCE_DEFAULT),
  };
}
