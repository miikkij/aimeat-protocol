/**
 * @file cli/connect/workspace-section-filing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Filing a document under a section, and taking a deleted one out of the section index,
 *   from the connector: the one implementation its MCP tools (mcp/tools/workspaces.ts) and its CLI
 *   dispatch (tool-call-defs-organism.ts) share. Both go through the node's section door,
 *   PUT /v1/organisms/:id/workspace/sections/:space, which decides whether the change lands at once or
 *   waits for an approval under the workspace's rule, and writes it into the index that counts.
 *
 *   WHY. Both doors wrote the index with POST /v1/memory, which a plain member is refused since the
 *   workspace's meta namespace became its creator's and admins' (2026-09-24), and neither looked at
 *   the answer, so the filing vanished without a word. The door answers, and the tool says so.
 * @structure SectionsCache · fileThroughDoor() · unfileThroughDoor()
 * @usage
 *   const cache = sectionsFromRead(wsResp.data);
 *   const filing = await fileThroughDoor(client, { orgId, ws, space, doc, section }, cache);
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial (workspace actions for plain members).
 */
import type { AimeatClient } from './api-client.js';
import { applySectionOps, readStoredSections, type Section } from '../../services/workspace-sections.js';

/** Each document space's section index as the workspace read gave it, updated as filings land. */
export type SectionsCache = Record<string, unknown[]>;

/** The section indexes a workspace read (GET /v1/organisms/:id/workspace) carries as `sections`. */
export function sectionsFromRead(data: unknown): SectionsCache {
    const s = (data as { sections?: unknown } | undefined)?.sections;
    return s && typeof s === 'object' && !Array.isArray(s) ? { ...(s as SectionsCache) } : {};
}

/** How one filing ended, for the tool's answer. */
export interface FilingOutcome { status: string; suggestion_id?: string; code?: string; message?: string }

const door = (orgId: string, ws: string, space: string) =>
    `/v1/organisms/${encodeURIComponent(orgId)}/workspace/sections/${encodeURIComponent(space)}?ws=${encodeURIComponent(ws)}`;

async function send(client: AimeatClient, orgId: string, ws: string, space: string, sections: Section[], cache: SectionsCache): Promise<FilingOutcome> {
    const r = await client.put(door(orgId, ws, space), { sections });
    if (r.ok === false) return { status: 'refused', code: r.error?.code, message: r.error?.message };
    const data = (r.data ?? {}) as { status?: string; sections?: unknown[]; suggestion?: { id?: string } };
    if (data.status === 'applied' && Array.isArray(data.sections)) cache[space] = data.sections;
    return { status: data.status ?? 'applied', ...(data.suggestion?.id ? { suggestion_id: data.suggestion.id } : {}) };
}

/** File `doc` under the section named by id or name. A section that does not exist is a refusal. */
export async function fileThroughDoor(
    client: AimeatClient, args: { orgId: string; ws: string; space: string; doc: string; section: string }, cache: SectionsCache,
): Promise<FilingOutcome> {
    const current = readStoredSections({ sections: cache[args.space] ?? [] });
    const target = current.find(s => s.id === args.section) ?? current.find(s => s.name === args.section);
    if (!target) {
        return { status: 'refused', code: 'NOT_FOUND', message: `"${args.space}" has no section "${args.section}". Add it with aimeat_workspace_sections_set.` };
    }
    return send(client, args.orgId, args.ws, args.space, applySectionOps(current, [{ op: 'file', id: target.id, doc: args.doc }]), cache);
}

/** Take a deleted document out of every section that lists it. Nothing to do is not a call. */
export async function unfileThroughDoor(
    client: AimeatClient, args: { orgId: string; ws: string; space: string; doc: string }, cache: SectionsCache,
): Promise<FilingOutcome | null> {
    const current = readStoredSections({ sections: cache[args.space] ?? [] });
    const holders = current.filter(s => s.documents.includes(args.doc));
    if (!holders.length) return null;
    return send(client, args.orgId, args.ws, args.space, applySectionOps(current, holders.map(s => ({ op: 'unfile' as const, id: s.id, doc: args.doc }))), cache);
}
