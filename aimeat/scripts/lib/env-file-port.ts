/**
 * @file scripts/lib/env-file-port.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The port a node started from this checkout will bind, read the way the node reads it:
 *   the shell first, then the env file it is started with.
 *
 *   WHY. kill-port.ts (before `pnpm dev`) and kill-test-servers.ts (before every `test:e2e:*`) read
 *   the port from the SHELL only, while the node they clear the way for reads its env file
 *   (`node --env-file=.env`, `--env-file=.env.test.sqlite`). A worktree whose port sat only in that
 *   file had its `pnpm dev` stop the main checkout's server on 40050, and a plain `pnpm gate` stop
 *   whatever answered on 40251, another session's E2E server (docs/pitfalls.md §13 until
 *   2026-11-21; incident "kill-test-servers reads the port only from the shell"). Node's own rule
 *   for --env-file is that a variable the shell already has wins, and this follows it.
 * @structure envFileValues(path) · portFor({ keys, envFiles, cwd, fallback })
 * @usage import { portFor } from './lib/env-file-port.js';
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parseEnv } from 'node:util';

/** The variables an env file sets, parsed with Node's own --env-file parser; {} when there is no file. */
export function envFileValues(path: string): Record<string, string> {
    if (!existsSync(path)) return {};
    try { return parseEnv(readFileSync(path, 'utf8')) as Record<string, string>; } catch { return {}; }
}

export interface PortChoice {
    port: string;
    /** Where the number came from: `shell AIMEAT_PORT`, `.env.test.sqlite AIMEAT_TEST_PORT`, or `default`. */
    source: string;
}

/**
 * The first of `keys` the shell sets, else the first of `keys` the first existing `envFiles` sets,
 * else `fallback`. `envFiles` are relative to `cwd` unless absolute.
 */
export function portFor(opts: { keys: string[]; envFiles: string[]; cwd: string; fallback: string; env?: NodeJS.ProcessEnv }): PortChoice {
    const env = opts.env ?? process.env;
    for (const k of opts.keys) {
        const v = env[k]?.trim();
        if (v) return { port: v, source: `shell ${k}` };
    }
    for (const f of opts.envFiles) {
        const path = isAbsolute(f) ? f : join(opts.cwd, f);
        if (!existsSync(path)) continue;
        const values = envFileValues(path);
        for (const k of opts.keys) {
            const v = values[k]?.trim();
            if (v) return { port: v, source: `${f} ${k}` };
        }
    }
    return { port: opts.fallback, source: 'default' };
}

/**
 * `--port-from=<path>` arguments given to a script, in order. Not `--env-file=`: Node reads that flag
 * from anywhere on its command line, even after the script, and exits 9 when the file is missing.
 */
export function envFileArgs(argv: string[]): string[] {
    return argv.filter(a => a.startsWith('--port-from=')).map(a => a.slice('--port-from='.length)).filter(Boolean);
}
