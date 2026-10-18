/**
 * @file src/services/data-map/data-map-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The decisions behind the data map, in one place that takes the CALLER and returns a
 *   refusal or a result. The HTTP route and the MCP tools both call these and neither decides
 *   anything of its own.
 *
 *   WHY IT IS SHAPED THIS WAY. Writing a capability twice is what produced 315 measured differences
 *   between the MCP surface and REST in the August 2026 audit. The lint rule that refuses
 *   `storage.*` inside an MCP tool is what sent this file into existence, and it was right to.
 * @structure readProgramMap · stateProgramMap · putProgramMap · handsOnKey · splitAppRef
 * @usage import { readProgramMap } from './data-map-access.js';
 * @version-history
 *   2026-10-18 — The map carries the optional `invites` statement through a write, and every read and write checks the map against the app's declared scopes (declaredScopesOf), so an app asking for organism:invite whose map does not say it invites people has the finding DATAMAP_INVITES_UNSTATED. putProgramMap answers the findings too (wish-datakarttaan-ja-agentin-kuvaukseen-tieto-kutsuista-ja-tilien).
 *   2026-10-16 — readProgramMap answers the map of an app an operator hid, an app behind an access code, an unlisted app or a community-listed app only to a caller who may see that app (the owner's account, an operator, and for a community listing any signed-in member of this node); everyone else gets the 404 of an app that does not exist. The caller 'node' is the node's own check (decide service) and passes. (QA audit list review).
 *   v2.1.2 — 2026-09-26 — readProgramMap takes the owner's account name from localAccountName (utils/gaii.ts), which keeps an identity of another node whole, so it never names the local namesake (secaudit 2026-09, F-1).
 *   v2.1.1 — 2026-09-24 — readProgramMap strips the stamp's `gap` for everyone but the owner, as it
 *     already did `findings` (A6-10). The REST read and aimeat_datamap_get both come through here.
 *   v2.1.0 — 2026-09-14 — putProgramMap: validate, write, restamp, with no opinion about who may do
 *     it. The package installer is its second caller, so an installed app arrives with the map its
 *     author wrote instead of being stamped as having none.
 *   v2.0.0 — 2026-08-25 — spec/2. No derivation to fall back on: an app with no map reads as having
 *     none, which is the honest answer and the one that gets it written.
 *   v1.0.0 — 2026-08-25 — Extracted the moment the same rules needed a second door.
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { MemoryWriteCaller } from '../memory-write.js';
import { localAccountName } from '../../utils/gaii.js';
import { operatorOverride, type OperatorAuth } from '../operator-override.js';
import { appListingOf, type AppRecord } from '../../storage/types/apps.js';
import { readAppDataMap, writeAppDataMap } from './data-map-store.js';
import { checkMap, stampFor, type MapCheck } from './data-map-check.js';
import { DATA_MAP_SPEC, type DataMap, type DataMapStamp, type InvitesStatement } from './data-map-types.js';
import { parseAppScopes } from '../protected-resource.js';

export interface DataMapRefusal {
  refusal: { status: number; code: string; message: string };
}

export interface ProgramMapResult {
  app: string;
  /** Null when the app has no map. The surfaces render that as a sentence, never as a blank. */
  dataMap: DataMap | null;
  stamp: DataMapStamp;
  /** Owner-only: everything still missing from the map, worst first. */
  findings?: { code: string; message: string }[];
}

/** Who is asking, in the terms every door already resolves. */
export interface DataMapCaller {
  principal: string;
  ownerName: string;
  roles: string[];
  scopes: string[];
  /**
   * A signed-in person of this node or a principal acting for one: not the anonymous credential and
   * not a session from another node. Only a member is ever the app's owner here, and a member reads
   * the map of an app listed to the community. Absent counts as not a member.
   */
  member?: boolean;
  /** The session for the operator question (operator-override.ts). Absent: never an operator. */
  auth?: OperatorAuth;
}

/** The node itself reading a map for its own check (decide service): no person, no visibility gate. */
export const NODE_READ = 'node' as const;

