/**
 * @file workspace-member-changes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The catalog definitions for a member's change to a workspace and the decision on a
 *   member's suggestion: aimeat_workspace_space_add, aimeat_workspace_sections_set and
 *   aimeat_workspace_suggestions. Kept out of organisms-workspaces-apps.ts, which is at the
 *   max-file-lines boundary, and spread back into it right after aimeat_workspace_update.
 * @structure workspaceMemberChangeTools — three definitions
 * @usage import { workspaceMemberChangeTools } from './workspace-member-changes.js';  // spread in place
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial (workspace actions for plain members).
 */

import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

export const workspaceMemberChangeTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_workspace_space_add',
        description: "Add a space to a workspace as any member who may change it: its creator, an organism admin, or a member holding the contributor role. A space is { name, namespace, mode }, with mode 'document' for pages or 'records' for a list (send its JSON Schema in `schemas`), or a ROW space { name, namespace, backing:'rows', indexOn:[…] }; defaults are filled. A space whose name or namespace already exists is skipped. What happens to it depends on who you are and on the workspace's rule (its `rules.member_changes`, readable in aimeat_workspace_read): the creator's and an admin's change is written at once; a member's is written at once when the rule is 'direct', and filed as a suggestion that the creator or an admin approves when it is 'suggest' (the default). The answer says which: status 'applied' (with `added`), 'pending_approval' (with the `suggestion`), or 'unchanged'. The space always lands in the workspace's own structure with your name on it, never in a copy of yours. For renaming or removing spaces, the creator uses aimeat_workspace_update.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            spaces: { type: 'array', required: true, description: "The space to add, { name, namespace, mode }, or an array of up to 20. The namespace is dotted letters, digits, '-' and '_', such as 'shared.notes'; 'meta', 'skills' and 'access' are the platform's own." },
            schemas: { type: 'object', description: 'Map of namespace → JSON Schema, only for records spaces added in this same call. A space that already exists keeps its schema.' },
        },
    },
    {
        name: 'aimeat_workspace_sections_set',
        description: "Set the section index of one document space: the tree of sections its pages are filed under, [{ id, name, parentId, documents:[docId], color? }], the same list the workspace page saves. Read the current one first (aimeat_workspace_read returns every document space's index as `sections`), change it and send the WHOLE list back. Filing a document into a section moves it out of the one that held it. Who may, and whether it lands at once, is the same as for aimeat_workspace_space_add: status 'applied', or 'pending_approval' with the `suggestion` when the workspace asks its members to suggest. A member's further changes to the same space join the suggestion already waiting. Taking a document that no longer exists out of the index is always written at once.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            space: { type: 'string', required: true, description: 'The document space, by name or namespace.' },
            sections: { type: 'array', required: true, description: "The WHOLE index: [{ id, name, parentId, documents, color? }]. An id is letters, digits, '-' or '_'; a parent must be another section in the list; color is red, orange, yellow, green, blue, purple or gray." },
        },
    },
    {
        name: 'aimeat_workspace_suggestions',
        description: "The changes members suggested to a workspace (a space to add, changes to a document space's sections) that wait for a decision, via `action`. 'list' = the suggestions you may see (those in workspaces you can read, and your own), each with `can_decide` for you; `status` picks pending (default), approved, declined, expired or all. 'decide' = approve or decline one: approving applies exactly the suggested change to the workspace as it is now, with the member's name on it and yours as the approver; declining leaves the workspace as it is. Either way the member is told, with your `note` if you give one. Decided by the workspace's creator or an organism admin, never by the member who made it; an agent decides for its owner when the owner is one of them. A suggestion that waits 30 days expires and changes nothing.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            action: { type: 'string', required: true, enum: ['list', 'decide'], description: "'list' | 'decide'." },
            ws: { type: 'string', description: "action='list': only this workspace. Omit for every workspace you can read." },
            status: { type: 'string', enum: ['pending', 'approved', 'declined', 'expired', 'all'], description: "action='list': which ones. Default 'pending'." },
            suggestion_id: { type: 'string', description: "action='decide': the suggestion's id, from action='list'." },
            decision: { type: 'string', enum: ['approve', 'decline'], description: "action='decide': 'approve' or 'decline'." },
            note: { type: 'string', description: "action='decide': an optional note the member reads." },
        },
    },
];
