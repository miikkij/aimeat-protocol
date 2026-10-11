/**
 * @file test/unit/event-bus-record-change.test.ts
 * @description Who is told that a stored record or file changed (services/event-bus.ts
 *   emitRecordChange). A record only its owner reads is the owner's event; everything else is
 *   global as before. The edges are held here because each one is a way to tell too many people
 *   (a private write that wakes every open page) or too few (a public record that went private and
 *   nobody who was reading it heard).
 * @usage cd aimeat && pnpm vitest run test/unit/event-bus-record-change.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  emitRecordChange, isOwnerOnlyChange, onChangeEvent, offChangeEvent, type ChangeEvent,
} from '../../src/services/event-bus.js';

const GHII = 'alice@node-test';
const GAII = 'bot#alice@node-test';

describe('isOwnerOnlyChange', () => {
  it('is true for a private or owner-visible record of an account', () => {
    expect(isOwnerOnlyChange(GHII, 'private')).toBe(true);
    expect(isOwnerOnlyChange(GHII, 'owner')).toBe(true);
    expect(isOwnerOnlyChange(GAII, 'private')).toBe(true);
  });

  it('is false for every visibility other people read', () => {
    for (const v of ['public', 'group', 'workspace', 'members']) expect(isOwnerOnlyChange(GHII, v), v).toBe(false);
  });

  it('is false when the record was readable by others before OR after the write', () => {
    expect(isOwnerOnlyChange(GHII, 'private', 'public')).toBe(false);
    expect(isOwnerOnlyChange(GHII, 'public', 'private')).toBe(false);
    expect(isOwnerOnlyChange(GHII, 'private', 'owner')).toBe(true);
  });

  it('is false when the visibility is not known, so an unknown case stays global', () => {
    expect(isOwnerOnlyChange(GHII)).toBe(false);
    expect(isOwnerOnlyChange(GHII, undefined)).toBe(false);
    expect(isOwnerOnlyChange(GHII, null)).toBe(false);
    expect(isOwnerOnlyChange(GHII, 'private', undefined)).toBe(false);
    expect(isOwnerOnlyChange(GHII, 'something-new')).toBe(false);
  });

  it('is false for a namespace that is no account: no stream would match it and nobody would hear', () => {
    expect(isOwnerOnlyChange('ext:tv-opas-epg', 'private')).toBe(false);
    expect(isOwnerOnlyChange('', 'private')).toBe(false);
    expect(isOwnerOnlyChange(undefined, 'private')).toBe(false);
    expect(isOwnerOnlyChange(null, 'private')).toBe(false);
  });
});

describe('emitRecordChange', () => {
  const seen: ChangeEvent[] = [];
  const handler = (evt: ChangeEvent): void => { seen.push(evt); };
  afterEach(() => { offChangeEvent(handler); seen.length = 0; });

  it('carries the owner for a private record and none for a public one', () => {
    onChangeEvent(handler);
    emitRecordChange('memory', GAII, 'private');
    emitRecordChange('files', GHII, 'public');
    emitRecordChange('memory', GHII, 'private', 'public');
    expect(seen.map(e => [e.domain, e.ownerGaii])).toEqual([
      ['memory', GAII],
      ['files', undefined],
      ['memory', undefined],
    ]);
  });
});
