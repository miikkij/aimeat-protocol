/**
 * @file test/unit/agent-handbook-workspace-read.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent handbook and the aimeat_workspace_read tool tell a workspace read the way
 *   the tool answers it: the default is an index of titles with no bodies (`mode: "index"`), `ids`
 *   opens the bodies (`mode: "content"`), and the rows of a row space are read with
 *   aimeat_workspace_rows_read. An index read is not a read of the guide it lists.
 *
 *   WHY. An instruction review on 2026-11-08 found an agent that reported it had read a workspace's
 *   guide when it had seen only the index, and the handbook line it followed named neither the rows
 *   tool nor the rule that a title is not content.
 * @usage cd aimeat && pnpm exec vitest run test/unit/agent-handbook-workspace-read.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial (wish-agentti-saa-nykyiset-aimeat-ohjeet-ja-tekee-sovitun-ty-n-lop, item 2).
 */
import { describe, it, expect } from 'vitest';
import { AGENT_HANDBOOK } from '../../src/services/handbooks/agent.js';
import { descriptionFor } from '../../src/tool-catalog/shape.js';

/** The handbook's line on organism workspaces. */
const workspaceLine = AGENT_HANDBOOK.split('\n').find(l => l.startsWith('**Organism workspaces')) ?? '';

describe('the agent handbook says how a workspace is read', () => {
    it('has the workspaces line', () => {
        expect(workspaceLine).not.toBe('');
    });
    it('names the index, `ids` and the mode the answer carries', () => {
        expect(workspaceLine).toMatch(/index/);
        expect(workspaceLine).toMatch(/ids:\[/);
        expect(workspaceLine).toMatch(/mode: "index"/);
        expect(workspaceLine).toMatch(/mode: "content"/);
    });
    it('sends the rows of a row space to aimeat_workspace_rows_read', () => {
        expect(workspaceLine).toMatch(/aimeat_workspace_rows_read/);
    });
    it('says an index read is not a read of what it lists', () => {
        expect(workspaceLine).toMatch(/never report a document as read from its title/i);
    });
});

describe('the tool says where the rows are', () => {
    it('aimeat_workspace_read names aimeat_workspace_rows_read', () => {
        expect(descriptionFor('aimeat_workspace_read')).toMatch(/aimeat_workspace_rows_read/);
    });
});
