/**
 * @file src/services/workspace-share-input.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The tool input of aimeat_workspace_share as the share body PUT
 *   /v1/organisms/:id/workspace/share takes. The node's MCP tool and the CLI dispatch both build their
 *   body here, so the two cannot name a target or an end date differently. Pure: no storage, no
 *   config, safe for the connector to import.
 * @structure shareBodyFromToolInput(input) → { body } | { error }
 * @usage
 *   const r = shareBodyFromToolInput({ space: 'docs', id: 'doc-1', shared: true, until: '2027-01-31' });
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial.
 */

export interface ShareToolInput {
    space?: unknown; id?: unknown; shared?: unknown; access?: unknown; password?: unknown; until?: unknown;
}

/** The share body for one target: a page (`space` + `id`), a space (`space`) or the workspace (neither). */
export function shareBodyFromToolInput(input: ShareToolInput): { body: Record<string, unknown> } | { error: string } {
    const space = typeof input.space === 'string' && input.space.trim() ? input.space.trim() : '';
    const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : '';
    if (id && !space) return { error: 'A page is named by its space and its id: pass `space` with `id`.' };
    if (typeof input.shared !== 'boolean') return { error: '`shared` is required: true shares it, false stops sharing it.' };
    const target = space && id ? `${space}/${id}` : space ? `space:${space}` : '*';
    const body: Record<string, unknown> = space && id
        ? { docs: { [`${space}/${id}`]: input.shared } }
        : space ? { spaces: { [space]: input.shared } } : { public: input.shared };
    if (input.access !== undefined) body.access = input.access;
    if (input.password !== undefined) body.password = input.password;
    if (input.until !== undefined && input.until !== null && input.until !== '') {
        body.until = { [target]: input.until === 'none' ? null : input.until };
    }
    return { body };
}
