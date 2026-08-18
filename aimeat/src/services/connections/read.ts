/**
 * @file src/services/connections/read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading FROM a connected account, which is the direction this machinery never had.
 *
 *   Connections were built to publish: a person attaches an account and the node writes to it. Every
 *   piece of what that took -- the authorization round, the sealed credential, the refresh, the
 *   revocation -- is exactly what reading needs, and none of it needed rebuilding. What was missing
 *   was one service that goes the other way.
 *
 *   THIS IS THE ROAD IN FOR EVERYTHING WITH AN API. Mail, a spreadsheet, a calendar, a task list:
 *   the person's data lives behind somebody's OAuth, and the way it reaches their own node is a
 *   token this node already holds being spent on a request this node already knows how to make.
 *
 *   THE TOKEN NEVER LEAVES. An extension, an app or an agent asks for a NAMED resource and gets the
 *   answer; it never gets the credential. That is not politeness. A token handed to a sandbox is a
 *   token that can do everything the person authorised, forever, wherever it ends up, and the
 *   allowlist below is the difference between "read my mail" and "act as me at Google".
 *
 *   A PROVIDER DECLARES WHAT MAY BE READ, and nothing else can be. `resources` on the descriptor is
 *   an allowlist of names mapped to URLs this node will build itself. A caller supplies parameters,
 *   never a URL: the moment a caller can name the host, this becomes an open proxy standing behind
 *   somebody's Google account.
 * @structure ReadResult; readResource()
 * @usage const r = await readResource(ctx, connectionId, 'messages', { limit: 20 });
 * @version-history
 *   v1.0.0 -- 2026-08-17 -- Initial: the read direction on the existing connection machinery.
 */
import type { ConnectContext } from './oauth.js';
import { ensureFreshCredential } from './refresh.js';
import { findProvider } from './providers.js';
import { safeFetch } from '../../utils/url-validator.js';
import { logger } from '../../utils/logger.js';

/** How much one read may bring back. A mailbox is unbounded; a response is not. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** How long a provider gets to answer before the caller is told it did not. */
const TIMEOUT_MS = 20_000;

export type ReadResult =
  | { ok: true; resource: string; data: unknown; provider: string }
  | { ok: false; code: string; message: string; status?: number };

/**
 * Read one named resource from a connected account.
 *
 * Every failure is a returned value rather than a thrown error, for the same reason
 * ensureFreshCredential does it: each of these has to become something the person can act on, and
 * an exception at this depth surfaces as a 500 in whichever background job touched it first.
 */
export async function readResource(
    ctx: ConnectContext, connectionId: string, resourceName: string,
    params: Record<string, unknown> = {},
): Promise<ReadResult> {
    const fresh = await ensureFreshCredential(ctx, connectionId);
    if (!fresh.ok) {
        return { ok: false, code: fresh.code, message: reconnectAdvice(fresh.code, fresh.reason) };
    }
    const { credential, connection } = fresh;

    const provider = findProvider(ctx.providers, connection.provider);
    if (!provider) {
        return {
            ok: false, code: 'PROVIDER_GONE',
            message: `This node no longer offers ${connection.provider}, so nothing can be read from it. The connection can be removed.`,
        };
    }

    const resource = provider.resources?.[resourceName];
    if (!resource) {
        const offered = Object.keys(provider.resources ?? {});
        return {
            ok: false, code: 'NO_SUCH_RESOURCE',
            message: offered.length
                ? `${provider.label} cannot be asked for "${resourceName}". Ask for one of these instead: ${offered.join(', ')}.`
                : `${provider.label} is a publishing connection and there is nothing to read from it.`,
        };
    }

    // The scope check is here rather than at the call: a provider answering 403 tells the person
    // nothing they can act on, while "this connection was made without permission to read mail,
    // reconnect it and tick that box" names the fix.
    const granted = new Set(connection.scopes ?? []);
    const missing = (resource.requiresScopes ?? []).filter((s) => !granted.has(s));
    if (missing.length) {
        return {
            ok: false, code: 'MISSING_PERMISSION',
            message: `This connection to ${provider.label} was made without permission to read ${resource.label}. `
                + 'Connect it again and approve that, then this will work.',
        };
    }

    let url: string;
    try {
        url = resource.url(params, connection.instance ?? null);
    } catch (err) {
        return { ok: false, code: 'BAD_PARAMETERS', message: (err as Error).message };
    }

    try {
        const resp = await safeFetch(url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${credential.accessToken}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!resp.ok) {
            // The body is EVIDENCE for the log line below, never the answer, so a body that
            // cannot be read leaves the status to speak and is said as much.
            const detail = (await resp.text().catch((err) => `<body unreadable: ${String(err)}>`)).slice(0, 400);
            logger.warn(`[connections:read] ${provider.id}/${resourceName} answered ${resp.status}: ${detail}`);
            return {
                ok: false, status: resp.status,
                code: resp.status === 401 || resp.status === 403 ? 'REFUSED_BY_PROVIDER' : 'PROVIDER_ERROR',
                message: resp.status === 401 || resp.status === 403
                    ? `${provider.label} refused the request. The permission may have been withdrawn there; connect the account again.`
                    : `${provider.label} could not answer just now. Try again shortly.`,
            };
        }

        const body = await readCapped(resp);
        if (body === null) {
            return {
                ok: false, code: 'TOO_LARGE',
                message: `That is more than ${Math.round(MAX_RESPONSE_BYTES / 1024 / 1024)} MB of answer. Ask for a smaller window: fewer items, or a date range.`,
            };
        }
        return { ok: true, resource: resourceName, provider: provider.id, data: body };
    } catch (err) {
        const message = (err as Error).message;
        logger.warn(`[connections:read] ${provider.id}/${resourceName} failed: ${message}`);
        return {
            ok: false, code: 'UNREACHABLE',
            message: `${provider.label} could not be reached. Try again shortly.`,
        };
    }
}

/**
 * The body, or null when it is bigger than we said we would carry.
 *
 * Streamed rather than `resp.text()` then measured, because measuring afterwards means the whole
 * thing is already in this process's memory and the cap has done nothing.
 */
async function readCapped(resp: Response): Promise<unknown | null> {
    const reader = resp.body?.getReader();
    if (!reader) return null;

    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); return null; }
        chunks.push(value);
    }

    const text = Buffer.concat(chunks).toString('utf8');
    try { return JSON.parse(text); } catch { return text; }
}

/** A credential failure, said as the thing the person does about it. */
function reconnectAdvice(code: string, reason: string): string {
    switch (code) {
        case 'NOT_FOUND': return 'That connection is not here. It may have been removed.';
        case 'REVOKED': return 'This connection was switched off. Connect the account again to start reading from it.';
        case 'UNREADABLE': return 'The stored permission for this account cannot be read any more. Connect it again.';
        default: return `This connection cannot be used right now: ${reason}. Connecting the account again usually settles it.`;
    }
}
