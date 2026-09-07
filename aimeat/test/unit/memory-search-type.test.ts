/**
 * The type filter behind `?type=` on memory search, on all three doors.
 *
 * The one behaviour worth locking is that it compares EXPANDED forms. A record's writer chooses a
 * spelling — `schema:Person`, `https://schema.org/Person`, or a bare `Person` under their own
 * context — and a caller filtering by type does not know which was used. Comparing the strings
 * would make the filter answer correctly only when both sides happened to agree, which is the kind
 * of half-working that looks like an empty store.
 */
import { describe, it, expect } from 'vitest';
import { matchesType, typeOfRecord } from '../../src/services/memory-search-shape.js';

describe('typeOfRecord', () => {
  it('reads a string type', () => {
    expect(typeOfRecord({ '@type': 'schema:Person' })).toBe('schema:Person');
  });

  it('takes the first of an array type', () => {
    expect(typeOfRecord({ '@type': ['schema:Person', 'aimeat:GHII'] })).toBe('schema:Person');
  });

  it('is null for anything that is not a typed object', () => {
    for (const v of [null, undefined, 'text', 42, [], {}, { type: 'Person' }]) {
      expect(typeOfRecord(v)).toBeNull();
    }
  });

  it('does not go hunting through nested objects', () => {
    // A type three levels down belongs to something the record CONTAINS, not to the record.
    expect(typeOfRecord({ items: [{ '@type': 'schema:Person' }] })).toBeNull();
  });
});

describe('matchesType', () => {
  it('matches the same spelling', () => {
    expect(matchesType({ '@type': 'schema:Person' }, ['schema:Person'])).toBe(true);
  });

  it('matches a prefixed query against a full-IRI record, and the other way round', () => {
    expect(matchesType({ '@type': 'https://schema.org/Person' }, ['schema:Person'])).toBe(true);
    expect(matchesType({ '@type': 'schema:Person' }, ['https://schema.org/Person'])).toBe(true);
  });

  it('honours a record that remapped a prefix in its own context', () => {
    const rec = { '@context': { s: 'https://schema.org/' }, '@type': 's:Person' };
    expect(matchesType(rec, ['schema:Person'])).toBe(true);
  });

  it('refuses a different type', () => {
    expect(matchesType({ '@type': 'schema:Event' }, ['schema:Person'])).toBe(false);
  });

  it('matches any of several', () => {
    expect(matchesType({ '@type': 'aimeat:Task' }, ['schema:Person', 'aimeat:Task'])).toBe(true);
  });

  it('tolerates whitespace, because the wire form is a comma-separated string', () => {
    expect(matchesType({ '@type': 'aimeat:Task' }, [' aimeat:Task '])).toBe(true);
  });

  it('excludes an untyped record when a type was asked for', () => {
    // The alternative — letting untyped records through — would make the filter useless on the
    // store it is meant to narrow, which is mostly untyped today.
    expect(matchesType({ name: 'Anna' }, ['schema:Person'])).toBe(false);
    expect(matchesType('a string value', ['schema:Person'])).toBe(false);
  });

  it('keeps everything when nothing was asked for', () => {
    expect(matchesType({ name: 'Anna' }, [])).toBe(true);
  });
});
