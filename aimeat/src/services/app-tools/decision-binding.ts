/**
 * @file src/services/app-tools/decision-binding.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app tool manifest (`apps.{appId}.tools`) may not bind an extension action the
 *   manifest marks `decision: person` (services/extension/decision-mark.ts). An app tool is something
 *   an AI calls, and that action is the person's own decision: the person makes it in the app's own
 *   control, and the AI prepares a draft and reads the status. Refused at the write with 422
 *   PERSON_DECIDES naming each tool, its action and what to publish instead.
 *
 *   ONE CHECK FOR EVERY WRITE OF A MANIFEST: the shared memory write (services/memory/write.ts: POST
 *   and PUT /v1/memory, the node MCP aimeat_app_tools_publish, the connector and CLI surfaces, which
 *   post to /v1/memory), the bulk writes, the copy, PATCH /v1/memory/:key and the restore from the bin.
 *   Each calls decisionToolRefusal() where it calls legacyPacingWriteRefusal(). Any other key answers
 *   null without reading anything.
 *
 *   The call itself is gated as well, whatever the manifest says (services/extension/invoke.ts): an
 *   agent's call of such an action waits for the person. This check tells the author at the write
 *   instead of at the first call.
 * @structure decisionToolRefusal · DecisionToolRefusal
 * @usage
 *   const decided = await decisionToolRefusal(storage, targetGaii, key, value);
 *   if (decided) return decided;
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (incident mwqdmtk8).
 */
import type { Storage } from '../../storage/interface.js';
import { appIdFromToolsKey } from '../../models/app-tool-schemas.js';
import { findBackingCapability } from '../component/address.js';
import { resolveExtensionForCall } from '../component/versions.js';
import { isPersonDecision, PERSON_DECIDES } from '../extension/decision-mark.js';
import { localAccountName, ownerGhiiOf } from '../../utils/gaii.js';

export interface DecisionToolRefusal {
  ok: false;
  status: 422;
  code: typeof PERSON_DECIDES;
  message: string;
  details: { tools: Array<{ tool: string; action_id: string }> };
}

/**
 * `ext:<name>[@<version>]:<action>` split as capabilities/extension-ref.ts splitExtensionRef splits it
 * (a plain split, as the invoke path reads it). Written here rather than imported, so the memory write
 * that calls this file does not import the extension manifest validator.
 */
function splitExtensionRef(ref: string): { pinned: string; action: string } | null {
  const parts = ref.split(':');
  return parts.length === 3 && parts[0] === 'ext' && parts[1] && parts[2] ? { pinned: parts[1], action: parts[2] } : null;
}

/** Is the extension action this binding names marked as the person's decision? */
async function bindsPersonDecision(storage: Storage, actionId: string, ownerName: string): Promise<boolean> {
  // The binding names a capability (or an `ext:<name>:<action>` ref that is one), read as the
  // invoke paths read it: the capability's own ref, in its registrant's namespace.
  const cap = await findBackingCapability(storage, actionId, ownerName);
  const ref = cap ? (cap.source.type === 'extension' ? cap.source.ref : null) : actionId;
  const segments = ref ? splitExtensionRef(ref) : null;
  if (!segments) return false;
  const registrant = cap ? localAccountName(ownerGhiiOf(cap.ownerGhii)) : ownerName;
  const resolved = await resolveExtensionForCall(storage, segments.pinned, registrant);
  return resolved.ok && isPersonDecision(resolved.ext.actions.find(a => a.id === segments.action));
}

/**
 * The refusal for writing an app tool manifest whose tools bind an action marked `decision: person`,
 * or null. `namespace` is where the manifest is written; its owner names the extensions a bare name
 * resolves to.
 */
export async function decisionToolRefusal(
  storage: Storage, namespace: string, key: string, value: unknown,
): Promise<DecisionToolRefusal | null> {
  if (!appIdFromToolsKey(key)) return null;
  const tools = value && typeof value === 'object' && Array.isArray((value as { tools?: unknown }).tools)
    ? (value as { tools: unknown[] }).tools : [];
  const ownerName = localAccountName(ownerGhiiOf(namespace));
  const hits: Array<{ tool: string; action_id: string }> = [];
  for (const t of tools) {
    const tool = t as { name?: unknown; action_id?: unknown } | null;
    if (!tool || typeof tool.action_id !== 'string' || !tool.action_id) continue;
    if (await bindsPersonDecision(storage, tool.action_id, ownerName)) hits.push({ tool: String(tool.name ?? '?'), action_id: tool.action_id });
  }
  if (!hits.length) return null;
  return {
    ok: false, status: 422, code: PERSON_DECIDES,
    message: `${hits.map(h => `Tool "${h.tool}" is bound to ${h.action_id}`).join('; ')}, which its extension marks as the person's own decision (decision: person). `
      + 'An app tool is something an AI calls, and an AI does not make this decision: the person makes it in the app\'s own control. '
      + 'Leave these tools out, and publish tools that prepare a draft or read the status instead. '
      + 'An agent that calls the action directly waits for the person\'s approval.',
    details: { tools: hits },
  };
}
