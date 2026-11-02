/**
 * @file providers-files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The FILES providers: SharePoint and OneDrive through Microsoft Graph, a READ/WRITE pair
 *   in the shape the mail providers set (providers-mail.ts). Reading a company's document libraries
 *   and writing into them are different consent: a person who wants their AI to read the board
 *   minutes has not thereby let it change them, and a permission never requested cannot be misused.
 *
 *   WHY OUR OWN AND NOT MICROSOFT'S MCP SERVER. Microsoft's SharePoint MCP server is a Copilot Studio
 *   preview that Microsoft itself says not to use in new projects, and its successor (Work IQ) needs a
 *   Microsoft 365 Copilot licence for every user. Graph is reachable from every Microsoft 365
 *   subscription with no extra licence, and the node already holds the OAuth round, the sealed
 *   credential and the refresh for the Outlook pair (research 2026-11-02,
 *   wish-sharepoint-liitin-tiedostot-luettaviksi-ja-kirjoitettaviksi-).
 *
 *   THE CALLER NAMES A RESOURCE AND THE NODE BUILDS THE URL, for reading and for writing alike. Every
 *   id that goes into a path is pattern-checked here, so a caller cannot point a sealed token at an
 *   address this node never meant to send it to. A file's bytes are never read through `resources`:
 *   Graph answers `/content` with a redirect to a pre-authenticated address on the tenant's own host,
 *   so drive-files.ts reads the item's `@microsoft.graph.downloadUrl` and fetches that WITHOUT the
 *   token.
 *
 *   WHICH SITES. `AIMEAT_CONNECT_MICROSOFT_FILES_SITES=all` asks for Files and Sites .Read.All /
 *   .ReadWrite.All: the person reaches what they reach in SharePoint themselves. `selected` asks for
 *   Sites.Selected instead: the consent alone grants nothing, and a SharePoint administrator grants
 *   the node's app access site by site, which is how a company keeps the reach to named sites.
 * @structure microsoftFiles · microsoftFilesWrite · driveResources · driveWriteResources · ids
 * @usage import { microsoftFiles, microsoftFilesWrite } from './providers-files.js';
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (wish-sharepoint-liitin-tiedostot-luettaviksi-ja-kirjoitettaviksi-).
 */
import type { OutboundProvider, ProviderResource, ProviderWriteResource } from './providers-types.js';
import { microsoftEndpoints } from './providers-microsoft.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';

/** Which SharePoint sites the node's app asks to reach: all the person reaches, or named ones. */
export type FilesSiteReach = 'all' | 'selected';

// ── Ids that go into a path: checked, never trusted ─────────────────────────────────────────

