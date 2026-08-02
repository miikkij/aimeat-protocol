/**
 * @file goose.ts
 * @description Goose adapter. Goose keeps one YAML config with an `extensions` map and speaks
 *   Streamable HTTP natively, and it expands `${VAR}` inside header values from the merged
 *   env/env_keys map — so the agent token stays in the environment and never in the file.
 * @structure
 *   - configPath() — per-platform config.yaml location.
 *   - apply() — merge one `extensions.<name>` entry, write the launcher, report next steps.
 * @usage Registered in clients/registry.ts as `goose`.
 * @version-history
 *   v1.0.0 — 2026-08-02 — Initial creation: one-command client connect.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ClientAdapter, ClientTarget, WriteResult } from './types.js';
import { backup, objectAt, readYamlFile, writeYamlFile } from './fs-merge.js';
import { writeLauncher } from './launcher.js';

function gooseConfigPath(): string {
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
        return join(appData, 'Block', 'goose', 'config', 'config.yaml');
    }
    // macOS and Linux both use the XDG-style path.
    const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
    return join(xdg, 'goose', 'config.yaml');
}

export const gooseAdapter: ClientAdapter = {
    id: 'goose',
    label: 'Goose',
    transport: 'http',
    configPath: gooseConfigPath,

    async apply(target: ClientTarget): Promise<WriteResult> {
        const file = gooseConfigPath();
        const config = readYamlFile(file);
        const bak = backup(file);

        const extensions = objectAt(config, 'extensions');
        extensions[target.serverName] = {
            type: 'streamable_http',
            name: target.serverName,
            description: `AIMEAT node tools from ${target.nodeUrl}`,
            uri: target.mcpUrl,
            headers: { Authorization: 'Bearer ${AIMEAT_AGENT_TOKEN}' },
            env_keys: ['AIMEAT_AGENT_TOKEN'],
            enabled: true,
            timeout: 600,
        };

        // Goose needs its own file/shell extension to write the apps it builds. Leave an existing
        // entry exactly as the user set it; only add it when it is absent.
        if (!extensions.developer) {
            extensions.developer = {
                type: 'builtin', name: 'developer', display_name: 'Developer',
                enabled: true, bundled: true, timeout: 300,
            };
        }

        writeYamlFile(file, config);
        const scripts = writeLauncher(target, 'goose', 'goose', ['session']);

        return {
            written: [file, ...scripts],
            backedUp: bak ? [bak] : [],
            nextSteps: [
                `Start it with:  ${scripts[0]}`,
                'Inside the session, /mode auto stops the per-tool confirmations and /model <id> switches model.',
                'Set OPENROUTER_API_KEY (or your provider key) in the environment before launching.',
            ],
        };
    },
};
