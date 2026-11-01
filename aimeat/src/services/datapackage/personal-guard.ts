/**
 * @file src/services/datapackage/personal-guard.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A data package made public from personal data asks for the owner's confirmation first.
 *
 *   An app states in its data map (services/data-map/) which of its data is personal: a row with
 *   `personalData: 'yes'`, or with the regulated `domains` its personal data falls in. When such an app
 *   (or an extension the app's map names) publishes a package to `public`, the publish is refused with
 *   PERSONAL_DATA_PUBLIC before anything is written, unless the request carries the confirmation
 *   (`confirm_personal_public: true` on POST /v1/datapackages, `confirmPersonalPublic: true` on
 *   ctx.datapackage.publish). A confirmed publish records the confirmation on the package's
 *   service-owned audience record (./audience-record.ts, `personalPublicConfirmed`; the pointer keeps a
 *   copy no decision reads), so the producer's later public versions are not asked again. A
 *   proposal, not a block: the owner decides, and a package below public is never asked.
 *
 *   WHICH ROWS COUNT. A map row that names the package's own storage family (`datapkg/...` with the
 *   package name or a wildcard) is the producer's statement about this package, and only those rows
 *   decide. A map with no such row is read whole: an app that holds personal data and publishes from it
 *   is asked. A producer with no data map is not asked, and nothing changes for it.
 *
 *   WHICH PRODUCERS. An app grant (the token's own app id, never a body field), and an extension, linked
 *   to the owner's apps whose map names it (a row whose `where` or `whereExactly` names the extension,
 *   or whose family is in its `ext:{name}` namespace). An agent, a workflow step and the owner by hand
 *   have no data map of their own and are not asked here; an agent without publish:public goes through
 *   the publish request, where the owner decides anyway.
 * @structure personalRowsFor · personalPublicGuard · PERSONAL_DATA_PUBLIC
 * @usage
 *   const guard = await personalPublicGuard(deps, ownerGhii, name, visibility, producedBy, input.confirmPersonalPublic, trusted.personalPublicConfirmed);
 *   if (!guard.ok) return refusal;
 * @version-history
 *   v1.1.0 — 2026-11-01 — Decides on the confirmation the service recorded, not the pointer's
 *     `personalPublicConfirmed`, which an app with storage:write rewrites (WP9e).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D1.7).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { appDataMapKey, DATA_MAP_SPEC, type DataMap, type DataMapRow } from '../data-map/data-map-types.js';
import { localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import type { PublicConfirmation } from './audience-record.js';

export const PERSONAL_DATA_PUBLIC = 'PERSONAL_DATA_PUBLIC' as const;

/** The producer facts the guard reads: the app a grant belongs to, or the extension that ran. */
export interface GuardProducer {
  /** `owner/filename` of the app whose grant published (req.auth.app). */
  app?: string;
  /** The extension whose action published. */
  extension?: string;
}

/**
 * One app's data map, read as data-map-store.ts readAppDataMap reads it. Not imported from there: that
 * file writes through memory-write.ts, whose import graph reaches the workflow engine and back here.
 */
async function readAppDataMap(storage: Storage, ownerGhii: string, appId: string): Promise<DataMap | null> {
  const value = (await storage.getMemory(ownerGhii, appDataMapKey(appId)))?.value as DataMap | undefined;
  return value && typeof value === 'object' && value.spec === DATA_MAP_SPEC && Array.isArray(value.held) ? value : null;
}

/** A row that says its data is personal. */
const isPersonal = (r: DataMapRow): boolean => r.personalData === 'yes' || (Array.isArray(r.domains) && r.domains.length > 0);

