/**
 * @file src/services/cortex-visibility.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A cortex library's visibility and the publish gate in front of it (plan
 *   doc-mvcn6c7e4e5q, V4). A public cortex is listed and readable by every account on the node
 *   (canSeeCortex, services/cortex-lifecycle.ts): its manifest, prompts, ontology and component map.
 *   It becomes public three ways: the manifest's own `metadata.visibility: public` on an install
 *   (POST /v1/cortex, aimeat_cortex_install, a cortex ZIP), the same on the create branch of the
 *   upsert (PUT /v1/cortex/:name, update:true, a ZIP under a new name), and POST
 *   /v1/cortex/:name/visibility. An agent without publish:public (an app grant too when the gate
 *   covers apps) gets the cortex at `private`, and the owner a request to approve.
 *
 *   setCortexVisibility() is the body of POST /v1/cortex/:name/visibility, moved here so an approved
 *   request runs the same write as the owner's own change.
 * @structure CortexGateAsk · cortexPublishAsk · fileCortexAsk · cortexAskedFields · setCortexVisibility
 * @usage
 *   const ask = cortexPublishAsk(deps, input.publishGate, undefined, ext.visibility);   // before the first write
 *   if (ask) ext.visibility = 'private';
 *   const asked = ask ? await fileCortexAsk(deps, input.publishGate, ask, record) : {};
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, CortexExtensionRecord } from '../storage/interface.js';
import { emitChange } from './event-bus.js';
import { isRaiseToPublic } from './publish-gate.js';
import { publishAskOf, type PublishAsk } from './publish-requests/ask.js';
import {
  fileAskForDoor, type DoorAsk, type PublishGateInput, type PublishNotAsked, type PublishRequestedBody,
} from './publish-requests/door.js';

export type CortexGateAsk = Extract<PublishAsk, { kind: 'ask' | 'refused' }>;
type Ctx = { storage: Storage; config: AimeatConfig };

/** Ask the gate when a cortex is to become public from `from` (nothing, on an install). Null: go ahead. */
export function cortexPublishAsk(ctx: Ctx, gate: PublishGateInput | undefined, from: string | undefined, to: unknown): CortexGateAsk | null {
  if (!gate || !isRaiseToPublic(from, to)) return null;
  const ask = publishAskOf(ctx, gate.caller, gate.app);
  return ask.kind === 'allowed' ? null : ask;
}

/** File the request once the cortex exists at the level it kept. */
export async function fileCortexAsk(
  ctx: Ctx, gate: PublishGateInput | undefined, ask: CortexGateAsk | null,
  record: Pick<CortexExtensionRecord, 'name' | 'version' | 'visibility'>,
): Promise<DoorAsk> {
  if (!gate || ask?.kind !== 'ask' || record.visibility === 'public') return {};
  return fileAskForDoor(ctx, gate, ask.requester, {
    kind: 'cortex',
    // The manifest version: a kept version never takes other bytes, so new content is a new version.
    target: { name: record.name, version: record.version },
    title: `the cortex library ${record.name}`, name: record.name,
    change: { field: 'visibility', from: record.visibility, to: 'public' },
  }, record.visibility);
}

/**
 * What an install answer adds for a filed request, the same on REST, MCP and the ZIP upload:
 * `publish_request`, and a PUBLISH_NOT_ASKED entry after the manifest's own warnings.
 */
export function cortexAskedFields(asked: DoorAsk | undefined, warnings: string[] | undefined): {
  warnings?: Array<string | PublishNotAsked>; publish_request?: PublishRequestedBody;
} {
  const all = [...(warnings ?? []), ...(asked?.warnings ?? [])];
  return {
    ...(warnings !== undefined || all.length ? { warnings: all } : {}),
    ...(asked?.publishRequest ? { publish_request: asked.publishRequest } : {}),
  };
}

/** Set a cortex's visibility. The caller has already decided it may (the owner, or an operator). */
export async function setCortexVisibility(ctx: Ctx, name: string, visibility: 'public' | 'private'): Promise<CortexExtensionRecord | null> {
  const updated = await ctx.storage.updateCortexExtension(name, { visibility });
  emitChange('cortex');
  return updated;
}
