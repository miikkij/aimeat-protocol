/**
 * @file seed-digital-signage.ts
 * @description Seeds example packages via the admin API. Uses admin password
 *   from .env (AIMEAT_ADMIN_PASSWORD) to authenticate without needing a JWT.
 * @usage
 *   cd aimeat && pnpm seed:examples
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial implementation
 *   v2.0.0 — 2026-03-16 — auto-auth via admin password, uses admin seed endpoint
 *   v2.0.1 — 2026-03-16 — fix: support AIMEAT_ADMIN_PASSWORD env var name and quoted values
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load admin password from .env file
function loadAdminPassword(): string {
  const envPaths = [
    resolve(__dirname, '..', '.env'),
    resolve(__dirname, '..', '.env.local'),
  ];
  for (const envPath of envPaths) {
    try {
      const content = readFileSync(envPath, 'utf8');
      // Support both AIMEAT_ADMIN_PASSWORD and ADMIN_PASSWORD
      const match = content.match(/^(?:AIMEAT_)?ADMIN_PASSWORD=(?:"([^"]*)"|'([^']*)'|(.+))$/m);
      if (match) return (match[1] ?? match[2] ?? match[3] ?? '').trim();
    } catch { /* file not found */ }
  }
  return process.env.AIMEAT_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? '';
}

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:40050';
const ADMIN_PASSWORD = process.env.AIMEAT_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? loadAdminPassword();

async function main() {
  console.log('\n=== AIMEAT Example Package Seeder ===\n');
  console.log(`  Server: ${BASE_URL}`);

  // Check server is reachable
  try {
    const probe = await fetch(`${BASE_URL}/v1/health`);
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  } catch {
    console.error(`\n  Server not reachable at ${BASE_URL}`);
    console.error(`  Start the server first in another terminal: cd aimeat && pnpm dev\n`);
    setTimeout(() => process.exit(1), 100);
    return;
  }

  if (!ADMIN_PASSWORD) {
    console.error('\n  AIMEAT_ADMIN_PASSWORD not found in .env or environment.');
    console.error('  Set it in .env or pass it: AIMEAT_ADMIN_PASSWORD=xxx pnpm seed:examples\n');
    setTimeout(() => process.exit(1), 100);
    return;
  }

  console.log('  Seeding example packages via admin API...\n');

  const res = await fetch(`${BASE_URL}/v1/admin/seed-examples`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': ADMIN_PASSWORD,
    },
  });

  const data = await res.json() as any;

  if (!data.ok) {
    console.error(`  Failed: ${data.error?.message ?? JSON.stringify(data)}`);
    setTimeout(() => process.exit(1), 100);
    return;
  }

  const seeded = data.data?.seeded ?? [];
  for (const pkg of seeded) {
    const status = pkg.templateId === '(already exists)' ? 'already exists' : 'created';
    console.log(`  ${status === 'created' ? '+' : '='} ${pkg.name} (${status})`);
    if (status === 'created') {
      console.log(`    Browse:  ${BASE_URL}/v1/packages/${encodeURIComponent(pkg.packageGroupId)}`);
    }
  }

  console.log('\n  Done!\n');
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  setTimeout(() => process.exit(1), 100);
});
