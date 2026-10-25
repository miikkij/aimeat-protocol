/**
 * @file src/services/setup-env.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node settings the first-run setup route (POST /v1/setup/init) takes, checked, and
 *   the .env file it writes from them.
 *
 *   WHY. The route wrote nodeId, nodeType, genesisUrl and locale into .env as they came, from a caller
 *   who is not signed in on a node that has no owner yet. A line break in any of them added a
 *   variable to the file the node reads at its next start (secrets audit 2026-10-09, node
 *   configuration S1). Each setting is now held to what the node actually takes, and a value with a
 *   double quote, a carriage return, a line feed or a NUL is refused, before the route creates
 *   anything (invariant 14). The file is written through utils/env-file.ts envLine, the one writer
 *   of a .env line, and at mode 0600 (utils/private-file.ts).
 * @structure SetupNodeSettings · NODE_TYPES · parseSetupNodeSettings · setupSettingOutcomes ·
 *   setupMessage · buildSetupEnv
 * @usage
 *   const parsed = parseSetupNodeSettings(req.body);
 *   if (!parsed.ok) return refuse(parsed.problem);
 *   writePrivateFile(envPath, buildSetupEnv(parsed.settings, config, now));
 * @version-history
 *   v1.2.0 — 2026-10-25 — AIMEAT_LOCALE is no longer written: no code read it, so the language picked
 *     in setup looked like a node setting and did nothing. It stays on the operator's account.
 *   v1.1.0 — 2026-10-16 — setupSettingOutcomes and setupMessage: the setup answer says per setting
 *     (node id, node type, port, genesis URL) whether it is unchanged, written to .env for the next
 *     start, or not written, and the message says "complete" only when nothing was dropped or waits
 *     for a restart. The answer said "Node setup complete" while the settings were dropped (QA audit F1-03).
 *   v1.0.0 — 2026-10-09 — Initial: the checks and the writer moved out of routes/setup.ts (S1).
 */
import type { AimeatConfig } from '../config.js';
import { envLine, envValueProblem } from '../utils/env-file.js';

/** The node types the node starts as (config.ts refuses to boot on any other: the NodeType type). */
export const NODE_TYPES: readonly string[] = ['full', 'relay', 'mirror', 'personal'];
/** A node id as federation reads one (services/mcp-client/hops.ts NODE_ID_RE). */
const NODE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
/** A BCP 47 language tag: a language, then up to three subtags. */
const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;

export interface SetupNodeSettings {
  nodeId?: string;
  nodeType?: string;
  genesisUrl?: string;
  locale?: string;
  port?: number;
}

const given = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/**
 * The node settings of a setup request, or the first thing wrong with them. A setting left out
 * (absent, null or an empty string) is not set; one that is given must be a value the node takes.
 * `port` is kept as before: a whole number from 1 to 65535 is used, anything else is ignored.
 */
export function parseSetupNodeSettings(body: unknown): { ok: true; settings: SetupNodeSettings } | { ok: false; problem: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const settings: SetupNodeSettings = {};
  const text = (field: string): string | { problem: string } => {
    const v = b[field];
    if (typeof v !== 'string') return { problem: `${field} must be a string.` };
    const problem = envValueProblem(v);
    return problem ? { problem: `${field} cannot be used: ${problem}.` } : v;
  };

  if (given(b.nodeId)) {
    const v = text('nodeId');
    if (typeof v !== 'string') return { ok: false, problem: v.problem };
    if (!NODE_ID_RE.test(v)) return { ok: false, problem: 'nodeId: letters, digits, dots, dashes and underscores, starting with a letter or a digit, up to 100 characters.' };
    settings.nodeId = v;
  }
  if (given(b.nodeType)) {
    const v = text('nodeType');
    if (typeof v !== 'string') return { ok: false, problem: v.problem };
    if (!NODE_TYPES.includes(v)) return { ok: false, problem: `nodeType: one of ${NODE_TYPES.join(', ')}.` };
    settings.nodeType = v;
  }
  if (given(b.genesisUrl)) {
    const v = text('genesisUrl');
    if (typeof v !== 'string') return { ok: false, problem: v.problem };
    // Checked on the string as sent: URL parsing drops a tab or a line break before it looks.
    // eslint-disable-next-line no-control-regex
    const u = !/[\x00-\x20\x7f]/.test(v) && URL.canParse(v) ? new URL(v) : null;
    if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) {
      return { ok: false, problem: 'genesisUrl: the full http(s) address of the genesis node, with no credentials and no spaces in it.' };
    }
    settings.genesisUrl = v;
  }
  if (given(b.locale)) {
    const v = text('locale');
    if (typeof v !== 'string') return { ok: false, problem: v.problem };
    if (!LOCALE_RE.test(v)) return { ok: false, problem: 'locale: a language tag such as en, fi or es.' };
    settings.locale = v;
  }
  if (typeof b.port === 'number' && Number.isInteger(b.port) && b.port >= 1 && b.port <= 65535) settings.port = b.port;
  return { ok: true, settings };
}