const appIdOf = (filename: string): string => filename.replace(/\.html$/i, '');

/**
 * The words of the app's `<meta name="aimeat-scopes">`, read from its stored bytes. They decide
 * whether the map has to say that the app invites people (data-map-check.ts DATAMAP_INVITES_UNSTATED).
 */
export function declaredScopesOf(record: AppRecord | null): string[] {
  const data = record?.data as Buffer | Uint8Array | string | undefined;
  if (!data) return [];
  return parseAppScopes(typeof data === 'string' ? data : Buffer.from(data).toString('utf-8'));
}

/** "owner/filename.html" → the pair every app address uses, or null when it is not that shape. */
export function splitAppRef(ref: string): { owner: string; filename: string } | null {
  const slash = ref.indexOf('/');
  if (slash <= 0 || slash === ref.length - 1) return null;
  return { owner: ref.slice(0, slash), filename: ref.slice(slash + 1) };
}

/**
 * One app's map.
 *
 * The map of a public app is public — it is what an AI reads before it touches the app — and the
 * findings are not: what is still missing is the owner's own unfinished business. The map of an app
 * that is not public goes only to whoever may see that app (mayReadMap below).
 */
export async function readProgramMap(
  storage: Storage, config: AimeatConfig, caller: DataMapCaller | typeof NODE_READ | null, appRef: string, at: string,
): Promise<ProgramMapResult | DataMapRefusal> {
  const ref = splitAppRef(appRef);
  if (!ref) {
    return { refusal: { status: 400, code: 'INVALID_INPUT', message: 'Name the app as "owner/filename.html".' } };
  }
  const notFound: DataMapRefusal = {
    refusal: { status: 404, code: 'NOT_FOUND', message: `No app "${appRef}" on this node. Check the owner name and the filename.` },
  };
  const bare = localAccountName(ref.owner);
  const record = await storage.getAppByOwnerName(bare, ref.filename);
  if (!record) return notFound;

  const person = caller === NODE_READ ? null : caller;
  // Only a member of this node is ever the owner: a visitor's or the anonymous credential's owner
  // field is not a local account name, whatever its text.
  const isOwn = !!person && person.member === true && person.ownerName === record.ownerName;
  // The same 404 as an app that does not exist, so a refusal does not tell that the app is there.
  if (caller !== NODE_READ && !isOwn && !(await mayReadMap(storage, config, person, record))) return notFound;

  const appId = appIdOf(ref.filename);
  const map = await readAppDataMap(storage, record.ownerGaii, appId);
  const scopes = declaredScopesOf(record);
  const check = checkMap(map, at, scopes);

  // The stamp carries the worst finding as `gap`, and that is the same unfinished business as
  // `findings`, so it is stripped for everyone but the owner here, where every door reads the map.
  // It reached anybody who asked, a caller with no token included (A6-10). stampFor builds a new
  // object on every call, so removing the field touches nothing that is stored.
  const stamp = stampFor(map, appId, at, scopes);
  if (!isOwn) delete stamp.gap;

  return {
    app: appRef,
    dataMap: map,
    stamp,
    ...(isOwn ? { findings: check.findings } : {}),
  };
}

/**
 * Whether somebody other than the app's owner may read this app's map. The gates are the app's own,
 * as the app read routes apply them (routes/apps/read.ts, routes/apps/legal.ts,
 * services/app-config.ts): an app an operator hid, an app behind an access code and an unlisted app
 * are the owner's and an operator's; an app listed to the community is also every signed-in member's
 * of this node; a listed app is everyone's. The operator's read of another person's private map
 * writes the operator trail, as the app read does.
 */
async function mayReadMap(
  storage: Storage, config: AimeatConfig, caller: DataMapCaller | null, record: AppRecord,
): Promise<boolean> {
  const listing = appListingOf(record);
  const open = !record.operatorHidden && !record.accessCode;
  if (open && listing === 'listed') return true;
  if (open && listing === 'community' && caller?.member === true) return true;
  return operatorOverride(storage, config, caller?.auth ?? null, {
    ownerOf: record.ownerName, area: 'app', action: 'read', subject: `${record.filename} data map`,
  });
}

