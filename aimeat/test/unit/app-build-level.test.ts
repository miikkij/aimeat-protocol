/**
 * @file test/unit/app-build-level.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The level an owner chose, read off the page: which levels owe a register, when a
 *   prototype or an ordinary page is told it has become hand-made work, and what the publish says
 *   back about the level.
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { declaredLevel, registerIsOwed, levelFindings, levelStep } from '../../src/services/app-build-level.js';

const page = (level: string | null, styles = 0) => '<!DOCTYPE html><html><head>'
  + (level === null ? '' : `<meta name="aimeat-level" content="${level}">`)
  + '<style>' + Array.from({ length: styles }, (_, i) => `.mine-part-${i} { color: red; }`).join('\n') + '</style>'
  + '</head><body>' + Array.from({ length: styles }, (_, i) => `<div class="mine-part-${i}"></div>`).join('') + '</body></html>';

describe('the level an owner chose', () => {
  it('reads the three levels and nothing else', () => {
    expect(declaredLevel(page('proto'))).toBe('proto');
    expect(declaredLevel(page(' Plain '))).toBe('plain');
    expect(declaredLevel(page('fine'))).toBe('fine');
    expect(declaredLevel(page('fastest'))).toBeUndefined();
    expect(declaredLevel(page(null))).toBeUndefined();
  });

  it('a register is owed by the finest and by a page that states no level', () => {
    expect(registerIsOwed(page('fine'))).toBe(true);
    expect(registerIsOwed(page(null))).toBe(true);
    expect(registerIsOwed(page('fastest'))).toBe(true);
    expect(registerIsOwed(page('proto'))).toBe(false);
    expect(registerIsOwed(page('plain'))).toBe(false);
  });

  it('a prototype with a sheet of styles of its own is told, and one without is not', () => {
    expect(levelFindings(page('proto', 3))).toEqual([]);
    const told = levelFindings(page('proto', 30));
    expect(told).toHaveLength(1);
    expect(told[0].pitfall).toBe('below-level');
    expect(told[0].severity).toBe('warn');
    expect(told[0].message).toContain('a quick prototype');
    expect(levelFindings(page('plain', 30))[0].message).toContain('an ordinary page');
  });

  it('the finest level and a page with no level are never told about their own styles here', () => {
    expect(levelFindings(page('fine', 30))).toEqual([]);
    expect(levelFindings(page(null, 30))).toEqual([]);
  });

  it('the publish says the level back for the two lower levels only', () => {
    expect(levelStep(page('proto'))).toContain('QUICK PROTOTYPE');
    expect(levelStep(page('plain'))).toContain('ORDINARY PAGE');
    expect(levelStep(page('fine'))).toBeUndefined();
    expect(levelStep(page(null))).toBeUndefined();
  });
});
