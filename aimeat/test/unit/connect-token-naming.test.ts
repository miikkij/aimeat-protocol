/**
 * @file connect-token-naming.test.ts
 * @description Regression tests for the connector's token-file identity handling when the owner slug the
 *   user typed is an EMAIL (i.e. contains '@'). Two guards: (1) parseTokenFilename splits on the FIRST
 *   '@' so `{agent}@{owner}.token` decodes to the right agent even when the owner is an email; (2)
 *   ownerHandleFrom always yields the canonical '@'-free handle from the device-token response (gaii),
 *   never the raw --owner, so token filenames are unambiguous in the first place.
 * @version-history
 *   v1.0.0 -- 2026-07-19 -- Cover the email-owner mis-parse bug (serve daemon registered a wrong agent name).
 */
import { describe, it, expect } from 'vitest';
import { parseTokenFilename } from '../../src/cli/connect/keychain.js';
import { ownerHandleFrom } from '../../src/cli/connect/auth.js';

describe('parseTokenFilename — split on the FIRST @', () => {
  it('parses a plain handle owner', () => {
    expect(parseTokenFilename('uutisvahti@jounidude.token')).toEqual({ agent: 'uutisvahti', owner: 'jounidude' });
  });

  it('parses correctly when the owner slug is an email (the bug: last-@ split mis-named the agent)', () => {
    // Previously lastIndexOf('@') → agent "uutisvahti@mail", owner "jounimiikki.com" (both wrong).
    expect(parseTokenFilename('uutisvahti@mail@jounimiikki.com.token'))
      .toEqual({ agent: 'uutisvahti', owner: 'mail@jounimiikki.com' });
  });

  it('rejects non-.token and shapeless names', () => {
    expect(parseTokenFilename('notes.txt')).toBeNull();
    expect(parseTokenFilename('noatsign.token')).toBeNull();
    expect(parseTokenFilename('@leadingat.token')).toBeNull();
    expect(parseTokenFilename('trailingat@.token')).toBeNull();
  });
});

describe('ownerHandleFrom — always the canonical @-free handle', () => {
  const base = { access_token: 'jwt', name: 'uutisvahti' };

  it('derives the handle from the gaii owner segment, ignoring an email --owner', () => {
    const td = { ...base, gaii: 'uutisvahti#jounidude@aimeat-finland-001-genesis' };
    expect(ownerHandleFrom(td, 'mail@jounimiikki.com')).toBe('jounidude');
  });

  it('prefers the gaii even when the response owner is present', () => {
    const td = { ...base, gaii: 'foo#alice@node-1', owner: 'alice' };
    expect(ownerHandleFrom(td, 'alice@example.com')).toBe('alice');
  });

  it('falls back to the response owner when the gaii is unparseable', () => {
    const td = { ...base, gaii: 'garbage', owner: 'bob' };
    expect(ownerHandleFrom(td, 'bob@example.com')).toBe('bob');
  });

  it('last resort: strips the @-suffix from the CLI owner', () => {
    const td = { ...base, gaii: 'garbage' };
    expect(ownerHandleFrom(td, 'carol@example.com')).toBe('carol');
  });

  it('a plain handle --owner passes through unchanged', () => {
    const td = { ...base, gaii: 'foo#dave@node-1' };
    expect(ownerHandleFrom(td, 'dave')).toBe('dave');
  });
});