/** A drive id (`b!…`) or an item id (`01ABC…`): base64url with Graph's `!`. */
const DRIVE_OR_ITEM = /^[A-Za-z0-9!_-]{1,200}$/;
/** A site id is `host,siteCollectionGuid,webGuid`; `root` is the tenant's root site. */
const SITE = /^(root|[A-Za-z0-9.-]{1,253}(,[0-9a-fA-F-]{36}){2})$/;
const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const LIST_ITEM = /^\d{1,12}$/;
/** A SharePoint host name, for resolving a site by its address. */
const HOST = /^[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*\.sharepoint\.com$/i;

function idOf(params: Record<string, unknown>, name: string, re: RegExp, sentence: string): string {
  const value = typeof params[name] === 'string' ? (params[name] as string).trim() : '';
  if (!re.test(value)) throw new Error(sentence);
  return value;
}

const driveId = (p: Record<string, unknown>) => idOf(p, 'drive_id', DRIVE_OR_ITEM,
  'Name the document library (drive_id). Its id comes from the drives list.');
const itemId = (p: Record<string, unknown>, name = 'item_id') => idOf(p, name, DRIVE_OR_ITEM,
  `Name the file or folder (${name}). Its id comes from a folder's contents or a search.`);
const siteId = (p: Record<string, unknown>) => idOf(p, 'site_id', SITE,
  'Name the site (site_id). Its id comes from the sites search, or say root.');
const listId = (p: Record<string, unknown>) => idOf(p, 'list_id', GUID,
  'Name the list (list_id). Its id comes from the site\'s lists.');

/** A folder item or `root` when none is named. */
function parentOf(p: Record<string, unknown>, name = 'parent_id'): string {
  return p[name] === undefined || p[name] === '' || p[name] === 'root' ? 'root' : itemId(p, name);
}

/**
 * A file or folder name SharePoint accepts, as one path segment. The characters SharePoint refuses
 * are refused here with a sentence, rather than answered by Graph with a 400 that names none of them.
 */
export function safeDriveName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  const control = [...name].some((ch) => ch.charCodeAt(0) < 32);
  if (!name || name.length > 255 || name === '.' || name === '..' || /[\\/:*?"<>|#%]/.test(name) || control) {
    throw new Error('Give the file a name of up to 255 characters, without \\ / : * ? " < > | # or %.');
  }
  return name;
}

/** A caller-supplied count, made safe without an error: a silly number is a small number. */
function clamp(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

/** Graph's paging: the caller hands back the `$skiptoken` of the last page's @odata.nextLink. */
function withPage(u: URL, params: Record<string, unknown>, top = 50): string {
  u.searchParams.set('$top', String(clamp(params.limit, top, 200)));
  const page = typeof params.page_token === 'string' ? params.page_token.slice(0, 800) : '';
  if (page) u.searchParams.set('$skiptoken', page);
  return u.toString();
}

/** A search term inside Graph's `search(q='…')`: the quote doubled, and kept short. */
function searchTerm(value: unknown): string {
  const q = typeof value === 'string' ? value.trim().slice(0, 200) : '';
  if (!q) throw new Error('Say what to search for (query).');
  return encodeURIComponent(q.replace(/'/g, "''"));
}

/** The If-Match header from a caller's `etag`, so a write over another person's change is refused. */
function ifMatch(params: Record<string, unknown>): Record<string, string> {
  const etag = typeof params.etag === 'string' ? params.etag.trim() : '';
  if (!etag) return {};
  if (etag.length > 200 || /[\r\n]/.test(etag)) throw new Error('That etag is not one Graph gave.');
  return { 'If-Match': etag };
}

/** What a list item's fields may be: plain values only, never nested objects Graph would refuse. */
function fieldsOf(params: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const raw = params.fields;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Give the item\'s fields as an object, such as {"Title": "…"}.');
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)) throw new Error(`"${k}" is not a column's internal name.`);
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else throw new Error(`The value of "${k}" has to be text, a number, true or false.`);
  }
  if (!Object.keys(out).length) throw new Error('Give at least one field.');
  return out;
}

// ── What may be read ─────────────────────────────────────────────────────────────────────────

/**
 * The read resources. `base` is Graph's own address; the tests answer it in process by replacing
 * fetch, as test/e2e-mail-connections.ts does, so there is no knob to point it elsewhere.
 */
