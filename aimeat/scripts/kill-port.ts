#!/usr/bin/env tsx
/**
 * @file scripts/kill-port.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Kill any processes listening on the AIMEAT server port before starting dev.
 * Works on Windows (netstat) and Linux/macOS (lsof).
 * @usage Prepended to `pnpm dev` as `tsx scripts/kill-port.ts --port-from=.env`.
 * @version-history
 *   2026-11-21 — The port comes from .env when the shell names none; a worktree that names none is refused.
 *
 * STRICTLY PORT-SCOPED: every kill path first proves the PID owns a socket on
 * THIS port. The old name-based orphan sweep (any node.exe matching
 * src/index.ts) killed every parallel dev server on the machine — worktree
 * sessions on other ports murdered each other on every `pnpm dev` start.
 *
 * THE PORT IS THE ONE THE DEV SERVER WILL BIND (2026-11-21): AIMEAT_PORT from the shell, else from
 * the env file `pnpm dev` starts the node with (`--port-from=.env` names it), else 40050. It
 * read the shell alone, so a worktree whose port sat in its .env stopped the main checkout's server
 * on 40050 before its own booted (docs/pitfalls.md §13 until that day). Inside .worktrees/ a port
 * that came from nowhere is refused rather than taken to be 40050.
 */
import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import { envFileArgs, portFor } from './lib/env-file-port.js';

const chosen = portFor({ keys: ['AIMEAT_PORT'], envFiles: [...envFileArgs(process.argv.slice(2)), '.env'], cwd: process.cwd(), fallback: '40050' });
const port = chosen.port;
if (chosen.source === 'default' && /[\\/]\.worktrees[\\/]/.test(process.cwd())) {
    console.error('\n  STOP: this worktree names no AIMEAT_PORT (shell or aimeat/.env), so its dev server would take'
        + '\n  40050 and this script would stop the main checkout\'s server there first. Nothing was stopped.'
        + '\n  Put AIMEAT_PORT=<a port your claim names> in aimeat/.env, then run pnpm dev again.\n');
    process.exit(1);
}

/** PIDs owning a socket whose LOCAL address ends with :port (any state).
 *  The endsWith guard matters: `findstr :4005` also matches `:40050` lines. */
function pidsOnPortWindows(port: string, listeningOnly: boolean): Set<string> {
    const pids = new Set<string>();
    try {
        const filter = listeningOnly ? '| findstr LISTENING ' : '';
        const output = execSync(
            `netstat -ano ${filter}| findstr :${port}`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
        );
        for (const line of output.trim().split('\n')) {
            const parts = line.trim().split(/\s+/);
            const local = parts[1] ?? '';                 // local address column
            const pid = parts[parts.length - 1];
            if (!local.endsWith(`:${port}`)) continue;    // exact port, local side only
            if (pid && /^\d+$/.test(pid) && pid !== '0') {
                pids.add(pid);
            }
        }
    } catch {
        // No process found on port — fine
    }
    return pids;
}

function killOnWindows(port: string): void {
    // 1. Processes LISTENING on the port
    const pids = pidsOnPortWindows(port, true);

    // 2. Orphaned aimeat dev-server node processes (tsx children that survived
    //    their parent) — but ONLY those that still own a socket on THIS port.
    //    A src/index.ts match alone is NOT enough: that is some other session's
    //    server on a different port. Leave it alone.
    try {
        const onThisPort = pidsOnPortWindows(port, false);
        const ownPid = String(process.pid);
        const parentPid = String(process.ppid);
        const psCmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name='node.exe'\\" | Where-Object { $_.CommandLine -match 'src[\\\\/\\\\\\\\]index\\.ts|kill-port' } | ForEach-Object { $_.ProcessId }"`;
        const output = execSync(psCmd, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        for (const line of output.trim().split(/\r?\n/)) {
            const pid = line.trim();
            if (!onThisPort.has(pid)) continue;           // port-scoped: skip other ports' servers
            if (pid && /^\d+$/.test(pid) && pid !== '0' && pid !== ownPid && pid !== parentPid) {
                pids.add(pid);
            }
        }
    } catch {
        // PowerShell not available or no matches — fine
    }

    // Kill all collected PIDs
    for (const pid of pids) {
        try {
            execSync(`taskkill /PID ${pid} /F /T`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            console.log(`  Killed PID ${pid}`);
        } catch {
            // Process may have already exited
        }
    }
}

function killOnUnix(port: string): void {
    try {
        const output = execSync(`lsof -ti :${port}`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const pids = new Set(
            output.trim().split('\n').filter((p) => /^\d+$/.test(p)),
        );
        for (const pid of pids) {
            try {
                execSync(`kill -9 ${pid}`, {
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
                console.log(`  Killed PID ${pid} on port ${port}`);
            } catch {
                // Process may have already exited
            }
        }
    } catch {
        // No process found on port — good
    }
}

console.log(`Checking port ${port}...`);

if (platform() === 'win32') {
    killOnWindows(port);
} else {
    killOnUnix(port);
}
