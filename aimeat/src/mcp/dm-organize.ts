/**
 * @file dm-organize.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tools for organising the OWNER's Messages list from a chat: archive or restore
 *   conversations, and read or change the settings and rules that place them (auto-archive by age for
 *   the owner's own agents, one row for copies with the same subject, and the rules that fold, group
 *   or archive). Both on `messages:organize-as-owner`, outside every wildcard. The same service
 *   functions as GET/PUT /v1/messages/organize and POST /v1/messages/organize/archive, so the page,
 *   the chat and a fleet daemon change the list the same way.
 * @structure registerDmOrganizeTools(mcp, storage, config, getAgentGaii)
 * @usage import { registerDmOrganizeTools } from './dm-organize.js';
 * @version-history
 *   v1.0.0 -- 2026-09-13 -- Initial, with the Messages list's sections, rules and archive.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { ownerMailbox } from '../services/direct-message-delete.js';
import { CONVERSATION_ID, InboxOrganizePatchSchema, InboxRuleInputSchema } from '../models/inbox-organize-schemas.js';
import { archiveConversations, organizeView, readInboxOrganize, updateInboxOrganize } from '../services/inbox-organize/record.js';
import { logger } from '../utils/logger.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const refusal = (message: string, code: string) => ({ isError: true, ...text({ error: message, code }) });

export function registerDmOrganizeTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    /** The mailbox is the session agent's OWN owner's, derived here and never taken from arguments. */
    const mailbox = () => ownerMailbox({ owner: parseGaiiLoose(getAgentGaii()).owner }, config.nodeId);

    mcp.tool(
        'aimeat_dm_archive_as_owner',
        descriptionFor('aimeat_dm_archive_as_owner'),
        {
            conversation_ids: z.array(z.string().regex(CONVERSATION_ID)).min(1).max(500).describe('Conversation ids to archive or restore, from aimeat_dm_inbox_as_owner.'),
            restore: z.boolean().optional().describe('true brings the conversations back to the list instead of archiving them.'),
        },
        annotationsFor('aimeat_dm_archive_as_owner'),
        async ({ conversation_ids, restore }) => {
            const back = restore === true;
            const { changed, organize } = await archiveConversations(storage, mailbox(), conversation_ids, back);
            // An agent changed what a person is shown, and the list itself keeps no trace of who did.
            logger.info('messages organised as owner (delegated)', { actor: getAgentGaii(), owner: mailbox(), what: back ? 'restore' : 'archive', count: changed });
            return text({
                [back ? 'restored' : 'archived']: changed,
                conversation_ids: [...new Set(conversation_ids)],
                archived_count: Object.keys(organize.archived).length,
                note: back
                    ? 'Back in the list, and kept there: neither a rule nor the age limit archives these again on their own.'
                    : 'In the archive. A conversation comes back by itself when somebody other than the owner\'s own agents writes in it.',
            });
        },
    );

    mcp.tool(
        'aimeat_dm_organize_as_owner',
        descriptionFor('aimeat_dm_organize_as_owner'),
        {
            auto_archive_enabled: z.boolean().optional().describe("Archive the own agents' conversations by age."),
            auto_archive_days: z.number().int().min(1).max(365).optional().describe('Days without a message before that happens.'),
            fold_same_subject: z.boolean().optional().describe('One row for conversations one sender opened with the same subject within an hour.'),
            add_rule: InboxRuleInputSchema.optional().describe('Add a rule, or edit one by giving its id.'),
            remove_rule: z.string().regex(/^[a-z0-9-]{1,40}$/).optional().describe('Id of a rule to remove.'),
            rules: z.array(InboxRuleInputSchema).max(50).optional().describe('Replace every rule with this list.'),
        },
        annotationsFor('aimeat_dm_organize_as_owner'),
        async ({ auto_archive_enabled, auto_archive_days, fold_same_subject, add_rule, remove_rule, rules }) => {
            const patch = InboxOrganizePatchSchema.safeParse({
                ...(auto_archive_enabled !== undefined || auto_archive_days !== undefined
                    ? { auto_archive: { ...(auto_archive_enabled !== undefined ? { enabled: auto_archive_enabled } : {}), ...(auto_archive_days !== undefined ? { days: auto_archive_days } : {}) } }
                    : {}),
                ...(fold_same_subject !== undefined ? { fold_same_subject } : {}),
                ...(add_rule ? { add_rule } : {}),
                ...(remove_rule ? { remove_rule } : {}),
                ...(rules ? { rules } : {}),
            });
            if (!patch.success) return refusal(patch.error.issues.map(i => `${i.path.map(String).join('.')}: ${i.message}`).join('; '), 'INVALID_INPUT');
            if (Object.keys(patch.data).length === 0) {
                return text({ ...organizeView(await readInboxOrganize(storage, mailbox())), note: 'Nothing changed: these are the current settings and rules.' });
            }
            const result = await updateInboxOrganize(storage, mailbox(), patch.data);
            if (!result.ok) return refusal(result.message, result.code);
            logger.info('messages organised as owner (delegated)', { actor: getAgentGaii(), owner: mailbox(), what: 'settings', fields: Object.keys(patch.data) });
            return text({ ...organizeView(result.organize), note: 'Saved. The Messages list uses these the next time it loads.' });
        },
    );
}