export function driveResources(read: string[], base = GRAPH): Record<string, ProviderResource> {
  return {
    profile: {
      label: 'which account this is',
      requiresScopes: ['User.Read'],
      url() { return `${base}/me`; },
    },
    sites: {
      label: 'the sites you can reach',
      requiresScopes: read,
      url(params) {
        // An empty search lists the sites Graph considers relevant to the person.
        const q = typeof params.query === 'string' ? params.query.trim().slice(0, 200) : '';
        const u = new URL(`${base}/sites`);
        u.searchParams.set('search', q || '*');
        return withPage(u, params, 25);
      },
    },
    site: {
      label: 'one site',
      requiresScopes: read,
      url(params) {
        if (typeof params.hostname === 'string' && params.hostname) {
          const host = idOf(params, 'hostname', HOST, 'Give the site\'s host, such as contoso.sharepoint.com.');
          const path = typeof params.path === 'string' ? params.path.trim().replace(/^\/+/, '') : '';
          if (!/^[A-Za-z0-9 _./-]{0,400}$/.test(path) || path.includes('..')) throw new Error('Give the site\'s path, such as sites/Marketing.');
          return path ? `${base}/sites/${host}:/${path.split('/').map(encodeURIComponent).join('/')}` : `${base}/sites/${host}`;
        }
        return `${base}/sites/${siteId(params)}`;
      },
    },
    drives: {
      label: 'the document libraries',
      requiresScopes: read,
      url(params) {
        // No site named: the person's own OneDrive.
        return params.site_id ? `${base}/sites/${siteId(params)}/drives` : `${base}/me/drives`;
      },
    },
    children: {
      label: 'the contents of a folder',
      requiresScopes: read,
      url(params) {
        return withPage(new URL(`${base}/drives/${driveId(params)}/items/${parentOf(params, 'item_id')}/children`), params);
      },
    },
    item: {
      label: 'one file or folder',
      requiresScopes: read,
      url(params) { return `${base}/drives/${driveId(params)}/items/${itemId(params)}`; },
    },
    search: {
      label: 'a search of a document library',
      requiresScopes: read,
      url(params) {
        const where = params.drive_id ? `drives/${driveId(params)}` : `sites/${siteId(params)}/drive`;
        return withPage(new URL(`${base}/${where}/root/search(q='${searchTerm(params.query)}')`), params, 25);
      },
    },
    changes: {
      label: 'what changed in a document library',
      requiresScopes: read,
      url(params) {
        // Graph's delta: the first call answers everything and a deltaLink; the token in that link
        // is what the caller hands back to learn only what changed since, deletions included.
        const u = new URL(`${base}/drives/${driveId(params)}/root/delta`);
        const token = typeof params.token === 'string' ? params.token.trim().slice(0, 800) : '';
        if (token) u.searchParams.set('token', token);
        return withPage(u, params, 200);
      },
    },
    lists: {
      label: 'the lists of a site',
      requiresScopes: read,
      url(params) { return withPage(new URL(`${base}/sites/${siteId(params)}/lists`), params); },
    },
    list_items: {
      label: 'the rows of a list',
      requiresScopes: read,
      url(params) {
        const u = new URL(`${base}/sites/${siteId(params)}/lists/${listId(params)}/items`);
        u.searchParams.set('expand', 'fields');
        return withPage(u, params);
      },
    },
  };
}

// ── What may be written ──────────────────────────────────────────────────────────────────────

/** The write resources. Nothing here deletes or shares: a permission never asked for cannot leak. */
export function driveWriteResources(write: string[], base = GRAPH): Record<string, ProviderWriteResource> {
  return {
    upload: {
      label: 'a new file in a folder',
      requiresScopes: write,
      method: 'PUT',
      body: 'bytes',
      url(params) {
        const conflict = params.conflict === 'replace' || params.conflict === 'fail' ? params.conflict : 'rename';
        const u = new URL(`${base}/drives/${driveId(params)}/items/${parentOf(params)}:/${encodeURIComponent(safeDriveName(params.filename))}:/content`);
        u.searchParams.set('@microsoft.graph.conflictBehavior', conflict);
        return u.toString();
      },
    },
    replace: {
      label: 'the contents of an existing file',
      requiresScopes: write,
      method: 'PUT',
      body: 'bytes',
      url(params) { return `${base}/drives/${driveId(params)}/items/${itemId(params)}/content`; },
      headers: ifMatch,
    },
    folder: {
      label: 'a new folder',
      requiresScopes: write,
      method: 'POST',
      body: (params) => ({
        name: safeDriveName(params.name),
        folder: {},
        '@microsoft.graph.conflictBehavior': params.conflict === 'fail' ? 'fail' : 'rename',
      }),
      url(params) { return `${base}/drives/${driveId(params)}/items/${parentOf(params)}/children`; },
    },
    list_item: {
      label: 'a new row in a list',
      requiresScopes: write,
      method: 'POST',
      body: (params) => ({ fields: fieldsOf(params) }),
      url(params) { return `${base}/sites/${siteId(params)}/lists/${listId(params)}/items`; },
    },
    list_item_update: {
      label: 'a change to a row in a list',
      requiresScopes: write,
      method: 'PATCH',
      body: (params) => fieldsOf(params),
      url(params) {
        const row = idOf(params, 'item_id', LIST_ITEM, 'Name the row (item_id). Its id comes from the list\'s rows.');
        return `${base}/sites/${siteId(params)}/lists/${listId(params)}/items/${row}/fields`;
      },
      headers: ifMatch,
    },
  };
}

