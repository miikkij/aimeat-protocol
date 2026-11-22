/**
 * @file src/services/publish-requests/apply-extension-decision.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The person allowed a decision one of their agents prepared: an extension action the
 *   manifest marks `decision: person` (services/extension/person-decision.ts filed it, marked
 *   `in_person`: only the account holder signed in themselves allows it). The applier runs exactly the
 *   action, the instance and the input the request names, as the person, through the same invoke
 *   sequence the person's own call takes (services/extension/invoke.ts): the paywall, the sandbox and
 *   the answer. The run sees `ctx.caller` as the person, because the decision is theirs.
 *
 *   NOT RUN, AND SETTLED OUTDATED WITH THE REASON: a request that does not name an action, a press by
 *   anyone but the account holder in person, an extension or an action that is gone, an action whose
 *   code changed since the request (the request binds a digest of it), and a run the paywall or the
 *   script refuses. The one who asked hears the answer either way (services/approval-standard.ts).
 *
 *   The run has no mail service: ctx.email answers false, as on every call path without one.
 * @structure applyExtensionDecision
 * @usage registered in appliers.ts under the kind 'extension-decision'
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (incident mwqdmtk8).
 */
import { localAccountName } from '../../utils/gaii.js';
import { invokeExtensionAction } from '../extension/invoke.js';
import { resolveExtensionForCall } from '../component/versions.js';
import { enforcePaywall } from '../extension-access/paywall.js';
import { createRefusalRecorder, refusalText } from '../extension-access/metered-response.js';
import { memoryValueDigest, type PublishApplyResult, type PublishDecidedBy, type PublishRequest, type PublishStoreCtx } from './store.js';

export async function applyExtensionDecision(
  ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest, decided?: PublishDecidedBy,
): Promise<PublishApplyResult> {
  const { extension, action: actionId, input, instance, digest } = request.target;
  if (typeof extension !== 'string' || typeof actionId !== 'string' || typeof input !== 'string' || typeof digest !== 'string') {
    return { ok: false, reason: 'this request does not name an extension action' };
  }
  // The decision is the person's own: only the account holder, signed in themselves, makes it.
  if (!decided || decided.kind !== 'human' || decided.by !== ownerGhii) {
    return { ok: false, reason: 'only the account holder, signed in themselves, makes this decision' };
  }
  const ownerName = localAccountName(ownerGhii);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(input) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'the input in this request does not parse' };
  }
  // The code the person was asked about, and nothing else: a changed action runs nothing.
  const now = await resolveExtensionForCall(ctx.storage, extension, ownerName);
  const action = now.ok ? now.ext.actions.find(a => a.id === actionId) : undefined;
  if (!action) return { ok: false, reason: `the action ${actionId} of the extension ${extension} is no longer installed` };
  if (memoryValueDigest({ script: action.scriptContent, decision: action.decision ?? null }) !== digest) {
    return { ok: false, reason: `the action ${actionId} of the extension ${extension} changed after it was asked` };
  }
  const recorder = createRefusalRecorder();
  const out = await invokeExtensionAction({
    config: ctx.config, storage: ctx.storage, enforcePaywall,
    extRef: extension,
    instanceId: typeof instance === 'string' && instance ? instance : undefined,
    actionId,
    input: parsed,
    // The person, as their own signed-in call is: roles ['owner'] and no scopes (requireScope's bypass).
    caller: { gaii: ownerGhii, metered: ownerGhii, owner: ownerName, kind: 'owner', roles: ['owner'], scopes: [], appGrantId: null },
    paywall: { res: recorder },
  });
  if (out.kind === 'ok') return { ok: true };
  if (out.kind === 'paywall') return { ok: false, reason: recorder.refusal ? refusalText(recorder.refusal) : 'the call was refused' };
  if (out.kind === 'refused') return { ok: false, reason: `the action answered ${out.code}: ${out.message}` };
  return { ok: false, reason: 'the action asked for the person again' };
}
