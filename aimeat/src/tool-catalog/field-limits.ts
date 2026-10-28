/**
 * @file src/tool-catalog/field-limits.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The length limit of a catalog field that gives only its coarse `type: 'string'` and
 *   no `zod` schema of its own: about 840 of the catalog's 1,230 string fields. The field's NAME
 *   says what it holds, so the name picks its class from models/input-limits.ts, and both MCP
 *   surfaces then refuse a longer value and publish the limit as `maxLength` in the tool's input
 *   schema, where a model reads it before it calls.
 *
 *   A whole document (an app's HTML, a base64 file, a Markdown page, a manifest) gets no number: the
 *   request body limit bounds it (models/input-limits.ts, documentText). Any other name that is not
 *   listed is free text, the widest class with a number. A field that needs a different limit says
 *   so with its own `zod` schema, which always wins over this table.
 * @structure coarseStringSchema(key) · limitClassFor(key)
 * @usage case 'string': return coarseStringSchema(key);
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (wish wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli).
 */
import type { z } from 'zod';
import { INPUT_LIMITS, boundedText, documentText } from '../models/input-limits.js';

type LimitClass = keyof typeof INPUT_LIMITS | 'document';

/** Field names that carry a whole document. */
const DOCUMENT = new Set([
    'content', 'html', 'markdown', 'readme', 'manifest', 'body', 'value', 'source', 'script', 'code',
    'screenshot', 'template', 'css', 'svg', 'yaml', 'json', 'payload', 'data',
]);

const EXACT: Record<string, LimitClass> = {
    id: 'id', key: 'key', storage_key: 'key', prompt_key: 'key', result_key: 'key', audio_key: 'key', ref: 'id', ws: 'id', owner: 'id', version: 'id', filename: 'id', app: 'id',
    prefix: 'id', namespace: 'id', space: 'id', section: 'id', principal: 'id', grantee: 'id',
    invitee: 'id', ghii: 'id', to: 'id', from: 'id', since: 'id', until: 'id', server: 'id', host: 'id',
    sha256: 'id', commit: 'id', status: 'id', type: 'id', kind: 'id',
    name: 'name', label: 'name', category: 'name', tag: 'name', display_name: 'name', agent_name: 'name',
    target_agent_name: 'name', provider: 'name', model: 'name', language: 'name', platform: 'name',
    title: 'title', subject: 'title',
    url: 'url', return_url: 'url', console_url: 'url', endpoint: 'url', link: 'url', webhook_url: 'url',
    email: 'email',
    description: 'description', summary: 'description', purpose: 'description', about: 'description', bio: 'description',
    q: 'line', search: 'line', query: 'line', reason: 'line', note: 'line', justification: 'line', status_message: 'line',
};

/** The class a coarse string field's name puts it in. */
export function limitClassFor(key: string): LimitClass {
    if (DOCUMENT.has(key) || key.endsWith('_base64')) return 'document';
    const exact = EXACT[key];
    if (exact) return exact;
    if (key.endsWith('_key')) return 'key';
    // A token (a JWT, a refresh token) is not listed: one with many scopes runs past any id or key length.
    if (key.endsWith('_id')) return 'id';
    if (key.endsWith('_url')) return 'url';
    if (key.endsWith('_name')) return 'name';
    return 'text';
}

/** A coarse string field's schema: bounded by its class, a document by the request body limit. */
export function coarseStringSchema(key: string): z.ZodString {
    const cls = limitClassFor(key);
    return cls === 'document' ? documentText() : boundedText(INPUT_LIMITS[cls]);
}
