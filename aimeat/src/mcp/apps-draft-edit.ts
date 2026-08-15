/**
 * @file apps-draft-edit.ts
 * @description The four MCP tools that let an agent build and iterate on an app the way it would on
 *   a filesystem: write a piece at a time, replace an exact passage, read a line range, and copy a
 *   published version back into the draft slot.
 *
 *   They exist because a real app here is 400 kB and larger, no model emits that in one response, and
 *   a server-side agent has no disk and deliberately no shell. Without them the only way to author a
 *   large app through MCP is to hold the whole file in context on every iteration, and the only way
 *   to change an app published last week is to have kept a copy: aimeat_app_get returns the manifest
 *   and never the source.
 *
 *   Registered separately from apps.ts because that file is already near the 800-line ceiling. The
 *   work itself lives in services/app-draft-edit.ts, which every write funnels through
 *   stageAppDraft() — the same function the HTTP draft route and aimeat_app_draft_save call.
 * @structure
 *   - registerAppDraftEditTools() — registers the four tools on an McpServer instance
 * @usage
 *   import { registerAppDraftEditTools } from './apps-draft-edit.js';
 *   registerAppDraftEditTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial implementation.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { resolveAppOwnerScope } from '../services/app-lifecycle.js';
import {
    writeAppDraft, replaceInAppDraft, readAppDraft, seedAppDraft,
    DRAFT_READ_DEFAULT_LINES, DRAFT_READ_MAX_LINES,
} from '../services/app-draft-edit.js';

/** MCP has one error channel, plain text, so the refusal code travels in the sentence. */
function refusalMessage(refusal: { status: number; code: string; message: string }): string {
    return `${refusal.code}: ${refusal.message}`;
}

