/**
 * @file index.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `aimeat connect client <id>` — one command that points a chat client at this node:
 *   it authorizes a dedicated agent into its own connector home, writes the client's MCP config,
 *   and leaves a launcher that supplies the token at run time. The point is that talking to AIMEAT
 *   from a client of your choice should be one command, not a page of manual steps.
 * @structure
 *   - CLIENTS — the adapter registry (goose, claude-code, cursor, vscode, claude-desktop).
 *   - runConnectClient() — resolve client, ensure credential, apply adapter, report.
 *   - resolveTarget() — flags + defaults into a ClientTarget (home, workdir, server name, surface).
 * @usage Dispatched from src/index-connect.ts on `aimeat connect client <id> [flags]`.
 * @version-history
 *   2026-10-15 — The summary prints the tool surface the adapter applied (surfaceLines), not the
 *     flag, and notes a `--surface` that this client does not take (feature-list audit #6).
 *   v1.0.0 — 2026-08-02 — Initial creation: one-command client connect.
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ClientAdapter, ClientTarget, WriteResult } from './types.js';
import { gooseAdapter } from './goose.js';
import { cursorAdapter, vscodeAdapter } from './cursor-vscode.js';
import { claudeCodeAdapter, claudeDesktopAdapter } from './claude.js';

export const CLIENTS: ClientAdapter[] = [
    gooseAdapter, claudeCodeAdapter, cursorAdapter, vscodeAdapter, claudeDesktopAdapter,
];

const DEFAULT_NODE_URL = 'https://aimeat.io';
const SURFACES = ['appdev', 'agent', 'service', 'admin'] as const;

/** Strip a trailing slash so `${nodeUrl}/v1/mcp` never doubles it. */
function normalizeUrl(url: string): string {
    return url.replace(/\/+$/, '');
}

/**
 * Each client gets its OWN connector home holding exactly one agent. Two reasons, both learned the
 * hard way: a home with two credentials makes every tool call demand an `agent_name`, and sharing a
 * home with an existing fleet means one client's re-auth can disturb agents it knows nothing about.
 */
function defaultHome(clientId: string): string {
    return join(homedir(), `.aimeat-${clientId}`);
}

/** The agent writes files where it is launched, so give it somewhere that is not a source repo. */
function defaultWorkdir(): string {
    return join(homedir(), 'aimeat-work');
}

function tokenFileIn(home: string): string | null {
    const dir = join(home, 'tokens');
    if (!existsSync(dir)) return null;
    const file = readdirSync(dir).find((n) => n.endsWith('.token'));
    return file ? join(dir, file) : null;
}

function resolveTarget(client: ClientAdapter, flags: Record<string, string>): ClientTarget {
    const nodeUrl = normalizeUrl(flags.url ?? DEFAULT_NODE_URL);
    const home = flags.home ?? defaultHome(client.id);
    const agent = flags.agent ?? client.id;
    const surface = SURFACES.includes(flags.surface as typeof SURFACES[number])
        ? flags.surface as ClientTarget['surface']
        : undefined;

    return {
        nodeUrl,
        mcpUrl: `${nodeUrl}/v1/mcp`,
        agent,
        owner: flags.owner ?? '',
        home,
        tokenFile: tokenFileIn(home) ?? join(home, 'tokens', `${agent}@${flags.owner ?? 'owner'}.token`),
        serverName: flags.name ?? 'aimeat',
        workdir: flags.workdir ?? defaultWorkdir(),
        surface,
    };
}

function usage(): string {
    const ids = CLIENTS.map((c) => c.id).join(' | ');
    return [
        `Usage: aimeat connect client <${ids}> [options]`,
        '',
        '  --url <node-url>     AIMEAT node (default https://aimeat.io)',
        '  --owner <handle>     Your owner handle (prompted when omitted)',
        '  --agent <name>       Agent name to create (default: the client id)',
        '  --workdir <path>     Where the client starts (default ~/aimeat-work)',
        '  --home <path>        Connector home for this client (default ~/.aimeat-<client>)',
        '  --surface <role>     appdev | agent | service | admin, claude-desktop only (default: the full toolset)',
        '  --name <server>      Name the MCP server gets in the client config (default: aimeat)',
        '  --reuse              Skip device authorization and use the credential already in --home',
    ].join('\n');
}

