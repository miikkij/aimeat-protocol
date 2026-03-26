#!/usr/bin/env tsx
/**
 * Kill any processes listening on the AIMEAT server port before starting dev.
 * Works on Windows (netstat) and Linux/macOS (lsof).
 */
import { execSync } from 'node:child_process';
import { platform } from 'node:os';

const port = process.env.AIMEAT_PORT ?? '40050';

function killOnWindows(port: string): void {
    const pids = new Set<string>();

    // 1. Find processes listening on the port
    try {
        const output = execSync(
            `netstat -ano | findstr LISTENING | findstr :${port}`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
        );
        for (const line of output.trim().split('\n')) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && /^\d+$/.test(pid) && pid !== '0') {
                pids.add(pid);
            }
        }
    } catch {
        // No process found on port — fine
    }

    // 2. Find orphaned node processes running the aimeat dev server
    //    (tsx spawns child node processes that may survive after parent dies)
    try {
        const ownPid = String(process.pid);
        const parentPid = String(process.ppid);
        const psCmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name='node.exe'\\" | Where-Object { $_.CommandLine -match 'src[\\\\/\\\\\\\\]index\\.ts|kill-port' } | ForEach-Object { $_.ProcessId }"`;
        const output = execSync(psCmd, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        for (const line of output.trim().split(/\r?\n/)) {
            const pid = line.trim();
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
