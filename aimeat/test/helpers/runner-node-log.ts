/**
 * @file test/helpers/runner-node-log.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The E2E runner keeps what its lane node says during each suite: the whole output in a
 *   file, and the last lines in memory for the summary of a red suite.
 *
 *   WHY. The runner read the node's streams into a 20-line tail used only when the node failed to
 *   start. A suite that failed on a 500, or a node that died during a suite, left no stack trace and
 *   no log line anywhere, on CI or locally (QA audit 2026-10-16, P1-07). Now every suite's node
 *   output goes to test-results/e2e-node/<suite>.<backend>.log (AIMEAT_E2E_NODE_LOG_DIR moves it).
 *   A green suite's file is deleted when its node stops; a red one's stays, its tail is printed under
 *   the suite, and CI uploads the directory as an artifact.
 * @structure nodeLogDir() · clearNodeLogs() · recordNodeOutput() · nodeLogTail() · nodeLogPath() ·
 *   discardNodeLogOnClose()
 * @version-history
 *   v1.0.0 -- 2026-10-16 -- Initial (QA audit W12, P1-07).
 */
import type { ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, unlinkSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';

/** Lines kept in memory per node for the summary of a red suite. */
const TAIL_LINES = 60;

interface NodeLog { path: string; stream: WriteStream; tail: string[]; partial: string }
const logs = new WeakMap<ChildProcess, NodeLog>();

export function nodeLogDir(): string {
    return process.env.AIMEAT_E2E_NODE_LOG_DIR ?? join(process.cwd(), 'test-results', 'e2e-node');
}

/** Remove the logs an earlier run of this backend left, so the directory holds this run's red suites only. */
export function clearNodeLogs(dbType: string): void {
    const dir = nodeLogDir();
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
        if (f.endsWith(`.${dbType}.log`)) {
            try { unlinkSync(join(dir, f)); } catch { /* a file another process holds stays; it is named by its suite */ }
        }
    }
}

/** Send everything the node prints on both streams to its suite's file, and keep the last lines. */
export function recordNodeOutput(child: ChildProcess, suite: string, dbType: string): void {
    const dir = nodeLogDir();
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${suite.replace(/[^\w.-]/g, '_')}.${dbType}.log`);
    const log: NodeLog = { path, stream: createWriteStream(path), tail: [], partial: '' };
    // A file that cannot be written must not stop the run: the in-memory tail still works.
    log.stream.on('error', () => { /* reported by its absence; the tail below is kept regardless */ });
    const keep = (d: Buffer) => {
        log.stream.write(d);
        const lines = (log.partial + d.toString()).split('\n');
        log.partial = lines.pop() ?? '';
        log.tail.push(...lines);
        if (log.tail.length > TAIL_LINES) log.tail.splice(0, log.tail.length - TAIL_LINES);
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    child.once('close', () => log.stream.end());
    logs.set(child, log);
}

/** The node's last lines, oldest first. */
export function nodeLogTail(child: ChildProcess): string {
    const log = logs.get(child);
    if (!log) return '';
    return [...log.tail, log.partial].filter(Boolean).join('\n');
}

export function nodeLogPath(child: ChildProcess): string | undefined {
    return logs.get(child)?.path;
}

/** A green suite's log is not kept: delete it once the node has closed its streams. */
export function discardNodeLogOnClose(child: ChildProcess): void {
    const log = logs.get(child);
    if (!log) return;
    const remove = () => log.stream.end(() => { try { if (existsSync(log.path)) unlinkSync(log.path); } catch { /* left for the next run's clear */ } });
    if (child.exitCode !== null || child.signalCode !== null) remove();
    else child.once('close', remove);
}