/** One node setting the wizard sends, as the setup answer names it. */
export type SetupSettingName = 'node_id' | 'node_type' | 'port' | 'genesis_url';

/** What the setup route did with one node setting (openapi SetupSettingOutcome). */
export interface SetupSettingOutcome {
  setting: SetupSettingName;
  /** unchanged: equals the running value. written: in the new .env, used after a restart. not_written: dropped. */
  status: 'unchanged' | 'written' | 'not_written';
  requested: string | number | null;
  running: string | number | null;
  restart_required: boolean;
  reason?: string;
}

/** Whether the setup route wrote .env, and when it did not, why (a sentence a person reads). */
export type SetupEnvWrite = { written: true } | { written: false; reason: string };

/**
 * What happened to each node setting. The running node never takes any of them: a setting that
 * differs from the running value takes effect only through the .env file at the next start, so it
 * is `written` when the route wrote that file and `not_written` when it did not.
 */
export function setupSettingOutcomes(
  s: SetupNodeSettings,
  config: Pick<AimeatConfig, 'nodeId' | 'port' | 'nodeType' | 'genesisUrl'>,
  write: SetupEnvWrite,
): SetupSettingOutcome[] {
  const rows: Array<[SetupSettingName, string | number | undefined, string | number | null]> = [
    ['node_id', s.nodeId, config.nodeId],
    ['node_type', s.nodeType, config.nodeType],
    ['port', s.port, config.port],
    ['genesis_url', s.genesisUrl, config.genesisUrl ?? null],
  ];
  return rows.map(([setting, requested, running]) => {
    const base = { setting, requested: requested ?? null, running };
    if (requested === undefined || requested === running) {
      return { ...base, status: 'unchanged' as const, restart_required: false };
    }
    if (!write.written) {
      return { ...base, status: 'not_written' as const, restart_required: false, reason: write.reason };
    }
    return {
      ...base, status: 'written' as const, restart_required: true,
      ...(setting === 'node_id'
        ? { reason: `Your account was created on the node id the node runs as now (${String(running)}). After the restart the node runs as ${String(requested)}.` }
        : {}),
    };
  });
}

/** The answer's message: "complete" only when every setting already matched the running node. */
export function setupMessage(outcomes: SetupSettingOutcome[]): string {
  const label: Record<SetupSettingName, string> = { node_id: 'node id', node_type: 'node type', port: 'port', genesis_url: 'genesis URL' };
  const written = outcomes.filter(o => o.status === 'written').map(o => label[o.setting]);
  const dropped = outcomes.filter(o => o.status === 'not_written');
  const parts = ['Your account is ready and you are the operator of this node.'];
  if (written.length === 0 && dropped.length === 0) return 'Node setup complete. You are now the operator of this node.';
  if (written.length > 0) {
    parts.push(`These settings were saved to .env and take effect when you restart the node: ${written.join(', ')}. Until then the node keeps its current values.`);
  }
  if (dropped.length > 0) {
    parts.push(`These settings were NOT saved and the node keeps its current values: ${dropped.map(o => label[o.setting]).join(', ')}. ${dropped[0].reason ?? ''} To change them, edit the node's configuration and restart the node.`.trim());
  }
  return parts.join(' ');
}

/**
 * The .env the setup route writes: the node's identity, port and type, and the genesis URL. The
 * language the operator picked is theirs, and the route keeps it on their account; it is not written
 * here, because no code of the node reads AIMEAT_LOCALE.
 */
export function buildSetupEnv(s: SetupNodeSettings, config: Pick<AimeatConfig, 'nodeId' | 'port' | 'nodeType'>, createdAt: string): string {
  const lines: string[] = [
    '# AIMEAT Node Configuration (generated by setup wizard)',
    `# Created: ${createdAt}`,
    '',
    envLine('AIMEAT_NODE_ID', s.nodeId ?? config.nodeId),
    envLine('AIMEAT_PORT', s.port ?? config.port),
    envLine('AIMEAT_NODE_TYPE', s.nodeType ?? config.nodeType),
  ];
  if (s.genesisUrl) lines.push(envLine('AIMEAT_GENESIS_URL', s.genesisUrl));
  lines.push('');
  return lines.join('\n') + '\n';
}
