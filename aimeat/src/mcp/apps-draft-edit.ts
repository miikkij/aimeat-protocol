/**
 * @file apps-draft-edit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-18 — aimeat_app_draft_write and aimeat_app_draft_seed take `notice`: what the draft changes.
 *   2026-10-16 — A catch-all failure carries the caught error (withCaughtError, mcp/tool-fault.ts): an internal exception is logged, reported and answered with a sentence instead of its text (QA audit E5-01, D2-01).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.1.0 — 2026-09-13 — The write, replace and seed results render `served_marks_removed` /
 *     `served_marks_note` from whatever the draft slot reports, through the servedMarksResponse every
 *     app door uses. The promotion (aimeat_app_draft_publish) strips the node's serve marks either way.
 *   v1.0.0 — 2026-08-16 — Initial implementation.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withCaughtError } from './tool-fault.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { resolveAppTargetScope } from '../services/app-lifecycle.js';
import { writeAppDraft, replaceInAppDraft, readAppDraft, seedAppDraft } from '../services/app-draft-edit.js';
import { draftNoticeFrom } from '../services/app-news.js';
import { servedMarksResponse } from '../services/app-serve-marks-strip.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

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
    mcp.registerTool(
        'aimeat_app_draft_write',
        {
            description: descriptionFor('aimeat_app_draft_write'),
            inputSchema: zodShapeFor('aimeat_app_draft_write'),
            annotations: annotationsFor('aimeat_app_draft_write'),
        },
        async ({ filename, owner, content, mode, expected_size_bytes, name, description, notice }) => {
            const agentGaii = getAgentGaii();
            const draftNotice = draftNoticeFrom(notice, agentGaii);
            if (draftNotice && 'refusal' in draftNotice) return fail(`INVALID_INPUT: ${draftNotice.refusal}`);
            const scope = await resolveAppTargetScope(storage, config,
                { principal: agentGaii, owner, filename, act: 'draft' });
            if (!scope) return fail('Failed to parse agent GAII');
            if ('refusal' in scope) return fail(scope.refusal);
            try {
                const out = await writeAppDraft(storage, config, {
                    ownerName: scope.ownerName,
                    ownerGhii: scope.ownerGhii,
                    filename,
                    content,
                    mode,
                    expectedSizeBytes: expected_size_bytes,
                    requested: { name, description, draftNotice },
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
                    ...servedMarksResponse(out),
                });
            } catch (err) {
                return withCaughtError(fail(`Failed to write draft: ${(err as Error).message}`), err);
            }
        },
    );

    // ── Tool: aimeat_app_draft_replace ──
    mcp.registerTool(
        'aimeat_app_draft_replace',
        {
            description: descriptionFor('aimeat_app_draft_replace'),
            inputSchema: zodShapeFor('aimeat_app_draft_replace'),
            annotations: annotationsFor('aimeat_app_draft_replace'),
        },
        async ({ filename, owner, old_string, new_string, replace_all }) => {
            const agentGaii = getAgentGaii();
            const scope = await resolveAppTargetScope(storage, config,
                { principal: agentGaii, owner, filename, act: 'draft' });
            if (!scope) return fail('Failed to parse agent GAII');
            if ('refusal' in scope) return fail(scope.refusal);
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
                    ...servedMarksResponse(out),
                });
            } catch (err) {
                return withCaughtError(fail(`Failed to edit draft: ${(err as Error).message}`), err);
            }
        },
    );

    // ── Tool: aimeat_app_draft_read ──
    mcp.registerTool(
        'aimeat_app_draft_read',
        {
            description: descriptionFor('aimeat_app_draft_read'),
            inputSchema: zodShapeFor('aimeat_app_draft_read'),
            annotations: annotationsFor('aimeat_app_draft_read'),
        },
        async ({ filename, owner, offset, limit }) => {
            const agentGaii = getAgentGaii();
            const scope = await resolveAppTargetScope(storage, config,
                { principal: agentGaii, owner, filename, act: 'draft' });
            if (!scope) return fail('Failed to parse agent GAII');
            if ('refusal' in scope) return fail(scope.refusal);
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
                return withCaughtError(fail(`Failed to read draft: ${(err as Error).message}`), err);
            }
        },
    );

    // ── Tool: aimeat_app_draft_seed ──
    mcp.registerTool(
        'aimeat_app_draft_seed',
        {
            description: descriptionFor('aimeat_app_draft_seed'),
            inputSchema: zodShapeFor('aimeat_app_draft_seed'),
            annotations: annotationsFor('aimeat_app_draft_seed'),
        },
        async ({ filename, owner, from_filename, version, notice }) => {
            const agentGaii = getAgentGaii();
            const draftNotice = draftNoticeFrom(notice, agentGaii);
            if (draftNotice && 'refusal' in draftNotice) return fail(`INVALID_INPUT: ${draftNotice.refusal}`);
            const scope = await resolveAppTargetScope(storage, config,
                { principal: agentGaii, owner, filename, act: 'draft' });
            if (!scope) return fail('Failed to parse agent GAII');
            if ('refusal' in scope) return fail(scope.refusal);
            try {
                const out = await seedAppDraft(storage, config, {
                    callerGaii: agentGaii,
                    ownerName: scope.ownerName,
                    ownerGhii: scope.ownerGhii,
                    filename, fromFilename: from_filename, version, draftNotice,
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
                    ...servedMarksResponse(out),
                });
            } catch (err) {
                return withCaughtError(fail(`Failed to seed draft: ${(err as Error).message}`), err);
            }
        },
    );
}
