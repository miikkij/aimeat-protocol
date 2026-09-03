/**
 * @file mcp-tool-list-changed.test.ts
 * @description The tool-list-changed notification: the node declares the capability, and a scope
 *   change reaches the bus every open MCP session listens on. Without the declaration no client
 *   would ask again, and without the emit no client would be told — the two halves are useless
 *   apart, so both are asserted here.
 * @version-history
 *   v1.0.0 -- 2026-09-03 -- Initial, with tools.listChanged.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resourceEvents, emitToolListChanged } from '../../src/mcp/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', '..', 'src');

describe('tools/list_changed', () => {
    const added: Array<() => void> = [];
    afterEach(() => { added.splice(0).forEach(off => off()); });

    function listen(): { seen: Array<{ agentGaii: string }> } {
        const seen: Array<{ agentGaii: string }> = [];
        const handler = (evt: { agentGaii: string }) => { seen.push(evt); };
        resourceEvents.on('tool:listChanged', handler);
        added.push(() => resourceEvents.off('tool:listChanged', handler));
        return { seen };
    }

    it('reaches the bus with the agent it belongs to', () => {
        const { seen } = listen();
        emitToolListChanged('claude#alice@node-1');
        expect(seen).toEqual([{ agentGaii: 'claude#alice@node-1' }]);
    });

    it('is addressed, so one agent\'s change does not reach another\'s session', () => {
        const { seen } = listen();
        emitToolListChanged('claude#alice@node-1');
        emitToolListChanged('claude#bob@node-1');
        // core.ts filters on this field; if the payload lost it, every session would refetch on
        // every other agent's permission change.
        expect(seen.map(e => e.agentGaii)).toEqual(['claude#alice@node-1', 'claude#bob@node-1']);
    });

    it('the server declares tools.listChanged, or no client ever asks again', () => {
        const index = readFileSync(resolve(SRC, 'mcp', 'index.ts'), 'utf-8');
        expect(index).toMatch(/capabilities:\s*\{\s*tools:\s*\{\s*listChanged:\s*true\s*\}/);
    });

    it('every door that changes an agent\'s scopes emits it', () => {
        // The half-working failure this prevents: one door notifies, the other leaves the client
        // holding a list that no longer matches what the agent may do.
        const doors = [
            ['routes/agents/management.ts', 'the owner edits the scopes'],
            ['routes/agents/device-auth.ts', 're-approval'],
            ['services/agent-profile-write.ts', 'the shared profile write (operator configure)'],
            ['services/chat-agent.ts', 'the chat agent widening'],
        ] as const;
        for (const [file, what] of doors) {
            const src = readFileSync(resolve(SRC, file), 'utf-8');
            expect({ what, emits: src.includes('emitToolListChanged(') })
                .toEqual({ what, emits: true });
        }
    });
});
