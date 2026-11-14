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
 *   2026-11-13 — The file read is readStoredFileShownTo (services/datapackage/source-labels.ts), the read
 *     and ask GET /v1/memory/files/:key calls (structure programme 2026-11, unit 2b).
 *   2026-11-13 — The file list asks storedFilesShownTo, the function GET /v1/memory/files asks
 *     (structure programme 2026-11, unit 7).
 *   2026-11-08 — The file read goes through the one ask of a stored file's read (datapackage/source-labels.ts
 *     storedFileShownTo), as GET /v1/pub reads (secaudit2026nov08b round 15b).
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   v1.0.1 — 2026-10-05 — The file's workspace binding goes to fileTarget (secaudit 2026-10, DATA-4).
 *   v1.0.0 — 2026-09-29 — Moved from mcp/core.ts (max-file-lines), with the classification reader.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { presentMemory } from '../services/classification/present-memory.js';
import { readerForAgent } from '../services/classification/reader.js';
import { memoryTarget } from '../services/classification/labels.js';
import { readStoredFileShownTo, storedFilesShownTo } from '../services/datapackage/source-labels.js';

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
                // The ask GET /v1/memory/files makes (datapackage/source-labels.ts storedFilesShownTo).
                const files = await storedFilesShownTo({ storage, config }, readerForAgent({ storage, config }, agentGaii),
                    await storage.listStorageFiles(agentGaii));
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
            // The one ask of a stored file's read (datapackage/source-labels.ts): the file's own label, and
            // the labels a data package version keeps, which no file of an agent's namespace has.
            // The read and that ask are readStoredFileShownTo, which GET /v1/memory/files/:key calls too.
            const file = await readStoredFileShownTo({ storage, config }, readerForAgent({ storage, config }, agentGaii), agentGaii, key);
            if (!file) return { contents: [{ uri: uri.toString(), text: 'Not found' }] };
            return { contents: [{ uri: uri.toString(), blob: file.data.toString('base64'), mimeType: file.mimeType }] };
        },
    );
}
