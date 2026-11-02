/**
 * @file src/mcp/connection-files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tools for a connected SharePoint or OneDrive: aimeat_files_browse, aimeat_files_get
 *   and aimeat_files_write. They hold no logic of their own: each calls the service its REST twin
 *   calls (read.ts, drive-files.ts, write.ts), with the same holders decision (access.ts
 *   connectionHoldersOf), so a permission cannot answer differently on one door than on the other.
 * @structure registerConnectionFileTools(mcp, storage, config, getAgentGaii, scopes, caller)
 * @usage registerConnectionFileTools(mcp, storage, config, () => agentGaii, scopes, caller);
 * @version-history
 *   v1.1.0 — 2026-11-02 — aimeat_files_get as 'store' hands the session's caller to the storage write
 *     (secaudit2026nov02d round 13, drive-files.ts:storeDriveFile:company-page-key-unfenced-no-page-writer).
 *   v1.0.0 — 2026-11-02 — Initial (wish-sharepoint-liitin-tiedostot-luettaviksi-ja-kirjoitettaviksi-).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { buildOutboundProviders } from '../services/connections/providers.js';
import { requireEncryptionKey } from '../services/connections/credential.js';
import type { ConnectContext } from '../services/connections/oauth.js';
import { readResource } from '../services/connections/read.js';
import { driveFileText, storeDriveFile } from '../services/connections/drive-files.js';
import { writeResource, loadStoredBytes, type WritePayload } from '../services/connections/write.js';
import { connectionHoldersOf, requireUsableConnection, readAsOwnerRefusal } from '../services/connections/access.js';
import { readerFor } from '../services/classification/reader.js';
import { emitResourceUpdated, emitResourceListChanged } from './resource-events.js';

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export function registerConnectionFileTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    scopes: string[],
    caller: () => CallerContext,
): void {
    const ok = (obj: unknown): TextResult => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
    const providers = buildOutboundProviders(config);
    const principal = (): string => getAgentGaii();

    /** The context and the connection this session may use for `purpose`, or the refusal. */
    const open = async (connectionId: string, purpose: 'name' | 'read'): Promise<{ ctx: ConnectContext; id: string } | TextResult> => {
        if (!config.connectionsEnabled) {
            return toolError('CONNECTIONS_DISABLED', 'Connecting outside accounts is switched off on this node (AIMEAT_CONNECTIONS_ENABLED). Whoever runs it can turn it on.');
        }
        const key = requireEncryptionKey(config);
        if (!key) return toolError('NO_ENCRYPTION_KEY', 'This node is not set up to keep secrets safely yet, so it cannot open a connected account.');
        const holders = connectionHoldersOf(principal(), ownerGhiiOf(principal()), scopes, purpose);
        const conn = await requireUsableConnection(storage, holders, connectionId);
        if (!conn) {
            // The decision the REST read route asks too: the owner's account names the missing word.
            const refusal = purpose === 'read'
                ? await readAsOwnerRefusal(storage, principal(), ownerGhiiOf(principal()), scopes, connectionId)
                : null;
            if (refusal) return toolError(refusal.code, refusal.message);
            return toolError('NOT_FOUND', 'No such connection of yours. aimeat_connection_list shows them.');
        }
        return { ctx: { config, storage, providers, key }, id: conn.id };
    };

    mcp.registerTool('aimeat_files_browse', { description: descriptionFor('aimeat_files_browse'),
        inputSchema: zodShapeFor('aimeat_files_browse'),
        annotations: annotationsFor('aimeat_files_browse') },
        async ({ connection_id, what, ...rest }): Promise<TextResult> => {
            const opened = await open(connection_id, 'read');
            if ('content' in opened) return opened;
            const out = await readResource(opened.ctx, opened.id, what, rest as Record<string, unknown>);
            if (!out.ok) return toolError(out.code, out.message);
            return ok({ provider: out.provider, what: out.resource, data: out.data });
        });

    mcp.registerTool('aimeat_files_get', { description: descriptionFor('aimeat_files_get'),
        inputSchema: zodShapeFor('aimeat_files_get'),
        annotations: annotationsFor('aimeat_files_get') },
        async ({ connection_id, drive_id, item_id, as, key }): Promise<TextResult> => {
            if (as === 'store' && !scopeIsCovered(scopes, 'storage:write')) {
                return toolError('SCOPE_DENIED', 'Keeping a file writes it to the person\'s storage, which needs the storage:write permission. Read it as text instead, or ask for that permission.');
            }
            const opened = await open(connection_id, 'read');
            if ('content' in opened) return opened;
            if (as === 'store') {
                // The session's caller goes with the write, as aimeat_storage_upload hands it (secaudit2026nov02d round 13).
                const out = await storeDriveFile(opened.ctx, { storage, config, emitResourceUpdated, emitResourceListChanged },
                    principal(), opened.id, { drive_id, item_id, key }, { caller: caller() });
                if (!out.ok) return toolError(out.code, out.message);
                return ok({ stored: { key: out.key }, source: out.source });
            }
            const out = await driveFileText(opened.ctx, opened.id, { drive_id, item_id });
            if (!out.ok) return toolError(out.code, out.message);
            return ok({ text: out.text, ...(out.note ? { note: out.note } : {}), source: out.source });
        });

    mcp.registerTool('aimeat_files_write', { description: descriptionFor('aimeat_files_write'),
        inputSchema: zodShapeFor('aimeat_files_write'),
        annotations: annotationsFor('aimeat_files_write') },
        async ({ connection_id, what, from_key, text, mime_type, ...rest }): Promise<TextResult> => {
            const opened = await open(connection_id, 'name');
            if ('content' in opened) return opened;
            const params: Record<string, unknown> = { ...rest };
            let payload: WritePayload | undefined;
            if (from_key) {
                const loaded = await loadStoredBytes(opened.ctx, principal(), from_key, opened.id, readerFor({ storage, config }, caller().auth));
                if (!loaded.ok) return toolError(loaded.code, loaded.message);
                payload = loaded.payload;
                if (!params.filename) params.filename = loaded.name;
            } else if (typeof text === 'string') {
                payload = { bytes: Buffer.from(text, 'utf8'), mimeType: mime_type || 'text/plain; charset=utf-8' };
            }
            const out = await writeResource(opened.ctx, opened.id, what, params, payload);
            if (!out.ok) return toolError(out.code, out.message);
            return ok({ provider: out.provider, what: out.resource, data: out.data });
        });
}
