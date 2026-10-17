/**
 * @file app-publish-exposure.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How exposed a published version is (services/app-publish-exposure.ts): an update
 *   carries the live version's state whatever the node's defaults say; a first publish takes them.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-publish-exposure.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V2.4).
 */
import { describe, it, expect } from 'vitest';
import { publishExposure, generateAccessCode } from '../../src/services/app-publish-exposure.js';
import type { AppRecord } from '../../src/storage/interface.js';

const strict = { appDefaultListing: 'unlisted' as const, appDefaultAccess: 'signed-in' as const, appDefaultAccessCode: true };
const open = { appDefaultListing: 'listed' as const, appDefaultAccess: 'anyone' as const, appDefaultAccessCode: false };

describe('a first publish takes the node defaults', () => {
  it('listed and open to anyone on a node that says so (the code default)', () => {
    expect(publishExposure(open, null, { mode: 'carry' })).toEqual({ parked: false, community: false, forkable: false, accessCode: undefined, access: undefined });
    expect(publishExposure({}, null, { mode: 'carry' })).toEqual({ parked: false, community: false, forkable: false, accessCode: undefined, access: undefined });
  });
  it('unlisted, signed-in and a generated code on a strict node', () => {
    const e = publishExposure(strict, null, { mode: 'carry' });
    expect(e.parked).toBe(true);
    expect(e.community).toBe(false);
    expect(e.access).toBe('signed-in');
    expect(e.accessCode).toMatch(/^[a-z2-9]{8}$/);
  });
  it('community listing', () => {
    expect(publishExposure({ appDefaultListing: 'community' }, null, { mode: 'carry' })).toMatchObject({ parked: true, community: true });
  });
  it('a code the publisher names wins over a generated one, and an explicit empty code means none', () => {
    expect(publishExposure(strict, null, { mode: 'explicit', value: 'mine1234' }).accessCode).toBe('mine1234');
    expect(publishExposure(strict, null, { mode: 'explicit', value: undefined }).accessCode).toBeUndefined();
  });
});

describe('an update carries the live state, whatever the defaults', () => {
  const live = { parked: false, community: false, forkable: true, accessCode: undefined, access: undefined } as unknown as AppRecord;
  it('an app the owner opened stays open on a strict node', () => {
    expect(publishExposure(strict, live, { mode: 'carry' })).toEqual({ parked: false, community: false, forkable: true, accessCode: undefined, access: undefined });
  });
  it('a sign-in, a code and a community listing survive a new version', () => {
    const gated = { parked: true, community: true, forkable: false, accessCode: 'abcd2345', access: 'organism:org-1' } as unknown as AppRecord;
    expect(publishExposure(open, gated, { mode: 'carry' })).toEqual({ parked: true, community: true, forkable: false, accessCode: 'abcd2345', access: 'organism:org-1' });
  });
});

describe('generated codes', () => {
  it('are eight characters without look-alikes and differ', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateAccessCode()));
    expect(codes.size).toBe(50);
    for (const c of codes) expect(c).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
  });
});
