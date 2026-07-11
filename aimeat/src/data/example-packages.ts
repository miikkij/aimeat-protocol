/**
 * @file example-packages.ts
 * @description Example package definitions for seeding. Used by both the admin
 *   seed endpoint (POST /v1/admin/seed-examples) and the CLI seed script.
 * @structure
 *   - getExamplePackages() — returns all example package definitions
 *   - buildRecords() — builds ready-to-store PackageRecord + TemplateListingRecord
 * @usage
 *   import { getExamplePackages, buildRecords } from '../data/example-packages.js';
 * @version-history
 *   v1.0.0 — 2026-03-16 — initial implementation, extracted from seed-digital-signage.ts
 *   v1.1.0 — 2026-03-16 — fix admin app: pass version for optimistic locking on
 *     memory PUT, fix double-stringification of values; fix memoryInit entries format
 *   v1.2.0 — 2026-03-17 — rename Ad Slots to Rotated Views; add edit capability;
 *     support image/HTML/URL content types; layout modes (fullscreen/header/full);
 *     light+dark themes with accent colour; AI prompt helper for HTML views
 *   v1.3.0 — 2026-05-05 — rewrite cortex manifest with proper components array,
 *     .js lib filenames, tags, exports, and api_surface metadata
 *   v1.4.0 — 2026-07-11 — Rebuild the digital-signage package for the AGENT-FACED document model
 *     (TARGET-029): it now bundles TWO apps (Signage Admin + Signage Kiosk) and drops the old
 *     CSM/memory-init/cortex — signage content lives as shared workspace DOCUMENTS in the owner's OWN
 *     private organism (per-user isolation), configured from the admin app, not seeded into memory.
 *     The package def moved to digital-signage-package.ts (apps inlined from packages/digital-signage/).
 *     See the Handbook page "Agent-faced apps via shared documents".
 */

import { createHash, randomUUID } from 'node:crypto';
import type { PackageRecord, PackageComponent, TemplateListingRecord } from '../storage/interface.js';
import { digitalSignagePackage } from './digital-signage-package.js';
import { aimeatIamPackage } from './aimeat-iam-package.js';
import { aimeatMarketplacePackage } from './aimeat-marketplace-package.js';

// ── Types ────────────────────────────────────────────────────────────

export interface ExamplePackageDef {
  name: string;
  description: string;
  category: string;
  tags: string[];
  visibility: 'public' | 'private';
  components: { id: string; type: string; label: string; content: string; dependencies: string[] }[];
  templateListing: {
    title: string;
    description: string;
    category: string;
    tags: string[];
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function generateVersion(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `v${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

// ── Public API ───────────────────────────────────────────────────────

/** Get all example package definitions. */
export function getExamplePackages(): ExamplePackageDef[] {
  return [digitalSignagePackage(), aimeatIamPackage(), aimeatMarketplacePackage()];
}

/**
 * Build ready-to-store PackageRecord + TemplateListingRecord for an example.
 * The package is created as 'published' so it's immediately installable.
 */
export function buildRecords(def: ExamplePackageDef, author: string, authorGhii: string): {
  pkg: PackageRecord;
  listing: TemplateListingRecord;
} {
  const now = new Date().toISOString();
  const pkgId = randomUUID();
  const packageGroupId = `${def.name}::${author}`;
  const version = generateVersion();

  const components: PackageComponent[] = def.components.map(c => ({
    id: c.id,
    type: c.type as PackageComponent['type'],
    label: c.label,
    content: c.content,
    contentHash: hashContent(c.content),
    dependencies: c.dependencies,
  }));

  const pkg: PackageRecord = {
    id: pkgId,
    packageGroupId,
    name: def.name,
    author,
    authorGhii,
    version,
    changelog: 'Initial version (example package)',
    description: def.description,
    category: def.category,
    tags: def.tags,
    visibility: def.visibility,
    status: 'published',
    components,
    manifest: '',
    createdAt: now,
    updatedAt: now,
  };

  const listing: TemplateListingRecord = {
    id: randomUUID(),
    packageGroupId,
    packageName: def.name,
    packageAuthor: author,
    publishedBy: author,
    publishedByGhii: authorGhii,
    title: def.templateListing.title,
    description: def.templateListing.description,
    screenshots: [],
    category: def.templateListing.category,
    tags: def.templateListing.tags,
    featured: false,
    installCount: 0,
    rating: 0,
    reviewCount: 0,
    status: 'listed',
    createdAt: now,
    updatedAt: now,
  };

  return { pkg, listing };
}
