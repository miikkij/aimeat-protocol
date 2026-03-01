import { describe, it, expect } from 'vitest';
import { getProfileFieldNames } from '../../src/services/profile-schemas.js';

describe('getProfileFieldNames', () => {
  it('returns array of profile field names', () => {
    const fields = getProfileFieldNames();
    expect(Array.isArray(fields)).toBe(true);
    expect(fields.length).toBeGreaterThan(0);
  });

  it('includes standard profile fields', () => {
    const fields = getProfileFieldNames();
    expect(fields).toContain('interests');
    expect(fields).toContain('location');
    expect(fields).toContain('bio');
    expect(fields).toContain('seeking');
    expect(fields).toContain('availability');
    expect(fields).toContain('languages');
  });

  it('returns exactly 6 standard profile fields', () => {
    const fields = getProfileFieldNames();
    expect(fields).toHaveLength(6);
  });

  it('returns strings only', () => {
    const fields = getProfileFieldNames();
    for (const field of fields) {
      expect(typeof field).toBe('string');
      expect(field.length).toBeGreaterThan(0);
    }
  });
});
