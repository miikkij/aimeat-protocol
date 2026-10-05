/**
 * @file src/mcp/core-resources.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two MCP resource templates for an agent's own content: its memory entries
 *   (`aimeat://memory/{key}`) and its storage files (`aimeat://storage/{key}`). Moved unchanged out
 *   of mcp/core.ts, which had reached the line ceiling. Both pass the classification reader
 *   (TARGET-082): a key or a file the agent may not see is neither listed nor read, and a memory
 *   value is shown through presentMemory (the credential mask included).
 * @structure registerCoreResources(mcp, storage, config, agentGaii)
 * @usage registerCoreResources(mcp, storage, config, agentGaii);  // from registerCoreTools
 * @version-history
 *   v1.0.1 — 2026-10-05 — The file's workspace binding goes to fileTarget (secaudit 2026-10, DATA-4).
 *   v1.0.0 — 2026-09-29 — Moved from mcp/core.ts (max-file-lines), with the classification reader.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { presentMemory } from '../services/classification/present-memory.js';
import { readerForAgent } from '../services/classification/reader.js';
import { memoryTarget, fileTarget } from '../services/classification/labels.js';

export function registerCoreResources(mcp: McpServer, storage: Storage, config: AimeatConfig, agentGaii: string): void {
    // Resource template: memory entries
    mcp.registerResource(
        'agent-memory',
        new ResourceTemplate('aimeat://memory/{key}', {
            list: async () => {
                const entries = await readerForAgent({ storage, config }, agentGaii)
                    .show(await storage.listMemory(agentGaii, {}), e => memoryTarget(e.ownerGaii, e.key));
                return {
                    resources: entries.map(e => ({
                        uri: `aimeat://memory/${encodeURIComponent(e.key)}`,
                        name: e.key,
                        mimeType: 'application/json',
                        description: `Memory entry: ${e.key}`,
                    })),
                };
            }
        }),
        { mimeType: 'application/json', description: 'Agent memory entries' },
        async (uri, variables) => {
            const key = decodeURIComponent(variables.key as string);
            // The one presentation of a memory value (classification reader + credential mask).
            const stored = await storage.getMemory(agentGaii, key);
            const record = stored ? await presentMemory(readerForAgent({ storage, config }, agentGaii), stored) : null;
            if (!record) return { contents: [{ uri: uri.toString(), text: 'Not found' }] };
            return { contents: [{ uri: uri.toString(), text: JSON.stringify(record.value), mimeType: 'application/json' }] };
        },
    );

    // Resource template: storage files
    mcp.registerResource(
        'agent-storage',
        new ResourceTemplate('aimeat://storage/{key}', {
            list: async () => {
                const files = await readerForAgent({ storage, config }, agentGaii)
                    .show(await storage.listStorageFiles(agentGaii), f => fileTarget(agentGaii, f.key, f.workspaceRef));
                return {
                    resources: files.map(f => ({
                        uri: `aimeat://storage/${encodeURIComponent(f.key)}`,
                        name: f.key,
                        mimeType: f.mimeType,
                        description: `Storage file: ${f.key} (${f.size} bytes)`,
                    })),
                };
            }
        }),
        { mimeType: 'application/octet-stream', description: 'Agent binary storage files' },
        async (uri, variables) => {
            const key = decodeURIComponent(variables.key as string);
            const stored = await storage.getStorageFile(agentGaii, key);
            const [file] = stored ? await readerForAgent({ storage, config }, agentGaii).show([stored], () => fileTarget(agentGaii, key, stored.workspaceRef)) : [];
            if (!file) return { contents: [{ uri: uri.toString(), text: 'Not found' }] };
            return { contents: [{ uri: uri.toString(), blob: file.data.toString('base64'), mimeType: file.mimeType }] };
        },
    );
}
