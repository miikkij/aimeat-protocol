/**
 * @file check-skills-standard.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every built-in skill passes the Agent Skills specification's own validator. The node
 *   seeds its built-in skills (src/data/builtin-skills*.ts) into every node's registry and serves the
 *   public ones in /.well-known/agent-skills/index.json, where Claude Code, Cursor and the other
 *   clients read them, so one that breaks the standard is broken for them on every node.
 *
 *   It writes each built-in skill out as a folder `<name>/SKILL.md` in a temporary directory and runs
 *   skills-ref (github.com/agentskills/agentskills, Apache-2.0), the reference validator the
 *   specification names, on all of them in one Python process (scripts/skills-standard-validate.py).
 *   skills-ref is pinned to 0.1.1 and its dependencies are resolved as they were on the date in
 *   EXCLUDE_NEWER, so a new release of either cannot change the answer without a change here.
 *
 *   It runs through uv, as test:python-parity does. NO uv IS A FAILURE WITH ITS REASON, never a
 *   pass: a gate step that passes because its tool is missing says the skills were checked when they
 *   were not (Jouni, 2026-10-18). The same rules in TypeScript (skill-md.ts `issues`) are held over
 *   the built-in skills by test/unit/builtin-skills-standard.test.ts, which CI runs without uv.
 * @usage cd aimeat && pnpm check:skills-standard
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial (wish-agent-skills-standardin-t-ysi-tuki-skill-rekisteriss).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_SKILLS } from '../src/data/builtin-skills.js';

const SKILLS_REF = 'skills-ref==0.1.1';
/** The resolution date for skills-ref's own dependencies (click, strictyaml). */
const EXCLUDE_NEWER = '2026-10-20T00:00:00Z';
const VALIDATE_PY = join(dirname(fileURLToPath(import.meta.url)), 'skills-standard-validate.py');
// No shell: uv is an executable (uv.exe on Windows), which spawn finds on PATH by itself.
const shell = false;

const probe = spawnSync('uv', ['--version'], { encoding: 'utf8', shell });
if (probe.status !== 0) {
    console.error('✗ check:skills-standard: uv is not on PATH, so the built-in skills were not checked against the Agent Skills validator.\n'
        + '  Install uv (https://docs.astral.sh/uv/getting-started/installation/) and run the gate again;\n'
        + '  uv brings Python 3.12 and skills-ref itself.');
    process.exit(1);
}

const root = mkdtempSync(join(tmpdir(), 'aimeat-skills-standard-'));
try {
    const dirs: string[] = [];
    for (const skill of BUILTIN_SKILLS) {
        const dir = join(root, skill.name);
        mkdirSync(dir);
        writeFileSync(join(dir, 'SKILL.md'), skill.skillMd, 'utf8');
        dirs.push(dir);
    }
    const t0 = Date.now();
    const r = spawnSync('uv', ['run', '--no-project', '--quiet', '--python', '3.12', '--exclude-newer', EXCLUDE_NEWER,
        '--with', SKILLS_REF, 'python', VALIDATE_PY, ...dirs], { encoding: 'utf8', shell, maxBuffer: 16 * 1024 * 1024 });
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    const lines = `${r.stdout ?? ''}`.split('\n').filter(Boolean);
    const failures = lines.filter(l => l.startsWith('FAIL '));
    const passed = lines.filter(l => l.startsWith('ok ')).length;
    if (r.status !== 0 || passed !== dirs.length) {
        for (const f of failures) console.error(`  ${f}`);
        if (failures.length === 0) console.error(`${r.stderr ?? ''}`.trim());
        console.error(`✗ check:skills-standard: ${failures.length > 0 ? `${new Set(failures.map(f => f.split(':')[0])).size} built-in skill(s) break` : 'skills-ref did not check every built-in skill against'} the Agent Skills specification (${passed}/${dirs.length} passed, ${secs}s).`);
        process.exit(1);
    }
    console.log(`✓ check:skills-standard: all ${dirs.length} built-in skills pass skills-ref (${SKILLS_REF}, ${secs}s)`);
} finally {
    rmSync(root, { recursive: true, force: true });
}
