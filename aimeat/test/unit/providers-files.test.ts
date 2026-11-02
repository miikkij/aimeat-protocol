/**
 * @file test/unit/providers-files.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SharePoint and OneDrive providers build every Graph address themselves: what each
 *   half asks for, by which sites it may reach, and that no caller parameter can steer a sealed token
 *   to another path. The end-to-end half is test/e2e-files-connections.ts.
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (wish-sharepoint-liitin-tiedostot-luettaviksi-ja-kirjoitettaviksi-).
 */
import { describe, it, expect } from 'vitest';
import { microsoftFiles, microsoftFilesWrite, safeDriveName, filesScopes } from '../../src/services/connections/providers-files.js';

const read = microsoftFiles('id', 'secret', 'contoso', true);
const write = microsoftFilesWrite('id', 'secret', 'contoso', true);
const DRIVE = 'b!abc_DEF-1';
const SITE = 'contoso.sharepoint.com,11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222';

describe('the two halves', () => {
  it('ask for read or write, by which sites the node reaches', () => {
    expect(read.scopes).toEqual(['Files.Read.All', 'Sites.Read.All', 'User.Read', 'offline_access']);
    expect(write.scopes).toEqual(['Files.ReadWrite.All', 'Sites.ReadWrite.All', 'User.Read', 'offline_access']);
    expect(filesScopes('selected')).toEqual({ read: ['Sites.Selected'], write: ['Sites.Selected'] });
    expect(microsoftFiles('id', 's', 'common', true, 'selected').scopes[0]).toBe('Sites.Selected');
    expect(read.writeResources).toBeUndefined();
    expect(Object.keys(write.writeResources ?? {})).toEqual(['upload', 'replace', 'folder', 'list_item', 'list_item_update']);
  });

  it('sign in at the configured directory with the Outlook app', () => {
    expect(read.endpoints(null)?.authorize).toBe('https://login.microsoftonline.com/contoso/oauth2/v2.0/authorize');
    expect(microsoftFiles('', '', 'common', true).enabled).toBe(false);
  });
});

describe('addresses are built here, never taken from a caller', () => {
  const r = read.resources!;
  const w = write.writeResources!;

  it('a path id that walks elsewhere is refused', () => {
    for (const bad of ['../../me/messages', 'a/b', 'x?y', 'x#y', '']) {
      expect(() => r.item!.url({ drive_id: DRIVE, item_id: bad }, null)).toThrow();
      expect(() => r.children!.url({ drive_id: bad }, null)).toThrow();
    }
    expect(() => r.lists!.url({ site_id: 'evil.example.com/../x' }, null)).toThrow();
    expect(() => r.site!.url({ hostname: 'evil.example.com', path: 'sites/x' }, null)).toThrow();
  });

  it('builds the Graph address for each read', () => {
    expect(r.item!.url({ drive_id: DRIVE, item_id: '01ABC' }, null)).toBe(`https://graph.microsoft.com/v1.0/drives/${DRIVE}/items/01ABC`);
    expect(r.drives!.url({}, null)).toBe('https://graph.microsoft.com/v1.0/me/drives');
    expect(r.site!.url({ hostname: 'contoso.sharepoint.com', path: 'sites/Board Room' }, null))
      .toBe('https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/Board%20Room');
    const search = new URL(r.search!.url({ drive_id: DRIVE, query: "o'neil report" }, null));
    expect(decodeURIComponent(search.pathname)).toBe(`/v1.0/drives/${DRIVE}/root/search(q='o''neil report')`);
    expect(new URL(r.list_items!.url({ site_id: SITE, list_id: '33333333-3333-3333-3333-333333333333' }, null)).searchParams.get('expand')).toBe('fields');
  });

  it('a file name SharePoint refuses is refused with a sentence, and a good one is one path segment', () => {
    for (const bad of ['../x', 'a/b', 'a\\b', 'x:y', 'what?', 'a#b', '50%', '.', '..', '', 'x'.repeat(256)]) {
      expect(() => safeDriveName(bad)).toThrow();
    }
    const u = new URL(w.upload!.url({ drive_id: DRIVE, filename: 'Raportti ä.docx' }));
    expect(u.pathname).toBe(`/v1.0/drives/${DRIVE}/items/root:/Raportti%20%C3%A4.docx:/content`);
    expect(u.searchParams.get('@microsoft.graph.conflictBehavior')).toBe('rename');
    expect(new URL(w.upload!.url({ drive_id: DRIVE, filename: 'a.txt', conflict: 'replace' })).searchParams.get('@microsoft.graph.conflictBehavior')).toBe('replace');
  });

  it('an etag becomes If-Match, and one that could split a header is refused', () => {
    expect(w.replace!.headers!({ etag: '"etag-1"' })).toEqual({ 'If-Match': '"etag-1"' });
    expect(w.replace!.headers!({})).toEqual({});
    expect(() => w.replace!.headers!({ etag: '"x"\r\nX-Evil: 1' })).toThrow();
  });

  it('a list row takes plain values under column names only', () => {
    const body = w.list_item!.body as (p: Record<string, unknown>) => unknown;
    expect(body({ fields: { Title: 'A', Amount: 3, Done: false } })).toEqual({ fields: { Title: 'A', Amount: 3, Done: false } });
    expect(() => body({ fields: { 'bad name': 'x' } })).toThrow();
    expect(() => body({ fields: { Title: { nested: 1 } } })).toThrow();
    expect(() => body({ fields: {} })).toThrow();
  });
});
