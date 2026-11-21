/**
 * @file test/unit/agent-face-text.test.ts
 * @description A stored agent face that is a JSON-encoded string (a quoted value with literal \n)
 *   is served as the markdown it encodes (appdev pitfall publish/agentface-value-must-be-plain-text).
 *   Every agent reading the app was served the escaped text, quotes and backslashes included.
 *
 *   FIRST FAIL: faceText did not exist; the face was served as stored.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { faceText } from '../../src/services/agent/face.js';

describe('faceText', () => {
  it('decodes a JSON-encoded face once', () => {
    expect(faceText('"# Shop\\n\\n## Orders\\n3 open"')).toBe('# Shop\n\n## Orders\n3 open');
  });

  it('serves plain markdown as it is, quotes inside it included', () => {
    expect(faceText('# Shop\n\nSay "hello".')).toBe('# Shop\n\nSay "hello".');
    expect(faceText('"quoted" and more')).toBe('"quoted" and more');
  });

  it('serves a quoted value that is not a valid JSON string as written', () => {
    expect(faceText('"bad \\x escape"')).toBe('"bad \\x escape"');
  });
});
