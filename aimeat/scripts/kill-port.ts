#!/usr/bin/env tsx
/**
 * Kill any processes listening on the AIMEAT server port before starting dev.
 * Works on Windows (netstat) and Linux/macOS (lsof).
 *
 * STRICTLY PORT-SCOPED: every kill path first proves the PID owns a socket on
 * THIS port. The old name-based orphan sweep (any node.exe matching
 * src/index.ts) killed every parallel dev server on the machine — worktree
 * sessions on other ports murdered each other on every `pnpm dev` start.
 */
import { execSync } from 'node:child_process';
import { platform } from 'node:os';

const port = process.env.AIMEAT_PORT ?? '40050';

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
