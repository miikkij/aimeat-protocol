/**
 * @file seed-digital-signage.ts
 * @description Seeds example packages via the API. Auto-authenticates by
 *   registering a temporary owner or using an existing OWNER_TOKEN.
 * @usage
 *   cd aimeat && pnpm seed:examples
 *   # Or with explicit token:
 *   cd aimeat && OWNER_TOKEN=<jwt> pnpm exec tsx scripts/seed-digital-signage.ts
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial implementation
 *   v2.0.0 — 2026-03-16 — auto-auth, uses shared example-packages data module
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(ed.etc as any).sha512Sync = (...m: Uint8Array[]) =>
  new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:40050';
const NODE_ID = process.env.NODE_ID ?? 'aimeat-local-001-dev';

// ── Helpers ──────────────────────────────────────────────────────────

async function api(method: string, path: string, body?: unknown, token?: string): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const privKey = Buffer.from(privateKeyB64, 'base64');
  const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
  return Buffer.from(sig).toString('base64');
}

// ── Auto-auth: register temp owner, get token ───────────────────────

async function getToken(): Promise<{ token: string; ownerName: string; cleanup: () => Promise<void> }> {
  // If user provided a token, use it
  if (process.env.OWNER_TOKEN) {
    return {
      token: process.env.OWNER_TOKEN,
      ownerName: 'operator',
      cleanup: async () => {},
    };
  }

  const ownerName = `seed-${Date.now()}`;
  console.log(`  Registering temporary owner "${ownerName}"...`);

  const reg = await api('POST', '/v1/owners', { name: ownerName, public_key: 'placeholder' });
  if (!reg.ok) throw new Error(`Registration failed: ${reg.error?.message ?? JSON.stringify(reg)}`);
  const privKey = reg.data.private_key;

  const timestamp = new Date().toISOString();
  const message = ownerName + NODE_ID + timestamp;
  const signature = await signMsg(privKey, message);

  const auth = await api('POST', '/v1/auth/token', { owner: ownerName, timestamp, signature });
  if (!auth.ok) throw new Error(`Auth failed: ${auth.error?.message ?? JSON.stringify(auth)}`);

  return {
    token: auth.data.token,
    ownerName,
    cleanup: async () => {
      console.log(`  Cleaning up temporary owner "${ownerName}"...`);
      await api('DELETE', `/v1/owners/${ownerName}`, undefined, auth.data.token);
    },
  };
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== AIMEAT Example Package Seeder ===\n');
  console.log(`  Server: ${BASE_URL}`);

  // Check server is reachable
  try {
    const probe = await fetch(`${BASE_URL}/v1/node`);
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  } catch {
    console.error(`\n  Server not reachable at ${BASE_URL}`);
    console.error(`  Start the server first: cd aimeat && pnpm dev\n`);
    process.exit(1);
  }

  const { token, ownerName, cleanup } = await getToken();
  console.log(`  Authenticated as: ${ownerName}\n`);

  // Create packages from shared definitions
  const { getExamplePackages } = await import('../src/data/example-packages.js');
  const examples = getExamplePackages();

  for (const def of examples) {
    console.log(`  Creating "${def.name}" package (${def.components.length} components)...`);

    const createRes = await api('POST', '/v1/bundles', {
      name: def.name,
      description: def.description,
      category: def.category,
      tags: def.tags,
      visibility: def.visibility,
      components: def.components,
    }, token);

    if (!createRes.ok) {
      if (createRes.error?.code === 'CONFLICT') {
        console.log(`  Package "${def.name}" already exists — skipping.`);
        continue;
      }
      throw new Error(`Create failed: ${createRes.error?.message ?? JSON.stringify(createRes)}`);
    }

    const groupId = createRes.data.packageGroupId;
    const version = createRes.data.version;
    const encodedGroupId = encodeURIComponent(groupId);
    console.log(`  Created: ${groupId} (${version})`);

    // Publish
    await api('PATCH', `/v1/bundles/${encodedGroupId}/versions/${version}`, { status: 'published' }, token);
    console.log(`  Published: ${version}`);

    // Create template listing
    const tplRes = await api('POST', '/v1/templates', {
      packageGroupId: groupId,
      title: def.templateListing.title,
      description: def.templateListing.description,
      category: def.templateListing.category,
      tags: def.templateListing.tags,
    }, token);

    if (tplRes.ok) {
      console.log(`  Template listing created: ${tplRes.data?.listing?.id ?? 'ok'}`);
    }

    console.log(`\n  Browse:  ${BASE_URL}/v1/bundles/${encodedGroupId}`);
    console.log(`  Install: POST ${BASE_URL}/v1/bundles/${encodedGroupId}/install`);
  }

  await cleanup();
  console.log('\n  Done!\n');
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
