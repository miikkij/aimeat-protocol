/**
 * @file src/services/dataspace/status.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the operator reads about the Dataspace Protocol provider (plan doc-mvwxcas3dom3,
 *   D8): whether it is on, the node's participant id and DID document address, the verifiers in force,
 *   the trusted issuers of each data space, how many static tokens are set (never their values), the
 *   callback origins, the TCK mode (set, in force, or refused and why), and the last TCK run when one was
 *   recorded (PUT /v1/admin/dataspace/tck-result, kept under the TCK service owner as `dsp.tck-result`).
 *   GET /v1/admin/dataspace answers it; the Config page's "Data ulos" group renders it.
 * @structure dataspaceStatus · TCK_RESULT_KEY · recordTckResult · TckResult
 * @usage res.json(success(nodeId, await dataspaceStatus({ storage, config })));
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { DSP_PATH, DSP_VERSION } from './contract.js';
import { authMethods, callbackOrigins, nodeParticipantId, tckModeVerdict, trustedIssuers } from './settings.js';
import { tckOwnerGhii } from './tck.js';

export const TCK_RESULT_KEY = 'dsp.tck-result';

/** One recorded TCK run: when, which TCK, and pass or fail per test id with the reason of a failure. */
export interface TckResult {
    at: string;
    tck: string;
    passed: number;
    failed: number;
    tests: Array<{ id: string; result: 'pass' | 'fail' | 'skip'; reason?: string }>;
    note?: string;
}

/** Keep the operator's TCK result. Refuses a shape that is not one. */
export async function recordTckResult(storage: Storage, nodeId: string, body: Record<string, unknown>): Promise<{ ok: true; value: TckResult } | { ok: false; message: string }> {
    const tests = Array.isArray(body.tests) ? body.tests : null;
    if (!tests || tests.length > 500) return { ok: false, message: 'tests is a list of at most 500 { id, result: pass | fail | skip, reason? }.' };
    const clean = tests.map(t => t as Record<string, unknown>).filter(t => typeof t.id === 'string' && ['pass', 'fail', 'skip'].includes(String(t.result)))
        .map(t => ({ id: String(t.id).slice(0, 40), result: t.result as 'pass' | 'fail' | 'skip', ...(typeof t.reason === 'string' ? { reason: t.reason.slice(0, 500) } : {}) }));
    const value: TckResult = {
        at: new Date().toISOString(), tck: typeof body.tck === 'string' ? body.tck.slice(0, 120) : 'eclipsedataspacetck/dsp-tck',
        passed: clean.filter(t => t.result === 'pass').length, failed: clean.filter(t => t.result === 'fail').length, tests: clean,
        ...(typeof body.note === 'string' ? { note: body.note.slice(0, 2000) } : {}),
    };
    const now = value.at;
    await storage.setMemory({ key: TCK_RESULT_KEY, ownerGaii: tckOwnerGhii(nodeId), value, visibility: 'private', tags: ['dsp-tck'], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
    return { ok: true, value };
}

/** The operator's read of the DSP provider. */
export async function dataspaceStatus(deps: { storage: Storage; config: AimeatConfig }): Promise<Record<string, unknown>> {
    const { config } = deps;
    const base = config.baseUrl.replace(/\/+$/, '');
    const tck = tckModeVerdict(config);
    const tokens = (config.dataspaceStaticTokens ?? '').split(';').map(s => s.trim()).filter(s => s.indexOf('=') > 0);
    const last = (await deps.storage.getMemory(tckOwnerGhii(config.nodeId), TCK_RESULT_KEY))?.value as TckResult | undefined;
    return {
        enabled: config.dataspaceEnabled === true,
        protocol: { version: DSP_VERSION, base: `${base}${DSP_PATH}`, version_endpoint: `${base}/.well-known/dspace-version` },
        participant_id: nodeParticipantId(config),
        did_document: `${base}/.well-known/did.json`,
        auth: authMethods(config),
        trusted_issuers: [...trustedIssuers(config)].map(([dataspace, issuers]) => ({ dataspace, issuers })),
        static_participants: tokens.map(t => t.slice(0, t.indexOf('=')).trim()),
        callback_origins: callbackOrigins(config),
        tck_mode: { set: config.dataspaceTckMode === true, in_force: tck.on, ...(tck.refused ? { refused: tck.refused } : {}) },
        last_tck_result: last ?? null,
    };
}
