/**
 * @file services/install-set-startup.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A new customer node applies its install set at start-up (install packages, phase 4,
 *   plan item 9). On a fresh node nobody can call POST /v1/install-sets/apply yet: there is no
 *   operator account and no agent. So the file named by AIMEAT_INSTALL_SET is applied as the node
 *   starts, after the federation peers are loaded, through the same applyInstallSet() the endpoint
 *   and the MCP tool call.
 *
 *   THE FILE MAY STAY. Applying again creates nothing twice, so a restart re-reads the file and
 *   finds nothing to do, except to deploy a crew agent whose runner has connected since.
 *
 *   THE NODE ALWAYS STARTS. A set that cannot be read or applied is logged with its reason and the
 *   node starts without it, the rule migrations follow (CLAUDE.md, Backend): an operator who
 *   installed a node runs no scripts, and a boot that fails on data helps nobody. A refusal that may
 *   pass later is tried again on a widening schedule, over about a day and a half.
 * @structure applyStartupInstallSet(deps)
 * @usage await applyStartupInstallSet({ storage, config, peers, scheduler });
 * @version-history
 *   v1.1.0 — 2026-09-30 — The install's warnings (a skill left out) are logged, one line each.
 *   v1.0.1 — 2026-09-28 — A secrets file that cannot be read or parsed is logged by its kind of
 *     problem only: a JSON parse error quotes the text around the fault, and in that file the text is
 *     a secret (CodeQL js/clear-text-logging, alert 1674).
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 4).
 */
import { readFile } from 'node:fs/promises';
import { logger } from '../utils/logger.js';
import { applyInstallSet, type ApplyDeps } from './install-set-apply.js';

/**
 * A JSON file, or what is wrong with it. `problem` names the kind and never carries the file's path or
 * content; `detail` is the error's own text, which for a parse error can quote the file, so the caller
 * logs it only for a file that holds no secrets.
 */
async function readJson(path: string): Promise<{ ok: true; value: unknown } | { ok: false; problem: string; detail: string }> {
    let raw: string;
    try { raw = await readFile(path, 'utf8'); } catch (err) { return { ok: false, problem: 'cannot be read', detail: String(err) }; }
    try { return { ok: true, value: JSON.parse(raw) }; } catch (err) { return { ok: false, problem: 'is not JSON', detail: String(err) }; }
}

/**
 * Refusals only a changed file fixes. Anything else (the repository does not serve this node yet, a
 * pull timed out, a config value an extension from the repository still needs) may pass later, so it
 * is tried again. A new node usually meets the first kind on its first start: the repository learns
 * the node's key only after the node exists, and grants it the bundle after that.
 */
const FINAL = new Set(['INVALID_INPUT', 'INVALID_BUNDLE', 'NOT_A_BUNDLE', 'EMAIL_TAKEN', 'PEER_KEY_MISMATCH', 'REGISTRATION_CLOSED']);

/** Minutes between tries after a refusal that may pass later; seconds on a test node. */
const RETRY_MS = [1, 5, 15, 60, 360, 1440].map(m => m * 60_000);
const TEST_RETRY_MS = [1000, 2000, 3000, 5000, 8000];

/**
 * Apply the start-up install set, when the config names one, and try again later after a refusal
 * that may pass. Never throws; every outcome is logged.
 */
export async function applyStartupInstallSet(deps: ApplyDeps, attempt = 0): Promise<void> {
    const { config } = deps;
    if (!config.installSetPath) return;
    const set = await readJson(config.installSetPath);
    if (!set.ok) { logger.error(`[install-set] not applied: ${config.installSetPath} ${set.problem}: ${set.detail}`); return; }
    let secrets: unknown;
    if (config.installSetSecretsPath) {
        const read = await readJson(config.installSetSecretsPath);
        if (!read.ok) {
            logger.error(`[install-set] not applied: the secrets file named by AIMEAT_INSTALL_SET_SECRETS ${read.problem}. The error text is not logged, because it can quote the file.`);
            return;
        }
        secrets = read.value;
    }
    let code: string;
    try {
        const out = await applyInstallSet(deps, { installSet: set.value, secrets, appliedBy: 'startup' });
        if (out.ok) {
            if (out.dry_run) return;
            const pending = Object.values(out.record.agents).filter(a => a.result === 'pending').length;
            logger.info(`[install-set] applied for ${out.record.owner} (run ${out.record.runs}): `
                + `${Object.keys(out.record.packages).length} package(s), ${Object.keys(out.record.organisms).length} organism(s), `
                + `${Object.keys(out.record.members).length} user(s)${pending ? `, ${pending} crew agent(s) waiting for a runner` : ''}`);
            // What the install left out (a skill the owner already has of their own) is said, not dropped.
            for (const w of out.warnings) logger.warn(`[install-set] ${w}`);
            return;
        }
        code = out.code;
        logger.error(`[install-set] not applied: ${out.code}: ${out.message}${out.problems ? ` ${out.problems.join(' | ')}` : ''}`);
    } catch (err) {
        code = 'APPLY_FAILED';
        logger.error('[install-set] not applied: the apply failed', { error: String(err) });
    }
    const delays = config.testMode ? TEST_RETRY_MS : RETRY_MS;
    if (FINAL.has(code) || attempt >= delays.length) return;
    logger.info(`[install-set] trying again in ${Math.round(delays[attempt] / 1000)} s`);
    setTimeout(() => { void applyStartupInstallSet(deps, attempt + 1); }, delays[attempt]).unref();
}
