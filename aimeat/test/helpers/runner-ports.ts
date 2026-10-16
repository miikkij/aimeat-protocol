/**
 * @file test/helpers/runner-ports.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The E2E runner's waits on real conditions: a process that has exited, and a port that
 *   nothing holds (and who holds it when it stays bound). Moved unchanged out of
 *   test/run-e2e-server.ts, which had passed the 800-line limit.
 * @structure waitForExit() · canBind() · portIsFree() · waitForPortFree() · whoHolds() · requirePortFree()
 * @version-history
 *   v1.0.0 -- 2026-10-16 -- Pure extraction from test/run-e2e-server.ts (QA audit W12, P1-07: the
 *     server file gains the node-log line and had to stay under 800 lines).
 */
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

export function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    return new Promise((settle) => {
        // A declaration, so the timer can be named before it exists: exit cannot fire before the
        // listener below is attached, and by then the timer is set.
        function onExit(): void { clearTimeout(timer); settle(true); }
        const timer = setTimeout(() => { child.off('exit', onExit); settle(false); }, timeoutMs);
        child.once('exit', onExit);
    });
}

function canBind(port: number, host?: string): Promise<boolean> {
    return new Promise((settle) => {
        const probe = createServer();
        probe.once('error', () => settle(false));
        probe.once('listening', () => probe.close(() => settle(true)));
        if (host === undefined) probe.listen(port); else probe.listen(port, host);
    });
}

/**
 * Binding is the only definitive answer. An HTTP probe can be answered by a DIFFERENT server, which
 * is exactly the confusion this replaces: a suite talking to the previous run's node on the old
 * database, while the runner believed it had started a fresh one.
 *
 * Both address families are tried, because one of them is not an answer. `app.listen(port)` with no
 * host binds `::` dual-stack, and on Windows a fresh `0.0.0.0` bind SUCCEEDS beside it: the first
 * version of this probe used 0.0.0.0 alone, reported a busy port free, and let the run continue
 * against a server it had not started. Free means nothing can take it, from either side.
 */
async function portIsFree(port: number): Promise<boolean> {
    // Sequentially: a dual-stack `::` bind and an IPv4 bind held at the same moment collide with
    // each other, and the probe would report its own socket as somebody else's server.
    if (!await canBind(port)) return false;
    return canBind(port, '0.0.0.0');
}

export async function waitForPortFree(port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (await portIsFree(port)) return true;
        if (Date.now() >= deadline) return false;
        await new Promise(r => setTimeout(r, 100));
    }
}

/**
 * Who is holding a port, in one line, asked only when the refusal below is already certain.
 *
 * A port that will not come free is the hardest failure in this runner to read after the fact: the
 * message names the port and the moment, and nothing about the holder, so every occurrence has been
 * answered with a re-run and a guess. An AIMEAT node answers /v1/build with its own id and its build
 * stamp, which says at once whether this is one of ours left behind or somebody else's process, and
 * that is the difference between a bug in the runner and a busy machine. Bounded, and it never
 * decides anything: the refusal happens either way.
 */
async function whoHolds(port: number): Promise<string> {
    const probe = await fetch(`http://127.0.0.1:${port}/v1/build`, { signal: AbortSignal.timeout(2_000) }).then(
        async (r) => `An AIMEAT node answers /v1/build on it (HTTP ${r.status}): ${(await r.text()).slice(0, 200)}`,
        (e: unknown) => `Nothing answers /v1/build on it (${(e as Error).message}), so whatever holds it is not a node that finished starting.`,
    );
    return probe;
}

/** Fail loudly rather than start a second server that cannot bind and then test the first one. */
export async function requirePortFree(port: number, timeoutMs: number, context: string): Promise<void> {
    const started = Date.now();
    if (await waitForPortFree(port, timeoutMs)) return;
    const holder = await whoHolds(port);
    throw new Error(`Port ${port} was still bound ${Date.now() - started}ms after ${context}. ${holder} Nothing can be trusted from here: a suite would talk to whichever server holds it, on whichever database that one opened. Clear it with \`AIMEAT_PORT=${port} pnpm exec tsx scripts/kill-port.ts\` (that script reads the env var, not an argument), or give this run a port of its own with AIMEAT_PORT.`);
}
