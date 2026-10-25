/**
 * @file test/unit/html-document-element.test.ts
 * @description The `<html>` tag is found outside comments and raw-text elements
 *   (src/utils/html-document-element.ts), and the three callers follow: markDocumentElement through
 *   the real serve pass, the author-attribute reader, and the publish strip.
 *
 *   The case that made it: Lifecycle Central opens with a version-history comment, and a `<html>` in
 *   that comment took the node's `ai-disclosure` attribute instead of the real tag (2026-10-25).
 * @usage pnpm exec vitest run test/unit/html-document-element.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { findDocumentElement } from '../../src/utils/html-document-element.js';
import { applyServeMarks } from '../../src/services/app-serve-marks.js';
import { stripServedMarks } from '../../src/services/app-serve-marks-strip.js';
import { authorDisclosure } from '../../src/services/ai-disclosure-author.js';
import { provFixture } from './serve-marks-fixtures.js';

const tagOf = (text: string): string | null => {
  const el = findDocumentElement(text);
  return el ? text.slice(el.start, el.end) : null;
};

/** The shape of Lifecycle Central's opening: a manifest comment that names the document element. */
const COMMENTED_DOC = '<!DOCTYPE html>\n<!-- App manifest\n  3.8.1: the value on the document element <html> changed -->\n'
  + '<html lang="en" data-theme="dark"><head><title>t</title></head><body><p>x</p></body></html>';

describe('findDocumentElement', () => {
  it('finds the real tag, with its attribute text', () => {
    expect(findDocumentElement('<!doctype html><html lang="en"><head></head></html>'))
      .toEqual({ start: 15, end: 31, attrs: ' lang="en"' });
    expect(tagOf('<!DOCTYPE html><HTML LANG="fi"><head></head></HTML>')).toBe('<HTML LANG="fi">');
    expect(tagOf('<html><body></body></html>')).toBe('<html>');
  });

  it('skips a <html> inside a comment or a raw-text element', () => {
    expect(tagOf(COMMENTED_DOC)).toBe('<html lang="en" data-theme="dark">');
    expect(tagOf('<script>var s = "<html lang=x>";</script><html lang="en"><body></body></html>'))
      .toBe('<html lang="en">');
  });

  it('finds nothing it cannot be sure of', () => {
    expect(tagOf('<!-- <html lang="en"> never closes')).toBeNull();
    expect(tagOf('<htmlx><body></body>')).toBeNull();
    expect(tagOf(`<!doctype html>${' '.repeat(600)}<html lang="en">`)).toBeNull();
  });
});

describe('the callers use it', () => {
  it('the serve pass marks the real tag and leaves the comment as written', () => {
    const served = applyServeMarks(COMMENTED_DOC, { isDocument: true, provenance: provFixture('labelled') }).toString('utf-8');
    expect(served).toContain('the document element <html> changed -->');
    expect(served).toContain('<html lang="en" data-theme="dark" ai-disclosure="ai-autonomous">');
  });

  it('the strip takes the attribute back from the real tag', () => {
    const served = applyServeMarks(COMMENTED_DOC, { isDocument: true, provenance: provFixture('labelled') });
    const out = stripServedMarks(served);
    expect(out.data.toString('utf-8')).toBe(COMMENTED_DOC);
    expect(out.removed.map((r) => r.mark)).toEqual(['ai-disclosure']);
  });

  it('the author reader does not read a comment as a declaration', () => {
    const doc = '<!-- <html ai-disclosure="human-only"> --><html lang="en"><head></head></html>';
    expect(authorDisclosure(doc).documentElement).toBeNull();
    expect(authorDisclosure('<!-- x --><html ai-disclosure="human-only"><head></head></html>').documentElement)
      .toBe('human-only');
  });
});
