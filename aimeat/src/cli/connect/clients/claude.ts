/**
 * @file claude.ts
 * @description Claude Code and Claude Desktop adapters. They are the two clients that do NOT take
 *   a plain remote entry with a token in it:
 *     - Claude Code has `headersHelper`, a command whose stdout becomes the request headers. That
 *       is strictly better than a static header: the token never enters ~/.claude.json and a
 *       re-authenticated agent is picked up without editing anything.
 *     - Claude Desktop's config file is stdio-only. A `url` field there is not merely ignored: the
 *       app drops the whole mcpServers block on startup. So Desktop is connected over the local
 *       connector (`aimeat connect serve`), which is a real stdio MCP server and needs no token in
 *       the file either.
 * @structure
 *   - claudeCodeAdapter — runs `claude mcp add-json` when the CLI is present, prints it when not.
 *   - claudeDesktopAdapter — merges a stdio entry into claude_desktop_config.json.
 * @usage Registered in clients/registry.ts as `claude-code` and `claude-desktop`.
 * @version-history
 *   v1.0.0 — 2026-08-02 — Initial creation: one-command client connect.
 */

import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ClientAdapter, ClientTarget, WriteResult } from './types.js';
import { backup, objectAt, readJsonFile, writeJsonFile } from './fs-merge.js';
import { writeHeadersHelper } from './launcher.js';

function claudeCodeConfigPath(): string {
    return join(homedir(), '.claude.json');
}

function claudeDesktopConfigPath(): string {
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
        return join(appData, 'Claude', 'claude_desktop_config.json');
    }
    if (process.platform === 'darwin') {
        return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    }
    const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
    return join(xdg, 'Claude', 'claude_desktop_config.json');
}

export const claudeCodeAdapter: ClientAdapter = {
    id: 'claude-code',
    label: 'Claude Code',
    transport: 'http',
    configPath: claudeCodeConfigPath,

    async apply(target: ClientTarget): Promise<WriteResult> {
        const helper = writeHeadersHelper(target);
        const entry = {
            type: 'http',
            url: target.mcpUrl,
            headersHelper: process.platform === 'win32'
                ? `powershell -NoProfile -File "${helper.ps1}"`
                : helper.sh,
        };
        const addJson = `claude mcp add-json ${target.serverName} '${JSON.stringify(entry)}' --scope user`;

        // ~/.claude.json holds far more than MCP servers, so let Claude Code write its own file
        // rather than hand-editing it here.
        const claude = spawnSync('claude', ['mcp', 'add-json', target.serverName, JSON.stringify(entry), '--scope', 'user'], {
            encoding: 'utf8', shell: process.platform === 'win32',
        });

        if (claude.status === 0) {
            return {
                written: [helper.ps1, helper.sh],
                backedUp: [],
                nextSteps: [
                    'Added to Claude Code at user scope. Verify with:  claude mcp list',
                    'The token stays out of the config: headersHelper reads it from the connector home at connect time.',
                ],
            };
        }

        return {
            written: [helper.ps1, helper.sh],
            backedUp: [],
            manual: `The \`claude\` CLI was not usable here (${claude.error?.message ?? `exit ${String(claude.status)}`}). Run this yourself:\n\n  ${addJson}`,
            nextSteps: ['Then verify with:  claude mcp list'],
        };
    },
};

export const claudeDesktopAdapter: ClientAdapter = {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    transport: 'stdio',
    configPath: claudeDesktopConfigPath,

    async apply(target: ClientTarget): Promise<WriteResult> {
        const file = claudeDesktopConfigPath();
        const config = readJsonFile(file);
        const bak = backup(file);

        // NOTE: no `url` key here, deliberately. Claude Desktop discards the whole mcpServers block
        // when it meets one. The connector is a genuine stdio MCP server and reads its own token.
        const args = ['connect', 'serve'];
        if (target.surface) args.push('--surface', target.surface);

        objectAt(config, 'mcpServers')[target.serverName] = process.platform === 'win32'
            ? { command: 'cmd', args: ['/c', 'aimeat', ...args], env: { AIMEAT_HOME: target.home } }
            : { command: 'aimeat', args, env: { AIMEAT_HOME: target.home } };

        writeJsonFile(file, config);

        return {
            written: [file],
            backedUp: bak ? [bak] : [],
            nextSteps: [
                'Restart Claude Desktop, then check Settings > Developer for the aimeat server.',
                'Desktop connects over the local connector (stdio), not the HTTP endpoint: its config file cannot carry a remote URL.',
                `That connector serves the agent stored in ${target.home}.`,
            ],
        };
    },
};
