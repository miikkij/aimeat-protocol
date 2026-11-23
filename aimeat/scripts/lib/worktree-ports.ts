/**
 * @file scripts/lib/worktree-ports.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which E2E port the other checkouts of this repository use, and whether this
 *   checkout's port collides with one of them or is held by a running process. Read by
 *   `pnpm test:env:init` (a warning when it writes the env files) and `pnpm machine:check`.
 *
 *   WHY. Two E2E runs on one port stop each other: the runner kills whatever holds its port before
 *   it starts, and a Postgres run empties its database between suites. The port is derived from the
 *   worktree's name, so two names can land on one port, and a copied env file carries another
 *   worktree's port; nothing said so until a run failed in a way that looked like a defect.
 * @structure envPortOf(aimeatDir) · portsOfOtherCheckouts(aimeatDir) · portsNamedByTests(aimeatDir) · portConflicts(aimeatDir, port)
 * @usage import { portConflicts } from './lib/worktree-ports.js';
 * @version-history
 *   v1.2.0 — 2026-11-23 — TRAIN_WORKTREE and TRAIN_PORT: the worktree of pnpm ready's batch and its port.
 *   v1.1.0 — 2026-11-21 — portsNamedByTests(): the 40xxx numbers the test files write down, which
 *     test:env:init no longer derives a port onto.
 *   v1.0.0 — 2026-10-16 — Initial (QA audit D8-09, P9).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { portIsFree } from './port-free.js';

/** AIMEAT_PORT in a checkout's .env.test.sqlite, or null when there is none. */
export function envPortOf(aimeatDir: string): number | null {
  const f = join(aimeatDir, '.env.test.sqlite');
  if (!existsSync(f)) return null;
  const m = /^AIMEAT_PORT=(\d+)$/m.exec(readFileSync(f, 'utf-8'));
  return m ? Number(m[1]) : null;
}

/** The E2E port of every OTHER checkout of this repository (the main one and each worktree). */
export function portsOfOtherCheckouts(aimeatDir: string): Array<{ where: string; port: number }> {
  let root: string;
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: aimeatDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    root = dirname(common);
  } catch {
    return [];
  }
  const dirs = [join(root, 'aimeat')];
  const wt = join(root, '.worktrees');
  if (existsSync(wt)) for (const name of readdirSync(wt)) dirs.push(join(wt, name, 'aimeat'));
  const out: Array<{ where: string; port: number }> = [];
  for (const d of dirs) {
    if (resolve(d) === resolve(aimeatDir)) continue;
    const port = envPortOf(d);
    if (port !== null) out.push({ where: d, port });
  }
  return out;
}

/**
 * Every 40xxx number a file under test/ writes down (top level, where the runner's suites live), with
 * the files that write it. The runner refuses to start on a port a suite in its run names
 * (portClashes in test/run-e2e-ci.ts, the same regex, comments included), so a worktree given such a
 * port by test:env:init had its guard tier stop five minutes into a gate (incident "test:env:init can
 * derive a worktree port that an E2E suite owns", 2026-10-12). 40251 and 40050 are the runner's and
 * the dev server's defaults, which a suite names without owning, as the runner also reads them.
 */
export function portsNamedByTests(aimeatDir: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const dir = join(aimeatDir, 'test');
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
    let text: string;
    try { text = readFileSync(join(dir, name), 'utf-8'); } catch { continue; }
    for (const m of new Set([...text.matchAll(/\b(40[0-9]{3})\b/g)].map(x => Number(x[1])))) {
      if (m === 40251 || m === 40050) continue;
      out.set(m, [...(out.get(m) ?? []), `test/${name}`]);
    }
  }
  return out;
}

/**
 * The worktree pnpm ready's batch tests in (scripts/lib/ready-train.ts) and its E2E port: the first
 * one past the range the board hands out and test:env:init accepts from a session (40251-40499), so
 * no claim can name it, and below the sandboxes (40600 upward). No test file writes it down.
 */
export const TRAIN_WORKTREE = 'ready-train';
export const TRAIN_PORT = 40500;

/** The band a derived worktree port falls in: clear of the dev server and of the lane ports. */
export const DERIVED_PORT_MIN = 40251;
export const DERIVED_PORT_SPAN = 140;

/**
 * A worktree's E2E port from its name, the same on every run: the name's hash in 40251-40390, moved
 * up one at a time (wrapping inside the band) past every port `named` holds. A port a suite writes
 * down was handed out by the hash alone until 2026-11-21.
 */
export function derivePort(slug: string, named: ReadonlySet<number> | ReadonlyMap<number, unknown>): number {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const start = h % DERIVED_PORT_SPAN;
  for (let i = 0; i < DERIVED_PORT_SPAN; i++) {
    const port = DERIVED_PORT_MIN + ((start + i) % DERIVED_PORT_SPAN);
    if (!named.has(port)) return port;
  }
  return DERIVED_PORT_MIN + start; // every port in the band is named: the runner will say so
}

/** What stands in the way of `port`: other checkouts that name it, and whether a process holds it now. */
export async function portConflicts(aimeatDir: string, port: number): Promise<{ sharedWith: string[]; held: boolean }> {
  const sharedWith = portsOfOtherCheckouts(aimeatDir).filter(o => o.port === port).map(o => o.where);
  return { sharedWith, held: !(await portIsFree(port)) };
}
