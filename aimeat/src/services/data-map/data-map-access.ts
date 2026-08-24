/**
 * @file src/services/data-map/data-map-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The decisions behind the data map, in one place that takes the CALLER and returns a
 *   refusal or a result. The HTTP route and the MCP tools both call these and neither decides
 *   anything of its own.
 *
 *   WHY IT IS SHAPED THIS WAY. Writing a capability twice is what produced 315 measured differences
 *   between the MCP surface and REST in the August 2026 audit, including agents deleting another
 *   owner's extension and memory writes with no size limit. The lint rule that refuses
 *   `storage.*` inside an MCP tool is what sent this file into existence, and it was right to.
 * @structure DataMapRefusal · readProgramMap · stateProgramMap · handsOnKey
 * @usage import { readProgramMap } from './data-map-access.js';
 * @version-history
 *   v1.0.0 — 2026-08-25 — TARGET-073. Extracted the moment the same rules needed a second door.
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { MemoryWriteCaller } from '../memory-write.js';
import { parseAppScopes } from '../protected-resource.js';
import { readAppDataMap, writeAppDataMap, stampFor } from './data-map-store.js';
import { lintDataMap } from './data-map-lint.js';
import {
  publicDataMap, DATA_MAP_SPEC, type DataMap, type DataMapStamp,
} from './data-map-types.js';

export interface DataMapRefusal {
  refusal: { status: number; code: string; message: string };
}

export interface ProgramMapResult {
  app: string;
  dataMap: DataMap;
  stamp: DataMapStamp | null;
  hints?: string[];
}

/** Who is asking, in the terms every door already resolves. */
export interface DataMapCaller {
  /** The resolved principal: a GHII, a GAII or a GEAI. */
  principal: string;
  /** The bare owner name behind that principal. */
  ownerName: string;
  roles: string[];
  scopes: string[];
}

const appIdOf = (filename: string): string => filename.replace(/\.html$/i, '');

/** "owner/filename.html" → the pair every app address uses, or null when it is not that shape. */
export function splitAppRef(ref: string): { owner: string; filename: string } | null {
  const slash = ref.indexOf('/');
  if (slash <= 0 || slash === ref.length - 1) return null;
  return { owner: ref.slice(0, slash), filename: ref.slice(slash + 1) };
}

/**
 * One app's map.
 *
 * The rows are public and the finding is not: where an app puts data is the promise it makes to
 * whoever installs it, and the publish check's `gap` is the owner's own unfinished business.
 */
export async function readProgramMap(
  storage: Storage, config: AimeatConfig, caller: DataMapCaller | null, appRef: string,
): Promise<ProgramMapResult | DataMapRefusal> {
  const ref = splitAppRef(appRef);
  if (!ref) {
    return { refusal: { status: 400, code: 'INVALID_INPUT', message: 'Name the app as "owner/filename.html".' } };
  }
  const bare = ref.owner.includes('@') ? ref.owner.split('@')[0] : ref.owner;
  const record = await storage.getAppByOwnerName(bare, ref.filename);
  if (!record) {
    return { refusal: { status: 404, code: 'NOT_FOUND', message: `No app "${appRef}" on this node.` } };
  }
  const map = await readAppDataMap(storage, record.ownerGaii, appIdOf(ref.filename));
  if (!map) {
    return {
      refusal: {
        status: 404, code: 'NOT_FOUND',
        message: `"${appRef}" has no data map yet. One is written at its next publish.`,
      },
    };
  }
  const isOwn = !!caller && caller.ownerName === record.ownerName;
  return {
    app: appRef,
    dataMap: isOwn ? map : publicDataMap(map),
    stamp: record.manifest.dataMap ?? null,
  };
}

/**
 * State one app's map, replacing what it said before.
 *
 * The account is the check, not the role: an owner session and that owner's agent both write here
 * and a different PERSON never does. An app grant is refused outright — it is scoped to one app and
 * must not be able to restate another one's promises.
 */
export async function stateProgramMap(
  storage: Storage, config: AimeatConfig, caller: DataMapCaller, appRef: string, body: Partial<DataMap>,
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
  if (body.spec !== DATA_MAP_SPEC) {
    return {
      refusal: {
        status: 400, code: 'INVALID_INPUT',
        message: `A data map must carry spec "${DATA_MAP_SPEC}".`,
      },
    };
  }
  const record = await storage.getAppByOwnerName(ref.owner, ref.filename);
  if (!record) {
    return { refusal: { status: 404, code: 'NOT_FOUND', message: `No app "${appRef}" on this node.` } };
  }

  const at = new Date().toISOString();
  const appId = appIdOf(ref.filename);
  const html = /html/i.test(record.mimeType) ? record.data.toString('utf8') : '';
  const lint = lintDataMap({
    map: {
      spec: DATA_MAP_SPEC,
      form: body.form ?? 'mixed',
      held: Array.isArray(body.held) ? body.held : [],
      elsewhere: Array.isArray(body.elsewhere) ? body.elsewhere : [],
      // Somebody wrote this, so it is declared however it arrived. Only the node's own draft may
      // call itself derived.
      source: 'declared',
      at,
    },
    scopes: parseAppScopes(html), programId: appId, at, declaresNothing: false,
  });

  const writeCaller: MemoryWriteCaller = {
    principal: caller.principal,
    targetGaii: `${ref.owner}@${config.nodeId}`,
    roles: caller.roles,
    scopes: caller.scopes,
  };
  const written = await writeAppDataMap({ storage, config }, writeCaller, appId, lint.map);
  if (!written.ok) {
    return {
      refusal: {
        status: 422, code: 'WRITE_REFUSED',
        message: written.message ?? 'The map could not be stored.',
      },
    };
  }
  const stamp = stampFor(lint.map, appId);
  await storage.updateAppMeta(record.ownerGaii, ref.filename, { dataMap: stamp });
  return { app: appRef, dataMap: lint.map, stamp, hints: lint.hints };
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