/**
 * The optional `invites` statement as stored: the acts kept as written (an open list, like every
 * axis), the text cut to a sane length. Anything that is not an object is no statement at all.
 */
function readInvites(v: unknown): InvitesStatement | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const raw = v as { does?: unknown; into?: unknown };
  const does = Array.isArray(raw.does)
    ? raw.does.filter((d): d is string => typeof d === 'string' && d.trim().length > 0).map(d => d.trim().slice(0, 80)).slice(0, 20)
    : [];
  const into = typeof raw.into === 'string' ? raw.into.trim().slice(0, 500) : '';
  return { does, into };
}

/** Everything a stated map must carry before it is worth storing. */
function readMap(body: Partial<DataMap>, at: string): DataMap | string {
  // The refusal says what to send. Three measured cold builds in a row (2026-09-19) sent a map
  // without the spec, were told only that it must carry one, and had to find the shape elsewhere.
  // The spec stays REQUIRED: this write replaces the whole map, and a body without it is how a
  // half-written map would wipe a good one.
  if (body.spec !== DATA_MAP_SPEC) {
    return `A data map must carry spec "${DATA_MAP_SPEC}". Send the WHOLE map in one object: `
      + `{ "spec": "${DATA_MAP_SPEC}", "what": "...", "usedFor": "...", "form": "one-person", "arrangement": "...", `
      + '"machinery": [], "leaves": [], "held": [ ...one row per key family... ], "elsewhere": [] }. '
      + 'This write REPLACES the map, which is why a body without the spec is refused rather than half-stored: read the map first '
      + '(aimeat_datamap_get, or GET on this address) and send all of it back. The fields of a `held` row and every allowed value are in '
      + 'the build specification: aimeat_handbook_get { tier: "build-app/data-map" }, or GET /v1/prompts/build-app/sections/data-map.';
  }
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const invites = readInvites(body.invites);
  return {
    spec: DATA_MAP_SPEC,
    what: str(body.what),
    usedFor: str(body.usedFor),
    form: body.form ?? 'unstated',
    arrangement: str(body.arrangement),
    machinery: Array.isArray(body.machinery) ? body.machinery : [],
    leaves: Array.isArray(body.leaves) ? body.leaves : [],
    ...(invites ? { invites } : {}),
    held: Array.isArray(body.held) ? body.held : [],
    elsewhere: Array.isArray(body.elsewhere) ? body.elsewhere : [],
    // Somebody wrote this, so it is declared however it arrived. Nothing else may claim to be a map.
    source: 'declared',
    at,
  };
}

/**
 * State one app's map, replacing what it said before.
 *
 * The ACCOUNT is the check, not the role: an owner session and that owner's agent both write here
 * and a different PERSON never does. A granted app is refused outright — it is scoped to one app and
 * must not be able to restate another one's promises.
 */
export async function stateProgramMap(
  storage: Storage, config: AimeatConfig, caller: DataMapCaller, appRef: string,
  body: Partial<DataMap>, at: string,
): Promise<ProgramMapResult | DataMapRefusal> {
  const ref = splitAppRef(appRef);
  if (!ref) {
    return { refusal: { status: 400, code: 'INVALID_INPUT', message: 'Name the app as "owner/filename.html".' } };
  }
  if (caller.ownerName !== ref.owner) {
    return { refusal: { status: 403, code: 'FORBIDDEN', message: 'This map belongs to another account.' } };
  }
  if (caller.roles.includes('app')) {
    return {
      refusal: {
        status: 403, code: 'FORBIDDEN',
        message: 'A granted app cannot write a data map. The owner states it.',
      },
    };
  }
  const parsed = readMap(body, at);
  if (typeof parsed === 'string') {
    return { refusal: { status: 400, code: 'INVALID_INPUT', message: parsed } };
  }
  const record = await storage.getAppByOwnerName(ref.owner, ref.filename);
  if (!record) {
    return { refusal: { status: 404, code: 'NOT_FOUND', message: `No app "${appRef}" on this node.` } };
  }

  const put = await putProgramMap(storage, config, caller, record.ownerGaii, ref.filename, body, at);
  if ('refusal' in put) return put;
  return { app: appRef, dataMap: put.map, stamp: put.stamp, findings: put.findings };
}

