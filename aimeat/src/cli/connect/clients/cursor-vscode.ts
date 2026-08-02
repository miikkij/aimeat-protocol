/**
 * @file cursor-vscode.ts
 * @description Cursor and VS Code adapters. Both keep a JSON MCP config and both expand
 *   `${env:NAME}` inside header values, so the token stays in the environment. They differ in the
 *   top-level key (`mcpServers` vs `servers`), in whether `type` is required, and in where the file
 *   lives.
 * @structure
 *   - cursorAdapter — ~/.cursor/mcp.json, `mcpServers`.
 *   - vscodeAdapter — per-platform user mcp.json, `servers` with `type: http`.
 * @usage Registered in clients/registry.ts as `cursor` and `vscode`.
 * @version-history
 *   v1.0.0 — 2026-08-02 — Initial creation: one-command client connect.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ClientAdapter, ClientTarget, WriteResult } from './types.js';
import { backup, objectAt, readJsonFile, writeJsonFile } from './fs-merge.js';
import { writeLauncher } from './launcher.js';

/** Both clients read the token from the environment; this is the value they expand. */
const HEADER_VALUE = 'Bearer ${env:AIMEAT_AGENT_TOKEN}';

function cursorConfigPath(): string {
    return join(homedir(), '.cursor', 'mcp.json');
}

function vscodeConfigPath(): string {
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
        return join(appData, 'Code', 'User', 'mcp.json');
    }
    if (process.platform === 'darwin') {
        return join(homedir(), 'Library', 'Application Support', 'Code', 'User', 'mcp.json');
    }
    const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
    return join(xdg, 'Code', 'User', 'mcp.json');
}

export const cursorAdapter: ClientAdapter = {
    id: 'cursor',
    label: 'Cursor',
    transport: 'http',
    configPath: cursorConfigPath,

    async apply(target: ClientTarget): Promise<WriteResult> {
        const file = cursorConfigPath();
        const config = readJsonFile(file);
        const bak = backup(file);

        objectAt(config, 'mcpServers')[target.serverName] = {
            url: target.mcpUrl,
            headers: { Authorization: HEADER_VALUE },
        };

        writeJsonFile(file, config);
        const scripts = writeLauncher(target, 'cursor', 'cursor', ['.']);

        return {
            written: [file, ...scripts],
            backedUp: bak ? [bak] : [],
            nextSteps: [
                `Cursor must see AIMEAT_AGENT_TOKEN in its environment. Launch it with:  ${scripts[0]}`,
                'Or export the variable in your shell profile and start Cursor normally.',
                'Check it under Settings > MCP: the server should list its tools.',
            ],
        };
    },
};

export const vscodeAdapter: ClientAdapter = {
    id: 'vscode',
    label: 'VS Code',
    transport: 'http',
    configPath: vscodeConfigPath,

    async apply(target: ClientTarget): Promise<WriteResult> {
        const file = vscodeConfigPath();
        const config = readJsonFile(file);
        const bak = backup(file);

        objectAt(config, 'servers')[target.serverName] = {
            type: 'http',
            url: target.mcpUrl,
            headers: { Authorization: HEADER_VALUE },
        };

        writeJsonFile(file, config);
        const scripts = writeLauncher(target, 'vscode', 'code', ['.']);

        return {
            written: [file, ...scripts],
            backedUp: bak ? [bak] : [],
            nextSteps: [
                `VS Code must see AIMEAT_AGENT_TOKEN in its environment. Launch it with:  ${scripts[0]}`,
                'Then run "MCP: List Servers" from the command palette and start the aimeat server.',
                'If your build does not expand ${env:...} in headers, replace the header value with',
                '  "Bearer ${input:aimeat_token}" and add an inputs entry of type promptString.',
            ],
        };
    },
};
