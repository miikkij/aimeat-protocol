#!/usr/bin/env tsx
/**
 * Kill any processes listening on the MEAT server port before starting dev.
 * Works on Windows (netstat) and Linux/macOS (lsof).
 */
import { execSync } from 'node:child_process';
import { platform } from 'node:os';

const port = process.env.MEAT_PORT ?? '40050';

function killOnWindows(port: string): void {
    try {
        const output = execSync(
            `netstat -ano | findstr LISTENING | findstr :${port}`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
        );
        const pids = new Set<string>();
        for (const line of output.trim().split('\n')) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && /^\d+$/.test(pid) && pid !== '0') {
                pids.add(pid);
            }
        }
        for (const pid of pids) {
            try {
                execSync(`taskkill /PID ${pid} /F /T`, {
                    encoding: 'utf-8',
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