/**
 * Store a map beside an app that already exists, and stamp the manifest from it.
 *
 * The three steps that make a map real — validate it, write the record, restamp the app — with no
 * opinion about who may do it. Its two callers answer that differently and both are right:
 * stateProgramMap above is a person or their agent editing their own app's promises, and the
 * package installer is an app arriving from somewhere else carrying the map its author wrote.
 *
 * The stamp is computed HERE rather than carried, and that is the whole reason a package ships the
 * map document instead of the stamp: a stamp addresses `apps.<id>.datamap`, and the installed copy's
 * id is not the author's. Carried, it would point at a record that does not exist on this node.
 */
export async function putProgramMap(
  storage: Storage, config: AimeatConfig, caller: DataMapCaller,
  ownerGhii: string, filename: string, body: Partial<DataMap>, at: string,
): Promise<{ map: DataMap; stamp: DataMapStamp; findings: MapCheck['findings'] } | DataMapRefusal> {
  const parsed = readMap(body, at);
  if (typeof parsed === 'string') {
    return { refusal: { status: 400, code: 'INVALID_INPUT', message: parsed } };
  }
  const appId = appIdOf(filename);
  const writeCaller: MemoryWriteCaller = {
    principal: caller.principal,
    targetGaii: `${caller.ownerName}@${config.nodeId}`,
    roles: caller.roles,
    scopes: caller.scopes,
  };
  const written = await writeAppDataMap({ storage, config }, writeCaller, appId, parsed);
  if (!written.ok) {
    return {
      refusal: {
        status: written.status, code: written.code ?? 'WRITE_REFUSED',
        message: written.message ?? 'The map could not be stored.',
      },
    };
  }

  // The app's declared scopes decide whether the map must say that the app invites people.
  const scopes = declaredScopesOf(await storage.getApp(ownerGhii, filename));
  const stamp = stampFor(parsed, appId, at, scopes);
  await storage.updateAppMeta(ownerGhii, filename, { dataMap: stamp });
  return { map: parsed, stamp, findings: checkMap(parsed, at, scopes).findings };
}

export interface HandsAnswer {
  key: string;
  hands: {
    writer: string; writes: number; deletes: number;
    firstAt: string; lastAt: string; namespace: string;
  }[];
  notCovered: string[];
}

/** Said the same way wherever a tally number is rendered. */
export const HANDS_NOT_COVERED = [
  'Counting started when this was switched on. A key written before that and never written since has no hands here, and never will.',
  'It counts what came in through a door somebody was behind. AIMEAT also writes to your store on its own, and that is not a hand.',
];

/**
 * How many hands have been on one key.
 *
 * OWNER SCOPE, because a namespace is not an account. An agent writing its own copy of a key lands
 * under the AGENT, so an owner asking about their own key would otherwise be told nobody had touched
 * it while their agent was writing it every minute.
 */
export async function handsOnKey(
  storage: Storage, config: AimeatConfig, caller: DataMapCaller, key: string,
): Promise<HandsAnswer> {
  const ownerGhii = `${caller.ownerName}@${config.nodeId}`;
  const agents = await storage.getAgentsByOwner(caller.ownerName);
  const namespaces = [...new Set([ownerGhii, caller.principal, ...agents.map(a => a.gaii)])];
  const rows = (await Promise.all(
    namespaces.map(ns => storage.listMemoryWriteTally({ ownerGaii: ns, key })),
  )).flat();

  return {
    key,
    hands: rows.map(r => ({
      writer: r.writerPrincipal, writes: r.writeCount, deletes: r.deleteCount,
      firstAt: r.firstAt, lastAt: r.lastAt, namespace: r.ownerGaii,
    })),
    notCovered: HANDS_NOT_COVERED,
  };
}