/**
 * The summary's tool-surface lines, from what the adapter APPLIED, not from the flag: only the
 * Claude Desktop adapter writes `--surface` into the client's config, and the summary used to
 * print the flag's value for every client (feature-list audit #6).
 */
export function surfaceLines(client: Pick<ClientAdapter, 'label'>, target: Pick<ClientTarget, 'surface'>, result: Pick<WriteResult, 'surface'>): string[] {
    if (result.surface) return [`  Tool surface : ${result.surface}`];
    const lines = ['  Tool surface : full'];
    if (target.surface) {
        lines.push(`  note         : --surface ${target.surface} was not used: ${client.label} connects to the full toolset. Only claude-desktop takes --surface.`);
    }
    return lines;
}

/**
 * Run the one-command connect. Device authorization happens FIRST and inside the client's own
 * home, so a failed or cancelled login never leaves a config pointing at an agent that does not
 * exist.
 */
export async function runConnectClient(clientId: string | undefined, flags: Record<string, string>): Promise<void> {
    if (!clientId || clientId === 'help' || flags.help === 'true') {
        console.log(usage());
        return;
    }

    const client = CLIENTS.find((c) => c.id === clientId);
    if (!client) {
        console.error(`Unknown client "${clientId}".`);
        console.error(usage());
        process.exit(1);
    }

    const target = resolveTarget(client, flags);
    if (!existsSync(target.home)) mkdirSync(target.home, { recursive: true });

    // Set before anything under connect/ is imported (the dynamic imports below). config.ts also
    // reads AIMEAT_HOME on every call, so a config.js loaded earlier still writes the credential
    // here (feature-list audit #6).
    process.env.AIMEAT_HOME = target.home;

    const existingToken = tokenFileIn(target.home);
    if (existingToken && flags.reuse !== 'true') {
        console.log(`An agent credential already exists in ${target.home}.`);
        console.log('Reusing it. Pass --reuse to silence this, or --home <path> to authorize a separate one.\n');
    }

    if (!existingToken) {
        const { runAuth } = await import('../auth.js');
        await runAuth({ url: target.nodeUrl, owner: flags.owner, agent: target.agent });
    }

    const token = tokenFileIn(target.home);
    if (!token) {
        console.error('\nNo credential was stored, so nothing was written to the client config.');
        console.error('Re-run once the device authorization completes.');
        process.exit(1);
    }
    target.tokenFile = token;
    // `{agent}@{owner}.token` — split on the FIRST '@' so an owner handle containing one survives.
    const stem = token.split(/[\\/]/).pop()!.replace(/\.token$/, '');
    const at = stem.indexOf('@');
    if (at > 0) { target.agent = stem.slice(0, at); target.owner = stem.slice(at + 1); }

    const result = await client.apply(target);

    console.log('');
    console.log(`${client.label} is connected to ${target.nodeUrl} as ${target.agent}@${target.owner}.`);
    console.log(`  MCP endpoint : ${client.transport === 'http' ? target.mcpUrl : 'local connector (stdio)'}`);
    for (const line of surfaceLines(client, target, result)) console.log(line);
    console.log(`  Working dir  : ${target.workdir}`);
    for (const f of result.written) console.log(`  wrote        : ${f}`);
    for (const b of result.backedUp) console.log(`  backup       : ${b}`);
    if (result.manual) { console.log(''); console.log(result.manual); }
    if (result.nextSteps.length) {
        console.log('');
        for (const line of result.nextSteps) console.log(`  ${line}`);
    }
}
