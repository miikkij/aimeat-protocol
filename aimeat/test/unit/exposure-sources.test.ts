/**
 * @file exposure-sources.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The exposure report's registry and its honesty rules (services/exposure/). Every kind
 *   in KINDS has exactly one source in EXPOSURE_SOURCES; a stored visibility string maps to the level
 *   the report names (an 'organism:<id>' string included, which other changes are adding to more
 *   kinds); a kind past the item cap is named in `capped` while its count stays whole; a source that
 *   throws is named in `failed` and the rest of the report stands; a record the caller's
 *   classification reader hides is counted and not listed.
 * @usage cd aimeat && pnpm exec vitest run test/unit/exposure-sources.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V6.1).
 */
import { describe, it, expect } from 'vitest';
import { KINDS, EXPOSURE_ITEM_CAP, levelOfVisibility, createExposureContext } from '../../src/services/exposure/exposure-types.js';
import { EXPOSURE_SOURCES, sourceFor } from '../../src/services/exposure/exposure-sources.js';
import { buildExposureReport } from '../../src/services/exposure/exposure-report.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import type { ContentReader } from '../../src/services/classification/reader.js';

/** The kinds the report promises, written out here so a change to KINDS shows in this file's diff. */
const EXPECTED_KINDS = [
  'memory', 'file', 'app', 'workspace_share', 'organism', 'board', 'knowledge', 'package',
  'datapackage', 'skill', 'portfolio', 'company', 'exchange', 'agent',
];

describe('the exposure registry', () => {
  it('has one source for every kind, and no source without a kind', () => {
    expect([...KINDS]).toEqual(EXPECTED_KINDS);
    for (const kind of KINDS) {
      expect(EXPOSURE_SOURCES.filter(s => s.kind === kind), `sources for ${kind}`).toHaveLength(1);
      expect(sourceFor(kind)?.kind).toBe(kind);
    }
    expect(EXPOSURE_SOURCES).toHaveLength(KINDS.length);
  });
});

describe('levelOfVisibility', () => {
  it('names public, signed-in and one organism, and nothing else', () => {
    expect(levelOfVisibility('public')).toEqual({ level: 'public' });
    expect(levelOfVisibility('members')).toEqual({ level: 'signed-in' });
    expect(levelOfVisibility('organism:org-7')).toEqual({ level: 'organism', organism_id: 'org-7' });
    for (const closed of ['private', 'owner', 'group', 'workspace', 'shared', 'system', '', undefined, null, 'organism:', 'organism:bad id']) {
      expect(levelOfVisibility(closed), String(closed)).toBeNull();
    }
  });
});

/** A reader that hides nothing: the node's own work, as services/classification/reader.ts answers it. */
const SEES_ALL = { show: async <T>(items: readonly T[]) => [...items] } as unknown as ContentReader;

const NODE = 'node-x';
const config = { nodeId: NODE, baseUrl: 'https://n.example', appOriginEnabled: false } as unknown as AimeatConfig;

/** A store that holds `memory` public rows for alice and answers every other list empty; `broken` throws. */
function stubStorage(memory: number, broken: string[] = []): Storage {
  const rows = Array.from({ length: memory }, (_, i) => ({
    key: `notes.n${String(i).padStart(4, '0')}`, ownerGaii: `alice@${NODE}`, visibility: 'public', tags: [],
    version: 1, flagCount: 0, byteSize: 1, createdAt: '', updatedAt: '',
  }));
  rows.push({ key: 'notes.secret', ownerGaii: `alice@${NODE}`, visibility: 'private', tags: [], version: 1, flagCount: 0, byteSize: 1, createdAt: '', updatedAt: '' });
  rows.push({ key: 'notes.club', ownerGaii: `alice@${NODE}`, visibility: 'organism:club-1', tags: [], version: 1, flagCount: 0, byteSize: 1, createdAt: '', updatedAt: '' });
  const answers: Record<string, unknown> = {
    getAgentsByOwner: [], getEcosystemAppsByOwner: [], listMemoryMetaForOwners: rows,
    listStorageFilesForOwners: {}, listApps: { apps: [], total: 0 }, listMembershipsByGhii: [],
    getOrganism: null, listBoards: [], getMemory: null, listPackages: { packages: [], total: 0 },
    listStorageFiles: [], getStorageFile: null, listCompanies: [], listAllMemory: { items: [], total: 0 },
    listSubdomainSites: [], listGHIIs: [], getAgentsByOwners: {}, listMemoryForOwners: [],
  };
  return new Proxy({}, {
    get: (_t, name: string) => async () => {
      if (broken.includes(name)) throw new Error(`${name} is down`);
      if (!(name in answers)) throw new Error(`the stub does not answer ${name}`);
      return answers[name];
    },
  }) as Storage;
}

describe('buildExposureReport', () => {
  it('caps the item list of a kind and keeps its count whole', async () => {
    const report = await buildExposureReport(createExposureContext(stubStorage(EXPOSURE_ITEM_CAP + 20), config), 'alice', SEES_ALL);
    expect(report.failed).toEqual([]);
    expect(report.capped).toEqual(['memory']);
    expect(report.counts.by_kind.memory).toEqual({ public: EXPOSURE_ITEM_CAP + 20, link: 0, 'signed-in': 0, organism: 1 });
    expect(report.items.filter(i => i.kind === 'memory')).toHaveLength(EXPOSURE_ITEM_CAP);
    expect(report.items.some(i => i.id === 'notes.secret')).toBe(false);
    expect(report.owner).toBe(`alice@${NODE}`);
  });

  it('lists the widest level first and names the organism of an organism-level record', async () => {
    const report = await buildExposureReport(createExposureContext(stubStorage(2), config), 'alice', SEES_ALL);
    expect(report.items.map(i => i.level)).toEqual(['public', 'public', 'organism']);
    const club = report.items.find(i => i.id === 'notes.club');
    expect(club?.organism_id).toBe('club-1');
    expect(club?.url).toBeUndefined();
    expect(report.items[0].url).toBe(`https://n.example/v1/memory/${encodeURIComponent(`alice@${NODE}`)}/notes.n0000`);
    expect(report.items.every(i => i.how_to_close.length > 0)).toBe(true);
  });

  it('names a source that could not be read in `failed` and keeps the rest', async () => {
    const report = await buildExposureReport(createExposureContext(stubStorage(1, ['listBoards']), config), 'alice', SEES_ALL);
    expect(report.failed).toEqual(['board']);
    expect(report.counts.by_kind.memory?.public).toBe(1);
  });

  it('counts a record the reader hides and does not list it, nor hand out its content address', async () => {
    const hidesClub = {
      show: async <T>(items: readonly T[], targetOf: (item: T) => { key?: string } | null) =>
        items.filter(i => targetOf(i)?.key !== 'notes.club'),
    } as unknown as ContentReader;
    const report = await buildExposureReport(createExposureContext(stubStorage(1), config), 'alice', hidesClub);
    expect(report.items.some(i => i.id === 'notes.club')).toBe(false);
    expect(report.counts.by_kind.memory?.organism).toBe(1);
    expect(report.hidden_by_classification).toBe(1);
    expect(report.items.every(i => !('content' in i))).toBe(true);
  });
});
