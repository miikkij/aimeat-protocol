/**
 * @file boot-smoke.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The cheapest proof that the server would start: import the modules on the boot
 *   path (the route loader, the library-pack registry, the MCP catalog) without opening a port.
 *   A commit whose imports resolve in the author's worktree and nowhere else passes every static
 *   gate and still leaves main unable to boot; this catches it in seconds. It runs in the pre-push
 *   hook and in CI, after typecheck, because a module can typecheck and still throw at load.
 * @structure IMPORTS → import each, time it, report the first failure with its cause chain
 * @usage  pnpm boot:smoke   (pre-push; CI)
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (wish-coding-central-parallel-sessions).
 */
const IMPORTS = [
  '../src/data/library-packs.js',
  '../src/data/app-templates.js',
  '../src/data/builtin-skills.js',
  '../src/server-bootstrap/routes-loader.js',
  '../src/mcp/index.js',
];

async function main(): Promise<void> {
  for (const spec of IMPORTS) {
    const started = Date.now();
    try {
      await import(spec);
      console.log(`  ok   ${spec} (${Date.now() - started} ms)`);
    } catch (err) {
      console.error(`✗ boot smoke: ${spec} did not load`);
      let e: unknown = err;
      while (e && typeof e === 'object') {
        console.error('  ' + String((e as { message?: string }).message || e));
        e = (e as { cause?: unknown }).cause;
      }
      process.exit(1);
    }
  }
  console.log('✓ boot smoke: every module on the boot path loads');
  process.exit(0);
}

main();
