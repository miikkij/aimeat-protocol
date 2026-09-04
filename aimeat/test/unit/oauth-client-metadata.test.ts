/**
 * @file test/unit/oauth-client-metadata.test.ts
 * @description A client_id that is a URL, and the four ways it must be refused.
 *
 *   THE MECHANISM IS ONE COMPARISON. A Client ID Metadata Document says who a client is; the URL it
 *   was fetched from says where it lives. If the two are not checked against each other, anybody who
 *   can host a file can serve a copy of another client's metadata and be treated as that client. The
 *   third test is that comparison, and it is the one that would matter if any of these ever went.
 *
 *   AND THE SHAPE IS SSRF. The `client_id` arrives on a PUBLIC endpoint from a stranger and this
 *   node then fetches it, which is the textbook case — `client_id=http://169.254.169.254/…` is the
 *   attack. `isClientIdUrl` refusing everything that is not https is the first fence and the one
 *   testable without a network; safeFetch is the second and validates every redirect hop.
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial, with the feature.
 */
import { describe, it, expect } from 'vitest';
import { isClientIdUrl, parseClientDocument } from '../../src/services/oauth-client-metadata.js';

const SELF = 'https://client.test/mcp-client.json';
const doc = (over: Record<string, unknown>) => JSON.stringify({
  client_id: SELF, client_name: 'Honest Client', redirect_uris: ['https://client.test/cb'], ...over,
});

describe('which client_id strings are the URL form at all', () => {
  it('accepts an https URL, because that is what the mechanism is', () => {
    expect(isClientIdUrl('https://example.test/mcp-client.json')).toBe(true);
    expect(isClientIdUrl('https://example.test/a/b/c.json?v=2')).toBe(true);
  });

  it('refuses a client_id this node minted, so a registered client is never fetched', () => {
    expect(isClientIdUrl('mcp-client-2f8a9c')).toBe(false);
    expect(isClientIdUrl('')).toBe(false);
  });

  it('refuses http, which is the whole SSRF surface and the identity one too', () => {
    // The metadata document IS the client's identity. Fetched over a channel somebody can rewrite,
    // the identity is theirs to choose — and the link-local address is how this becomes a read of
    // the machine's own credentials rather than a client's file.
    expect(isClientIdUrl('http://example.test/client.json')).toBe(false);
    expect(isClientIdUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isClientIdUrl('file:///etc/passwd')).toBe(false);
    expect(isClientIdUrl('ftp://example.test/client.json')).toBe(false);
  });

  it('refuses a fragment, so one document cannot answer to two client_ids', () => {
    // The comparison that decides who a caller is compares STRINGS. Two ids differing only after
    // the hash would fetch one document, and only one of them could match its `client_id`.
    expect(isClientIdUrl('https://example.test/client.json#a')).toBe(false);
  });

  it('refuses a string that is not a URL at all, without throwing', () => {
    // Written first as a try/catch returning false, which the no-silent-catch rule refused: a catch
    // here would read the same as a network failure returning false somewhere else.
    expect(isClientIdUrl('https://')).toBe(false);
    expect(isClientIdUrl('https://[not a host]/x')).toBe(false);
  });
});

describe('what the document itself has to say', () => {
  it('accepts one that names itself and lists somewhere to go back to', () => {
    const out = parseClientDocument(SELF, doc({}));
    expect(out).not.toBeNull();
    expect(out!.clientId).toBe(SELF);
    expect(out!.clientName).toBe('Honest Client');
    expect(out!.redirectUris).toEqual(['https://client.test/cb']);
  });

  it('REFUSES one that names a different client, which is the whole mechanism', () => {
    // Otherwise perfect. It simply claims to be somebody else, and honouring it would let anyone who
    // can host a file serve a copy of another client's metadata and be treated as that client.
    expect(parseClientDocument(SELF, doc({ client_id: 'https://someone-else.test/client.json' }))).toBeNull();
    // Absent counts as different: a document with no client_id has not claimed to be this one.
    expect(parseClientDocument(SELF, doc({ client_id: undefined }))).toBeNull();
    // And so does a non-string, which is where a loose comparison would have let an object through.
    expect(parseClientDocument(SELF, doc({ client_id: { toString: () => SELF } }))).toBeNull();
  });

  it('refuses one with nowhere to send the owner back to', () => {
    expect(parseClientDocument(SELF, doc({ redirect_uris: [] }))).toBeNull();
    expect(parseClientDocument(SELF, doc({ redirect_uris: undefined }))).toBeNull();
    // A list of the wrong type is an empty list, not a crash and not a pass.
    expect(parseClientDocument(SELF, doc({ redirect_uris: [42, null, ''] }))).toBeNull();
  });

  it('refuses bytes that are not a document', () => {
    expect(parseClientDocument(SELF, 'not json at all')).toBeNull();
    expect(parseClientDocument(SELF, '')).toBeNull();
  });

  it('refuses one too large to be a client document', () => {
    // The cap is on the BODY, so a hostile response cannot be a payload. 32 kB is far more than any
    // honest document and far less than anything worth sending here.
    expect(parseClientDocument(SELF, doc({ client_name: 'x'.repeat(40_000) }))).toBeNull();
  });

  it('falls back to the URL when the client left its name blank', () => {
    // This string is what the OWNER reads on the approval screen. An empty one there is a consent
    // dialog asking somebody to trust nobody in particular.
    expect(parseClientDocument(SELF, doc({ client_name: '   ' }))!.clientName).toBe(SELF);
    expect(parseClientDocument(SELF, doc({ client_name: undefined }))!.clientName).toBe(SELF);
  });
});
