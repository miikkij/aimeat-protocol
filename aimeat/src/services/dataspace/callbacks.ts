/**
 * @file src/services/dataspace/callbacks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The messages this node sends to a consumer's callback address (plan doc-mvwxcas3dom3,
 *   D8.3, D8.4): an Offer, an Agreement, the FINALIZED event and a Termination of a negotiation; a
 *   Start, Completion, Suspension and Termination of a transfer.
 *
 *   AFTER THE ANSWER. A callback is sent after the HTTP answer to the message that caused it
 *   (`later`), because the consumer learns the providerPid from that answer and matches the callback
 *   to it. A state moves only when the consumer acknowledged the callback with a 2xx (DSP: "a
 *   transition happens on an acknowledged message"); a failure is retried twice and then recorded on
 *   the process (`callbackError`) for the owner to read.
 *
 *   WHERE IT MAY GO. A callback address is an https URL, or an origin the operator listed in
 *   AIMEAT_DATASPACE_CALLBACK_ORIGINS (a lab, the TCK); every send goes through safeFetch, which
 *   refuses private addresses except those listed origins. To a DID participant the call carries this
 *   node's self-issued ID token for that DID (./identity.ts); to a static participant it carries none.
 * @structure callbackAllowed · sendCallback · later · CallbackOutcome
 * @usage later(() => sendCallback(config, rec, url, body));
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.3, D8.4).
 */
import type { AimeatConfig } from '../../config.js';
import { safeFetch } from '../../utils/url-validator.js';
import { readTextCapped } from '../../utils/read-capped.js';
import { logger } from '../../utils/logger.js';
import { signSelfIssuedToken } from './identity.js';
import { callbackOrigins } from './settings.js';

type Cfg = Pick<AimeatConfig, 'baseUrl'> & Partial<Pick<AimeatConfig, 'dataspaceParticipantId' | 'dataspaceCallbackOrigins'>>;

/** Is this a callback address this node will send to? */
export function callbackAllowed(config: Cfg, address: unknown): address is string {
    if (typeof address !== 'string' || !URL.canParse(address)) return false;
    const u = new URL(address);
    if (u.username || u.password) return false;
    return u.protocol === 'https:' || callbackOrigins(config).includes(u.origin);
}

export type CallbackOutcome = { ok: true } | { ok: false; error: string };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** POST one DSP message to a consumer, with two retries. */
export async function sendCallback(
    config: Cfg, to: { participantId: string; authMethod: 'dcp' | 'static' }, url: string, body: Record<string, unknown>,
): Promise<CallbackOutcome> {
    const allowOrigins = callbackOrigins(config);
    let last = '';
    for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await sleep(250 * 2 ** attempt);
        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (to.authMethod === 'dcp' && to.participantId.startsWith('did:')) headers.Authorization = `Bearer ${await signSelfIssuedToken(config, to.participantId)}`;
            const res = await safeFetch(url, {
                method: 'POST', headers, body: JSON.stringify(body), maxRedirects: 0,
                ...(allowOrigins.length ? { allowOrigins } : {}), signal: AbortSignal.timeout(15_000),
            });
            // The answer to a callback is read only to free the connection, and only its first 64 kB.
            await readTextCapped(res, 64 * 1024).catch(err => logger.debug('dataspace: a callback answer was not read', { error: String(err) }));
            if (res.status >= 200 && res.status < 300) return { ok: true };
            last = `${res.status}`;
            // A 4xx is the consumer's answer to this message: sending it again changes nothing.
            if (res.status >= 400 && res.status < 500) break;
        } catch (err) {
            last = (err as Error).message;
        }
    }
    logger.warn('dataspace: a callback did not reach the consumer', { url, type: body['@type'], error: last });
    return { ok: false, error: `${String(body['@type'])} to ${url}: ${last}` };
}

/** Run `fn` after the current answer is sent. Its failure is logged, never thrown. */
export function later(fn: () => Promise<unknown>, delayMs = 50): void {
    setTimeout(() => { fn().catch(err => logger.warn('dataspace: a follow-up step failed', { error: String(err) })); }, delayMs);
}