/** A row about the package's own storage family: `datapkg/` with the package name or a wildcard. */
function namesPackage(r: DataMapRow, name: string): boolean {
  const what = `${r.what ?? ''} ${r.whereExactly ?? ''}`;
  if (!what.includes('datapkg/')) return false;
  return what.includes(`datapkg/${name}`) || /datapkg\/(\*|\{|<)/.test(what);
}

/** A map that names the extension: its namespace, or a row placed in that extension's space. */
function namesExtension(map: DataMap, ext: string): boolean {
  return map.held.some(r => r.what?.includes(`ext:${ext}`)
    || (r.where === 'extension-namespace' && `${r.whereExactly ?? ''} ${r.what ?? ''}`.includes(ext)));
}

/** The data maps of the producer: the app's own, or the owner's apps that name the extension. */
async function producerMaps(storage: Storage, ownerGhii: string, producer: GuardProducer): Promise<Array<{ app: string; map: DataMap }>> {
  const owner = localAccountName(ownerGhii);
  if (producer.app) {
    const [appOwner, filename] = producer.app.split('/');
    if (appOwner !== owner || !filename) return [];
    const appId = filename.replace(/\.html$/i, '');
    const map = await readAppDataMap(storage, ownerGhii, appId);
    return map ? [{ app: appId, map }] : [];
  }
  if (producer.extension) {
    const { apps } = await storage.listApps({ ownerGaii: ownerGhii, viewerGhii: ownerGhii, limit: 500 });
    const out: Array<{ app: string; map: DataMap }> = [];
    for (const a of apps) {
      const appId = a.filename.replace(/\.html$/i, '');
      const map = await readAppDataMap(storage, ownerGhii, appId);
      if (map && namesExtension(map, producer.extension)) out.push({ app: appId, map });
    }
    return out;
  }
  return [];
}

/** The personal rows that decide for this package, with the app each is from. Empty: nothing to ask. */
export async function personalRowsFor(
  storage: Storage, ownerGhii: string, name: string, producer: GuardProducer,
): Promise<Array<{ app: string; row: DataMapRow }>> {
  const maps = await producerMaps(storage, ownerGhii, producer);
  const out: Array<{ app: string; row: DataMapRow }> = [];
  for (const { app, map } of maps) {
    const own = map.held.filter(r => namesPackage(r, name));
    const deciding = own.length ? own : map.held;
    for (const row of deciding) if (isPersonal(row)) out.push({ app, row });
  }
  return out;
}

export type PersonalGuardResult =
  | { ok: true; confirmedAt?: string }
  | { ok: false; code: typeof PERSONAL_DATA_PUBLIC; message: string; rows: Array<{ app: string; what: string; holds: string }> };

/**
 * May this version go public? Ok when it is not going public, when the package has a confirmation the
 * service recorded (`recorded`, ./audience-record.ts trustedAudienceOf; never the pointer file's own
 * word, which an app with storage:write rewrites), when the producer's data map marks nothing personal, or when the request confirms (then
 * `confirmedAt` is the stamp to record). Refused otherwise, before any write.
 */
export async function personalPublicGuard(
  deps: { storage: Storage; config: AimeatConfig }, ownerGhii: string, name: string, visibility: string,
  producer: GuardProducer, confirm: boolean | undefined, recorded: PublicConfirmation | undefined,
): Promise<PersonalGuardResult> {
  if (visibility !== 'public') return { ok: true };
  if (recorded) return { ok: true };
  if (!producer.app && !producer.extension) return { ok: true };
  let rows: Array<{ app: string; row: DataMapRow }>;
  try {
    rows = await personalRowsFor(deps.storage, ownerGhii, name, producer);
  } catch (err) {
    // A map that cannot be read is not a statement that the data is personal; the publish goes on.
    logger.warn('datapackage: the producer\'s data map could not be read, the personal-data check is skipped', { package: name, error: String(err) });
    return { ok: true };
  }
  if (!rows.length) return { ok: true };
  if (confirm === true) return { ok: true, confirmedAt: new Date().toISOString() };
  const named = rows.slice(0, 5).map(r => `"${r.row.what}" (${r.row.holds || 'no description'}) in ${r.app}`).join('; ');
  return {
    ok: false, code: PERSONAL_DATA_PUBLIC,
    rows: rows.map(r => ({ app: r.app, what: r.row.what, holds: r.row.holds })),
    message: `The data map of the app that produces this package marks its data as personal: ${named}. `
      + 'Publishing it to public puts that data at an address anyone can read. Nothing was written. '
      + 'Ask the owner: when they agree, send the publish again with confirm_personal_public: true '
      + '(confirmPersonalPublic in an extension); or publish it to members, an organism or private instead.',
  };
}
