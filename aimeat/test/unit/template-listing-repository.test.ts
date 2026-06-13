/**
 * @file template-listing-repository.test.ts
 * @description API-level tests for the TemplateListingRepository through HTTP endpoints.
 *   Exercises template gallery listing CRUD, reviews with rating recalculation,
 *   threaded discussions, listing filters, and uniqueness constraints via /v1/templates routes.
 * @usage
 *   cd aimeat && pnpm exec tsx test/unit/template-listing-repository.test.ts
 *   Requires: server running on port 40251
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial test suite
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) =>
  new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  \u2705 ${name}`); }
  catch (err: any) { failed++; console.error(`  \u274C ${name}: ${err.message}`); }
}

function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body, headers: res.headers };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const privKey = Buffer.from(privateKeyB64, 'base64');
  const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
  return Buffer.from(sig).toString('base64');
}

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ─── State ───────────────────────────────────────────────────────────

let ownerToken = '';
let ownerPrivKey = '';
const ownerName = `tmplrepo${Date.now()}`;

// Second owner for review from a different user
let owner2Token = '';
let owner2PrivKey = '';
const owner2Name = `tmplrepo2${Date.now()}`;

const pkgName = `tmpl-test-pkg-${Date.now()}`;
let groupId = '';
let encodedGroupId = '';
let firstVersion = '';
let listingId = '';
let discussionId = '';

console.log('\n=== Template Listing Repository Unit Tests ===\n');

// ─── Setup: Register owners + create & publish a package ─────────────

console.log('Setup — Register owners + create & publish package');

await test('Register test owner (first = operator)', async () => {
  const { status, body } = await json('/v1/owners', {
    method: 'POST',
    body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  ownerPrivKey = body.data.private_key;
});

await test('Owner auth', async () => {
  const timestamp = new Date().toISOString();
  const message = ownerName + NODE_ID + timestamp;
  const signature = await signMsg(ownerPrivKey, message);
  const { body } = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ owner: ownerName, timestamp, signature }),
  });
  assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
  ownerToken = body.data?.token;
});

await test('Register second owner', async () => {
  const { status, body } = await json('/v1/owners', {
    method: 'POST',
    body: JSON.stringify({ name: owner2Name, public_key: 'placeholder' }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  owner2PrivKey = body.data.private_key;
});

await test('Second owner auth', async () => {
  const timestamp = new Date().toISOString();
  const message = owner2Name + NODE_ID + timestamp;
  const signature = await signMsg(owner2PrivKey, message);
  const { body } = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ owner: owner2Name, timestamp, signature }),
  });
  assert(body.ok === true, `token ok: ${JSON.stringify(body.error)}`);
  owner2Token = body.data?.token;
});

await test('Create and publish a package', async () => {
  const { status, body } = await json('/v1/packages', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      name: pkgName,
      description: 'Package for template listing tests',
      category: 'theme',
      tags: ['template-test'],
      visibility: 'public',
      components: [
        { id: 'csm-main', type: 'csm', label: 'Main CSM', content: '{"fields":[]}', dependencies: [] },
      ],
    }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  firstVersion = body.data.version;
  groupId = body.data.packageGroupId;
  encodedGroupId = encodeURIComponent(groupId);

  // Publish it
  const { status: patchStatus } = await json(
    `/v1/packages/${encodedGroupId}/versions/${firstVersion}`,
    {
      method: 'PATCH',
      headers: authed(ownerToken),
      body: JSON.stringify({ status: 'published' }),
    },
  );
  assert(patchStatus === 200, `Publish failed: ${patchStatus}`);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 1: Create template listing (POST /v1/templates)
// ═══════════════════════════════════════════════════════════════════════

console.log('\nTest — Template Listing CRUD');

await test('Create template listing (POST /v1/templates)', async () => {
  const { status, body } = await json('/v1/templates', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      packageGroupId: groupId,
      title: 'Test Template Listing',
      description: 'A test listing for the template gallery',
      category: 'theme',
      tags: ['test', 'gallery'],
      screenshots: ['https://example.com/screenshot1.png'],
    }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.listing?.id, 'Missing listing id');
  assert(body.data.listing.title === 'Test Template Listing', 'Title mismatch');
  assert(body.data.listing.packageGroupId === groupId, 'packageGroupId mismatch');
  assert(body.data.listing.installCount === 0, 'Initial installCount should be 0');
  assert(body.data.listing.rating === 0, 'Initial rating should be 0');
  assert(body.data.listing.reviewCount === 0, 'Initial reviewCount should be 0');
  assert(body.data.listing.status === 'listed', 'Status should be listed');
  listingId = body.data.listing.id;
});

// ═══════════════════════════════════════════════════════════════════════
// Test 2: Get listing (GET /v1/templates/:id)
// ═══════════════════════════════════════════════════════════════════════

await test('Get listing (GET /v1/templates/:id)', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.listing?.id === listingId, 'Listing id mismatch');
  assert(body.data.listing.title === 'Test Template Listing', 'Title mismatch');
  assert(body.data.listing.description === 'A test listing for the template gallery', 'Description mismatch');
  assert(body.data.listing.category === 'theme', 'Category mismatch');
  assert(Array.isArray(body.data.reviews), 'Expected reviews array');
  assert(Array.isArray(body.data.discussions), 'Expected discussions array');
});

// ═══════════════════════════════════════════════════════════════════════
// Test 3: List with filters (GET /v1/templates?category=&featured=&sort=)
// ═══════════════════════════════════════════════════════════════════════

console.log('\nTest — Listing Filters');

await test('List templates with category filter', async () => {
  const { status, body } = await json('/v1/templates?category=theme');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(body.data?.templates), 'Expected templates array');
  const found = body.data.templates.find((t: any) => t.id === listingId);
  assert(found, 'Our listing should appear with category=theme filter');
});

await test('List templates with featured=false filter', async () => {
  const { status, body } = await json('/v1/templates?featured=false');
  assert(status === 200, `Expected 200, got ${status}`);
  // Our listing is not featured, so it should appear
  const found = body.data.templates.find((t: any) => t.id === listingId);
  assert(found, 'Non-featured listing should appear with featured=false');
});

await test('List templates with sort=newest', async () => {
  const { status, body } = await json('/v1/templates?sort=newest');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.templates?.length >= 1, 'Expected at least 1 template');
});

await test('List templates with non-existent category returns empty', async () => {
  const { status, body } = await json('/v1/templates?category=nonexistent-xyz');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.templates?.length === 0, `Expected 0 templates, got ${body.data?.templates?.length}`);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 4: Add review (POST /v1/templates/:id/review) — verify rating recalculation
// ═══════════════════════════════════════════════════════════════════════

console.log('\nTest — Reviews');

await test('Add review (POST /v1/templates/:id/review)', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}/review`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ rating: 5, comment: 'Excellent template!' }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.review?.rating === 5, 'Rating mismatch');
  assert(body.data.review.comment === 'Excellent template!', 'Comment mismatch');
});

await test('Verify rating recalculated after review', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data.listing.rating === 5, `Expected rating=5, got ${body.data.listing.rating}`);
  assert(body.data.listing.reviewCount === 1, `Expected reviewCount=1, got ${body.data.listing.reviewCount}`);
});

await test('Second owner adds review', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}/review`, {
    method: 'POST',
    headers: authed(owner2Token),
    body: JSON.stringify({ rating: 3, comment: 'Decent but could improve' }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.review?.rating === 3, 'Rating mismatch');
});

await test('Verify average rating after two reviews', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}`);
  assert(status === 200, `Expected 200, got ${status}`);
  // Average of 5 and 3 = 4
  assert(body.data.listing.rating === 4, `Expected rating=4, got ${body.data.listing.rating}`);
  assert(body.data.listing.reviewCount === 2, `Expected reviewCount=2, got ${body.data.listing.reviewCount}`);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 5: Update review — verify upsert behavior
// ═══════════════════════════════════════════════════════════════════════

await test('Update review (upsert) — same author gets 200', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}/review`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ rating: 4, comment: 'Updated: still good' }),
  });
  assert(status === 200, `Expected 200 for upsert, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.review?.rating === 4, 'Updated rating mismatch');
  assert(body.data.review.comment === 'Updated: still good', 'Updated comment mismatch');
});

await test('Verify rating recalculated after update', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}`);
  assert(status === 200, `Expected 200, got ${status}`);
  // Average of 4 (updated) and 3 = 3.5, rounded to nearest integer depends on implementation
  const rating = body.data.listing.rating;
  assert(rating >= 3 && rating <= 4, `Expected rating between 3 and 4, got ${rating}`);
  assert(body.data.listing.reviewCount === 2, `Expected reviewCount=2 (no new review), got ${body.data.listing.reviewCount}`);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 6: Add discussion (POST /v1/templates/:id/discussion) — verify threading
// ═══════════════════════════════════════════════════════════════════════

console.log('\nTest — Discussions');

await test('Add discussion message (POST /v1/templates/:id/discussion)', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}/discussion`, {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({ message: 'How do I customize the theme colors?' }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.discussion?.message === 'How do I customize the theme colors?', 'Message mismatch');
  assert(body.data.discussion.listingId === listingId, 'listingId mismatch');
  discussionId = body.data.discussion.id;
});

await test('Add threaded reply (with parentId)', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}/discussion`, {
    method: 'POST',
    headers: authed(owner2Token),
    body: JSON.stringify({
      message: 'You can override the CSS variables in the extension component.',
      parentId: discussionId,
    }),
  });
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.discussion?.parentId === discussionId, 'parentId should reference original message');
});

await test('List discussions (GET /v1/templates/:id/discussions)', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}/discussions`);
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.data?.discussions?.length >= 2, `Expected >= 2 discussions, got ${body.data?.discussions?.length}`);
  // Verify threading: at least one has a parentId
  const threaded = body.data.discussions.filter((d: any) => d.parentId);
  assert(threaded.length >= 1, 'Expected at least one threaded reply');
});

// ═══════════════════════════════════════════════════════════════════════
// Test 7: Update listing (PATCH /v1/templates/:id)
// ═══════════════════════════════════════════════════════════════════════

console.log('\nTest — Listing Updates');

await test('Update listing (PATCH /v1/templates/:id)', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}`, {
    method: 'PATCH',
    headers: authed(ownerToken),
    body: JSON.stringify({
      title: 'Updated Template Title',
      description: 'Updated description for the listing',
      tags: ['test', 'gallery', 'updated'],
    }),
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.listing?.title === 'Updated Template Title', 'Title not updated');
  assert(body.data.listing.description === 'Updated description for the listing', 'Description not updated');
  assert(body.data.listing.tags.includes('updated'), 'Tags not updated');
});

// ═══════════════════════════════════════════════════════════════════════
// Test 8: UNIQUE constraint — one listing per packageGroupId
// ═══════════════════════════════════════════════════════════════════════

await test('UNIQUE constraint: duplicate listing for same packageGroupId returns 409', async () => {
  const { status } = await json('/v1/templates', {
    method: 'POST',
    headers: authed(ownerToken),
    body: JSON.stringify({
      packageGroupId: groupId,
      title: 'Duplicate Listing',
      description: 'Should fail',
    }),
  });
  assert(status === 409, `Expected 409, got ${status}`);
});

// ═══════════════════════════════════════════════════════════════════════
// Test 9: Delete listing (DELETE /v1/templates/:id)
// ═══════════════════════════════════════════════════════════════════════

await test('Delete listing (DELETE /v1/templates/:id)', async () => {
  const { status, body } = await json(`/v1/templates/${listingId}`, {
    method: 'DELETE',
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.data?.deleted === true, 'Expected deleted=true');
});

await test('Deleted listing returns 404', async () => {
  const { status } = await json(`/v1/templates/${listingId}`);
  assert(status === 404, `Expected 404, got ${status}`);
});

// ═══════════════════════════════════════════════════════════════════════
// Cleanup: cascade delete owners
// ═══════════════════════════════════════════════════════════════════════

console.log('\nCleanup');

await test('Cascade delete first owner', async () => {
  const { status } = await json(`/v1/owners/${ownerName}`, {
    method: 'DELETE',
    headers: authed(ownerToken),
  });
  assert(status === 200, `Expected 200, got ${status}`);
});

await test('Cascade delete second owner', async () => {
  const { status } = await json(`/v1/owners/${owner2Name}`, {
    method: 'DELETE',
    headers: authed(owner2Token),
  });
  assert(status === 200, `Expected 200, got ${status}`);
});

// ─── Summary ─────────────────────────────────────────────────────────

console.log(`\n=== Template Listing Repository: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
