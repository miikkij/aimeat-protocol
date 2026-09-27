/**
 * @file cli/connect/tool-call-helpers-organize.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one translation from aimeat_dm_organize_as_owner's flat parameters to the body of
 *   PUT /v1/messages/organize, shared by the connector MCP door and the CLI dispatch so the two cannot
 *   send different bodies for the same call. The node's own MCP tool builds the same shape and hands it
 *   to the service directly.
 * @structure organizePatchBody(params)
 * @usage const body = organizePatchBody({ auto_archive_days: 30 }); client.put('/v1/messages/organize', body)
 * @version-history
 *   v1.0.0 -- 2026-09-13 -- Initial, with the Messages list's sections, rules and archive.
 */

export interface OrganizeToolParams {
    auto_archive_enabled?: boolean;
    auto_archive_days?: number;
    fold_same_subject?: boolean;
    add_rule?: Record<string, unknown>;
    remove_rule?: string;
    rules?: unknown[];
}

/** Only what was given; an empty object means "read the current settings". */
export function organizePatchBody(p: OrganizeToolParams): Record<string, unknown> {
    const autoArchive = {
        ...(p.auto_archive_enabled !== undefined ? { enabled: p.auto_archive_enabled } : {}),
        ...(p.auto_archive_days !== undefined ? { days: p.auto_archive_days } : {}),
    };
    return {
        ...(Object.keys(autoArchive).length ? { auto_archive: autoArchive } : {}),
        ...(p.fold_same_subject !== undefined ? { fold_same_subject: p.fold_same_subject } : {}),
        ...(p.add_rule ? { add_rule: p.add_rule } : {}),
        ...(p.remove_rule ? { remove_rule: p.remove_rule } : {}),
        ...(p.rules ? { rules: p.rules } : {}),
    };
}
