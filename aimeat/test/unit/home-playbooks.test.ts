/**
 * @file home-playbooks.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the playbook offer promises, and what it refuses to promise.
 *
 *   Two things are worth a test here and neither is visible in a browser on a fresh node. First,
 *   a playbook whose capability is switched off must be ABSENT rather than offered — selling a
 *   marketplace on a node with commerce off is the failure the presence check exists for. Second,
 *   proof links resolve from THIS node's own subdomain mappings: a candidate the node does not
 *   have, or has disabled, contributes nothing, so no node can ever advertise another node's apps.
 * @version-history
 *   v1.0.0 — 2026-08-19 — With the playbooks.
 */
import { describe, it, expect } from 'vitest';
import { openPlaybooks, PLAYBOOKS } from '../../src/services/home-playbooks.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

/** A storage that knows about exactly the subdomains it is given. */
const storageWith = (sites: Record<string, { enabled: boolean }>): Storage => ({
  getSubdomainSite: async (sub: string) =>
    (sites[sub] ? { subdomain: sub, kind: 'app', target: 'x/y.html', enabled: sites[sub].enabled,
      createdBy: 'op', createdAt: '', updatedAt: '' } : null),
} as unknown as Storage);

const cfg = (over: Partial<AimeatConfig> = {}): AimeatConfig => ({
  appHost: 'apps.example.test',
  commerceEnabled: true,
  ...over,
} as unknown as AimeatConfig);

describe('the playbooks a node offers', () => {
  it('offers the marketplace only where the money layer is switched on', async () => {
    const on = await openPlaybooks(storageWith({}), cfg({ commerceEnabled: true }));
    const off = await openPlaybooks(storageWith({}), cfg({ commerceEnabled: false }));
    expect(on.map(p => p.id)).toContain('marketplace');
    expect(off.map(p => p.id)).not.toContain('marketplace');
    // The rest of the offer survives: one capability being off closes one door, not the corridor.
    expect(off.map(p => p.id)).toContain('page');
  });

  it('carries every playbook a step count the locale files must answer for', async () => {
    const open = await openPlaybooks(storageWith({}), cfg());
    for (const pb of open) expect(pb.steps).toBeGreaterThan(0);
    expect(open.length).toBeGreaterThanOrEqual(3);
  });

  it('proves a playbook only with apps THIS node actually serves', async () => {
    const marketplace = PLAYBOOKS.find(p => p.id === 'marketplace');
    expect(marketplace?.proof?.length, 'the marketplace names proof candidates').toBeGreaterThan(0);
    const candidate = marketplace!.proof![0];

    // Present and enabled → a link built from this node's own app host.
    const withProof = await openPlaybooks(storageWith({ [candidate]: { enabled: true } }), cfg());
    const shown = withProof.find(p => p.id === 'marketplace')!;
    expect(shown.proof).toEqual([{ name: candidate, url: `https://${candidate}.apps.example.test` }]);

    // Absent → nothing. This is the case on every node that is not the one those apps live on.
    const noSite = await openPlaybooks(storageWith({}), cfg());
    expect(noSite.find(p => p.id === 'marketplace')!.proof).toEqual([]);

    // Present but switched OFF → still nothing: a disabled mapping is a page the operator took
    // down, and linking to it would be proof of the opposite.
    const disabled = await openPlaybooks(storageWith({ [candidate]: { enabled: false } }), cfg());
    expect(disabled.find(p => p.id === 'marketplace')!.proof).toEqual([]);
  });

  it('offers the playbook without proof when the lookup itself fails', async () => {
    const brokenStorage = {
      getSubdomainSite: async () => { throw new Error('database is having a day'); },
    } as unknown as Storage;
    const open = await openPlaybooks(brokenStorage, cfg());
    // The recipe is still worth having; only its proof is missing.
    expect(open.find(p => p.id === 'marketplace')!.proof).toEqual([]);
  });

  it('names a managed prompt for every playbook, and never the same one twice', () => {
    const prompts = PLAYBOOKS.map(p => p.prompt);
    expect(new Set(prompts).size).toBe(prompts.length);
    for (const p of prompts) expect(p).toMatch(/^playbook-/);
  });
});