function ok(payload: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(text: string) {
    return { content: [{ type: 'text' as const, text }], isError: true };
}

export function registerAppDraftEditTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    // ── Tool: aimeat_app_draft_write ──
    mcp.tool(
        'aimeat_app_draft_write',
        descriptionFor('aimeat_app_draft_write'),
        {
            filename: z.string().describe('App filename this draft stages (e.g. "pong.html").'),
            content: z.string().describe('The text to write. Plain UTF-8, not base64.'),
            mode: z.enum(['append', 'replace']).optional()
                .describe('append (default) adds to the end; replace overwrites the whole draft.'),
            expected_size_bytes: z.number().int().nonnegative().optional()
                .describe('Refuse unless the draft is currently this many bytes.'),
            name: z.string().optional().describe('Display name (defaults to the live app\'s, or the draft\'s once set).'),
            description: z.string().optional().describe('Description (defaults to the live app\'s, or the draft\'s once set).'),
        },
        annotationsFor('aimeat_app_draft_write'),
        async ({ filename, content, mode, expected_size_bytes, name, description }) => {
            const agentGaii = getAgentGaii();
            const scope = await resolveAppOwnerScope(storage, config, agentGaii);
            if (!scope) return fail('Failed to parse agent GAII');
            try {
                const out = await writeAppDraft(storage, config, {
                    ownerName: scope.ownerName,
                    ownerGhii: scope.ownerGhii,
                    filename,
                    content,
                    mode,
                    expectedSizeBytes: expected_size_bytes,
                    requested: { name, description },
                });
                if ('refusal' in out) return fail(refusalMessage(out.refusal));
                logger.info(`App draft written via MCP: ${filename}`, { by: agentGaii, mode: mode ?? 'append' });
                return ok({
                    filename,
                    mode: mode ?? 'append',
                    size_bytes: out.size,
                    has_live_version: out.hasLiveVersion,
                    live_version_number: out.liveVersionNumber,
                    note: 'The LIVE app is unchanged. Keep appending until the file is complete, then '
                        + 'aimeat_app_draft_publish. Pass this size_bytes back as expected_size_bytes on '
                        + 'the next append if you want the write refused should anything else touch the draft.',
                });
            } catch (err) {
                return fail(`Failed to write draft: ${(err as Error).message}`);
            }
        },
    );

    // ── Tool: aimeat_app_draft_replace ──
    mcp.tool(
        'aimeat_app_draft_replace',
        descriptionFor('aimeat_app_draft_replace'),
        {
            filename: z.string().describe('App filename whose draft to edit.'),
            old_string: z.string().describe('The exact text to replace, including indentation.'),
            new_string: z.string().describe('What to put there instead.'),
            replace_all: z.boolean().optional()
                .describe('Replace every occurrence instead of requiring exactly one. Default false.'),
        },
        annotationsFor('aimeat_app_draft_replace'),
        async ({ filename, old_string, new_string, replace_all }) => {
            const agentGaii = getAgentGaii();
            const scope = await resolveAppOwnerScope(storage, config, agentGaii);
            if (!scope) return fail('Failed to parse agent GAII');
            try {
                const out = await replaceInAppDraft(storage, config, {
                    ownerName: scope.ownerName,
                    ownerGhii: scope.ownerGhii,
                    filename,
                    oldString: old_string,
                    newString: new_string,
                    replaceAll: replace_all,
                });
                if ('refusal' in out) return fail(refusalMessage(out.refusal));
                logger.info(`App draft edited via MCP: ${filename}`, { by: agentGaii, replacements: out.replacements });
                return ok({
                    filename,
                    replacements: out.replacements,
                    size_bytes: out.size,
                    note: 'The LIVE app is unchanged until aimeat_app_draft_publish.',
                });
            } catch (err) {
                return fail(`Failed to edit draft: ${(err as Error).message}`);
            }
        },
    );

    // ── Tool: aimeat_app_draft_read ──
    mcp.tool(
        'aimeat_app_draft_read',
        descriptionFor('aimeat_app_draft_read'),
        {
            filename: z.string().describe('App filename whose draft to read.'),
            offset: z.number().int().min(1).optional().describe('First line to return, 1-based. Default 1.'),
            limit: z.number().int().min(1).optional()
                .describe(`How many lines to return. Default ${DRAFT_READ_DEFAULT_LINES}, maximum ${DRAFT_READ_MAX_LINES}.`),
        },
        annotationsFor('aimeat_app_draft_read'),
        async ({ filename, offset, limit }) => {
            const agentGaii = getAgentGaii();
            const scope = await resolveAppOwnerScope(storage, config, agentGaii);
            if (!scope) return fail('Failed to parse agent GAII');
            try {
                const out = await readAppDraft(storage, {
                    ownerName: scope.ownerName,
                    ownerGhii: scope.ownerGhii,
                    filename, offset, limit,
                });
                if ('refusal' in out) return fail(refusalMessage(out.refusal));
                return ok({
                    filename: out.filename,
                    size_bytes: out.sizeBytes,
                    total_lines: out.totalLines,
                    from_line: out.fromLine,
                    to_line: out.toLine,
                    has_more: out.hasMore,
                    updated_at: out.updatedAt,
                    content: out.content,
                });
            } catch (err) {
                return fail(`Failed to read draft: ${(err as Error).message}`);
            }
        },
    );

    // ── Tool: aimeat_app_draft_seed ──
    mcp.tool(
        'aimeat_app_draft_seed',
        descriptionFor('aimeat_app_draft_seed'),
        {
            filename: z.string().describe('The draft slot to write into.'),
            from_filename: z.string().optional().describe('The published app to copy from. Defaults to filename.'),
            version: z.number().int().min(1).optional().describe('Which published version. Defaults to the newest.'),
        },
        annotationsFor('aimeat_app_draft_seed'),
        async ({ filename, from_filename, version }) => {
            const agentGaii = getAgentGaii();
            const scope = await resolveAppOwnerScope(storage, config, agentGaii);
            if (!scope) return fail('Failed to parse agent GAII');
            try {
                const out = await seedAppDraft(storage, config, {
                    ownerName: scope.ownerName,
                    ownerGhii: scope.ownerGhii,
                    filename, fromFilename: from_filename, version,
                });
                if ('refusal' in out) return fail(refusalMessage(out.refusal));
                logger.info(`App draft seeded via MCP: ${filename}`, { by: agentGaii, from: out.seededFrom });
                return ok({
                    filename,
                    seeded_from: out.seededFrom,
                    seeded_version: out.seededVersion,
                    size_bytes: out.size,
                    note: 'The published app is now in the draft slot. Read the part you want to change '
                        + 'with aimeat_app_draft_read, change it with aimeat_app_draft_replace, then '
                        + 'aimeat_app_draft_publish. The LIVE app is unchanged until you do.',
                });
            } catch (err) {
                return fail(`Failed to seed draft: ${(err as Error).message}`);
            }
        },
    );
}
