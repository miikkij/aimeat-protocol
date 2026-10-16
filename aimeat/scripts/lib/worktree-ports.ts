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
 * @structure envPortOf(aimeatDir) · portsOfOtherCheckouts(aimeatDir) · portConflicts(aimeatDir, port)
 * @usage import { portConflicts } from './lib/worktree-ports.js';
 * @version-history
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

/** What stands in the way of `port`: other checkouts that name it, and whether a process holds it now. */
export async function portConflicts(aimeatDir: string, port: number): Promise<{ sharedWith: string[]; held: boolean }> {
  const sharedWith = portsOfOtherCheckouts(aimeatDir).filter(o => o.port === port).map(o => o.where);
  return { sharedWith, held: !(await portIsFree(port)) };
}
