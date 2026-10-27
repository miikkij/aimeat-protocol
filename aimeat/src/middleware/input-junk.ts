/**
 * @file src/middleware/input-junk.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Refuses a request that carries text no storage behind this node keeps as sent: a NUL
 *   character, or a lone UTF-16 surrogate, anywhere in the parsed body (values and keys, at any
 *   depth), in the query string, or as %00 in the path. One check for every route, before any
 *   handler runs, because most write routes check their body by hand or not at all.
 *
 *   WHY THESE TWO. PostgreSQL cannot store U+0000 in text or JSONB: a NUL in a workspace draft write
 *   ended in a 500 with half of a batch written (incident
 *   a-nul-byte-makes-the-workspace-draft-write-answer-500…, 2026-10-24). A lone surrogate is valid
 *   JSON (`"\ud800"`) but not a character; on the way to UTF-8 it becomes U+FFFD, so what was stored
 *   differs from what was sent, with no error. Neither is ever typed by a person.
 *
 *   WHAT IT DOES NOT DO. It sets no length limit and refuses no other control character: a memory
 *   value or a file may hold any text, and the schemas decide the limits per field
 *   (models/input-limits.ts). A raw body (a signed webhook) is a Buffer and is not read here.
 *
 *   The answer is the shared 400 VALIDATION_ERROR (models/validation-issues.ts) with the path of each
 *   bad field; on /v1/mcp it is a JSON-RPC error with the same details, because an MCP client reads
 *   nothing else.
 * @structure inputJunkGuard(nodeId) · findJunk(value, max)
 * @usage app.use(inputJunkGuard(config.nodeId));
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (wish wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli).
 */
import type { Request, Response, NextFunction } from 'express';
import { createT } from '../i18n.js';
import { TEXT_REASON, hasLoneSurrogate } from '../models/input-limits.js';
import { requestLocale, validationFailure, type ValidationDetail } from '../models/validation-issues.js';

interface Junk { path: string; reason: string }

function junkIn(s: string): string | undefined {
    if (s.includes('\u0000')) return TEXT_REASON.nulByte;
    if (hasLoneSurrogate(s)) return TEXT_REASON.invalidUnicode;
    return undefined;
}

/**
 * Every string value and key in `value` that holds junk, at most `max` of them. Iterative, so a body
 * nested deeper than the call stack is read and not answered with a 500.
 */
export function findJunk(value: unknown, max = 20): Junk[] {
    const found: Junk[] = [];
    const stack: Array<{ v: unknown; path: string }> = [{ v: value, path: '' }];
    while (stack.length > 0 && found.length < max) {
        const { v, path } = stack.pop()!;
        if (typeof v === 'string') {
            const reason = junkIn(v);
            if (reason) found.push({ path, reason });
        } else if (Array.isArray(v)) {
            for (let i = v.length - 1; i >= 0; i--) stack.push({ v: v[i], path: path ? `${path}.${i}` : String(i) });
        } else if (v !== null && typeof v === 'object' && !Buffer.isBuffer(v)) {
            for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
                const at = path ? `${path}.${k}` : k;
                const reason = junkIn(k);
                if (reason) found.push({ path: at, reason });
                stack.push({ v: child, path: at });
            }
        }
    }
    return found;
}

const KEY: Record<string, string> = {
    [TEXT_REASON.nulByte]: 'validation.nulByte',
    [TEXT_REASON.invalidUnicode]: 'validation.invalidUnicode',
};

export function inputJunkGuard(nodeId: string) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const found: Junk[] = [];
        // %00 in the path decodes to NUL in a route parameter, which then reaches storage as a key.
        if (/%00/i.test(req.path)) found.push({ path: '', reason: TEXT_REASON.nulByte });
        for (const j of findJunk(req.query)) found.push({ path: `query.${j.path}`, reason: j.reason });
        if (typeof req.body === 'string' || (req.body !== null && typeof req.body === 'object')) found.push(...findJunk(req.body));
        if (found.length === 0) { next(); return; }

        const locale = requestLocale(req);
        const t = createT(locale);
        const details: ValidationDetail[] = found.map(j => ({ path: j.path, code: j.reason, message: t(KEY[j.reason]) }));
        const envelope = validationFailure(nodeId, details, locale);
        const rpc = req.path.startsWith('/v1/mcp') && req.body && typeof req.body === 'object' && !Array.isArray(req.body)
            && (req.body as { jsonrpc?: unknown }).jsonrpc === '2.0';
        if (rpc) {
            const id = (req.body as { id?: unknown }).id ?? null;
            res.status(400).json({ jsonrpc: '2.0', id, error: { code: -32602, message: envelope.error?.message, data: { code: 'VALIDATION_ERROR', details } } });
            return;
        }
        res.status(400).json(envelope);
    };
}
