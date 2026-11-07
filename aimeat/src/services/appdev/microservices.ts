/**
 * @file src/services/appdev/microservices.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `microservices` part of aimeat_appdev_overview: when an app's server-side work has
 *   outgrown an extension, which Microservices Central the builder may put a service on, and the
 *   criteria for suggesting one at all.
 *
 *   TWO PLACES A CENTRAL IS NAMED. The person's own: the memory record `microservices.central`
 *   ({ url, project? }) in their namespace, written when an admin of that Central approved their
 *   access request. The node's: the operator setting AIMEAT_MSC_CENTRAL_URL
 *   (config.microservicesCentralUrl), a Central the operator offers every account. The person's own
 *   wins. Neither holds a key: the person's key lives in their own AI client's connection to that
 *   Central, and an app's key in its extension's secret setting, so nothing here can call Central.
 *
 *   THE NODE NEVER CONNECTS TO A CENTRAL. It only names the address to the builder; the builder's AI
 *   and the extension's ctx.fetch make every call. That is also why the record is not configuration
 *   the server acts on (security/trusted-key-exemptions.json).
 *
 *   The owner's record is read as the caller may: through ownerScopeView (an agent without
 *   memory:read-as-owner sees it only when it is not private) and then the caller's classification
 *   reader, as every content read is.
 * @structure MICROSERVICES_RECORD_KEY · centralUrl(v) · microservicesFor(storage, config, ownerGhii, view, reader)
 * @usage import { microservicesFor } from './appdev/microservices.js'; (services/appdev-overview.ts)
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (wish-mikropalvelu-osaksi-aimeatin-sovelluskehityst-ja-p-syrekiste).
 */

import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { ownerScopeView } from '../owner-scope-read.js';
import type { OwnerScopeViewer } from '../appdev-kb.js';
import type { ContentReader } from '../classification/reader.js';
import { presentMemory } from '../classification/present-memory.js';

/** The person's own Central, in their namespace. */
export const MICROSERVICES_RECORD_KEY = 'microservices.central';

/** An http(s) address with no credentials in it, without a trailing slash; null otherwise. */
export function centralUrl(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim() || v.length > 300 || !URL.canParse(v.trim())) return null;
  const u = new URL(v.trim());
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
  return u.toString().replace(/\/+$/, '');
}

export async function microservicesFor(
  storage: Storage, config: AimeatConfig, ownerGhii: string, view: OwnerScopeViewer, reader: ContentReader,
): Promise<Record<string, unknown>> {
  const record = await storage.getMemory(ownerGhii, MICROSERVICES_RECORD_KEY);
  const inScope = record && ownerScopeView([record], view.principal, view.readsAll).length > 0 ? record : null;
  const shown = inScope ? await presentMemory(reader, inScope) : null;
  const value = (shown?.value ?? null) as { url?: unknown; project?: unknown } | null;
  const ownUrl = centralUrl(value?.url);
  const nodeUrl = centralUrl(config.microservicesCentralUrl);
  const project = typeof value?.project === 'string' && value.project ? value.project : null;
  const central = ownUrl
    ? { url: ownUrl, from: 'owner', ...(project ? { project } : {}), mcp: `${ownUrl}/mcp` }
    : nodeUrl ? { url: nodeUrl, from: 'node', mcp: `${nodeUrl}/mcp` } : null;
  const timeoutS = Math.round(config.extensionTimeoutMs / 100) / 10;

  return {
    central,
    ...(value && !ownUrl ? { record_problem: `${MICROSERVICES_RECORD_KEY} holds no usable url (an http or https address without a user name or password); it is ignored.` } : {}),
    suggest_when: [
      `the work takes longer than one extension run (${timeoutS} s of CPU, ${config.extensionMaxMemoryMb} MB on this node), or many runs chained for one answer`,
      'a process or a connection stays open: a websocket, a queue consumer, a feed followed all day',
      'a language or a library the extension sandbox cannot load: Python, a native binary, a model',
      'a relational database of its own, or more data than memory records hold (1024 kB per value, about 1000 keys per account)',
      'the data is to be kept apart from the node, for performance or separation',
      'a service that already runs elsewhere is to be adopted',
    ],
    stay_with_extension: 'When an extension and memory records cover the work, stay with them: a service is one more thing that runs, costs and needs looking after. Suggest one in a sentence that says why, and build it only on the person\'s yes.',
    next: central
      ? `Have the person connect ${central.mcp} to their AI with their own key (claude mcp add --transport http msc ${central.mcp} --header "Authorization: Bearer <their key>"), then call msc_guide and msc_whoami there and follow them.`
      : 'No Central is named for this person. When a service would fit, tell them so and that they need a Microservices Central: the operator can name one for the node (AIMEAT_MSC_CENTRAL_URL), or they ask one for access and keep its address in the memory record named in `record`. Never build the service somewhere else.',
    record: `aimeat_memory_write { key: "${MICROSERVICES_RECORD_KEY}", value: { url, project }, visibility: "owner" } names the person's own Central and their project there. Never a key in it.`,
    skill: 'node:aimeat-extension-builder, section 11 (when an extension is not enough): the access request, the keys, the extension that calls the service, the data map',
  };
}