// ── The two providers ────────────────────────────────────────────────────────────────────────

function disabledReason(capabilityOn: boolean, configured: boolean): string | null {
  if (capabilityOn && configured) return null;
  return !capabilityOn
    ? 'connections capability is off (AIMEAT_CONNECTIONS_ENABLED)'
    : 'no client credentials (AIMEAT_CONNECT_MICROSOFT_CLIENT_ID / _SECRET)';
}

/** The scopes each half asks for, by which sites the node's app may reach. */
export function filesScopes(reach: FilesSiteReach): { read: string[]; write: string[] } {
  return reach === 'selected'
    ? { read: ['Sites.Selected'], write: ['Sites.Selected'] }
    : { read: ['Files.Read.All', 'Sites.Read.All'], write: ['Files.ReadWrite.All', 'Sites.ReadWrite.All'] };
}

/**
 * SharePoint and OneDrive, reading. The same three Microsoft differences as Outlook (the tenant in
 * the URL, `offline_access` as a scope, the identity from `/me` with `User.Read`), the same app
 * registration, and the identity lookup is the one connections/oauth.ts already makes for Outlook.
 */
export function microsoftFiles(
  clientId: string, clientSecret: string, tenant: string, capabilityOn: boolean, reach: FilesSiteReach = 'all',
): OutboundProvider {
  const configured = Boolean(clientId && clientSecret);
  const { read } = filesScopes(reach);
  return {
    id: 'microsoft-files',
    label: 'SharePoint and OneDrive',
    credentialShape: 'oauth2',
    instanceScoped: false,
    enabled: capabilityOn && configured,
    capabilityOn,
    disabledReason: disabledReason(capabilityOn, configured),
    client: configured ? { id: clientId, secret: clientSecret } : null,
    scopes: [...read, 'User.Read', 'offline_access'],
    pkce: true,
    tokenAuth: 'body',
    offlineAccess: false,
    capabilities: ['read-files'],
    sharedDailyLimit: null,
    attachFields: null,
    resources: driveResources(read),
    endpoints: (_instance, forTenant) => microsoftEndpoints(forTenant || tenant),
  };
}

/**
 * SharePoint and OneDrive, writing: a new file, a replaced file, a folder, a list row. A second
 * provider rather than a wider scope on the first, for the reason the mail pair gives. It reads too,
 * because ReadWrite includes Read and a write needs the folder it writes into.
 */
export function microsoftFilesWrite(
  clientId: string, clientSecret: string, tenant: string, capabilityOn: boolean, reach: FilesSiteReach = 'all',
): OutboundProvider {
  const configured = Boolean(clientId && clientSecret);
  const { write } = filesScopes(reach);
  return {
    id: 'microsoft-files-write',
    label: 'SharePoint and OneDrive (writing)',
    credentialShape: 'oauth2',
    instanceScoped: false,
    enabled: capabilityOn && configured,
    capabilityOn,
    disabledReason: disabledReason(capabilityOn, configured),
    client: configured ? { id: clientId, secret: clientSecret } : null,
    scopes: [...write, 'User.Read', 'offline_access'],
    pkce: true,
    tokenAuth: 'body',
    offlineAccess: false,
    capabilities: ['read-files', 'write-files'],
    sharedDailyLimit: null,
    attachFields: null,
    resources: driveResources(write),
    writeResources: driveWriteResources(write),
    endpoints: (_instance, forTenant) => microsoftEndpoints(forTenant || tenant),
  };
}
