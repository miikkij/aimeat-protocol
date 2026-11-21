/**
 * @file src/services/extension/person-decision.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An extension action that is the person's own decision: the manifest says
 *   `decision: person` on it (a moderation act, a sale accept, a bid commit, a dispute open).
 *
 *   WHY. Such an action recorded whatever approve, reject or commit it was handed, whoever called it.
 *   An agent holding ext:invoke could make the person's decision through it, directly or through an
 *   app tool bound to it, and a tool description asking for the person's yes enforced nothing. The
 *   manifest had no field that said the decision is the person's, so no code path could tell.
 *
 *   WHAT THE MARK DOES.
 *     - A call by an agent or an ecosystem app does not run. It files one approval request in the
 *       caller's account (kind `extension-decision`, services/publish-requests/apply-extension-
 *       decision.ts), which only the account holder signed in themselves allows; on that one press the
 *       node runs the action as the person, with exactly the input the agent prepared. The caller is
 *       answered 202 with the request and the address where the person allows it.
 *     - The person in person (an owner session or an owner-level personal access token), an app the
 *       person signed in to (an app grant: the app's own control in the person's browser), a person
 *       registered to an app and a visitor call it as before. An action without the mark is unchanged.
 *     - A run with nobody present (a schedule, a workflow step, an AI provider or format call) is
 *       refused with the address where the person makes the decision (system-run.ts).
 *     - A run inside another run (ctx.buy's seller action) is refused the same way.
 *     - An app tool manifest that binds such an action is refused at the memory write
 *       (services/app-tools/decision-binding.ts): an app tool is something an AI calls.
 * @structure EXTENSION_DECISION_KIND · PersonDecisionAsk · askPersonToDecide
 *   (the mark's pure rules are decision-mark.ts, the person's own address decision-where.ts)
 * @usage
 *   if (isPersonDecision(action) && waitsForPerson(caller.kind)) return askPersonToDecide(ctx, { ... });
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (incident mwqdmtk8, extension actions that are the person's decision).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, ExtensionRecord } from '../../storage/interface.js';
import { fileAsk, publishRequestedBody } from '../publish-requests/ask.js';
import { memoryValueDigest } from '../publish-requests/store.js';
import { wherePersonDecides } from './decision-where.js';
import { PERSON_DECISION, PERSON_DECIDES, personDecidesText } from './decision-mark.js';

/** The publish request kind that carries an agent's prepared decision to the person. */
export const EXTENSION_DECISION_KIND = 'extension-decision' as const;

/** The most characters of input one prepared decision carries; a larger one is refused before filing. */
const INPUT_MAX_CHARS = 16_000;
/** How much of the input the person reads in the notice. */
const INPUT_PREVIEW_CHARS = 300;

type ExtensionAction = ExtensionRecord['actions'][number];

/** What the caller is answered: the filed request, or why none was filed. */
export type PersonDecisionAsk =
  | { ok: true; body: ReturnType<typeof publishRequestedBody> & { decision: typeof PERSON_DECISION; decide_yourself_at: string } }
  | { ok: false; status: number; code: string; message: string };

/**
 * File the agent's prepared decision in front of the person: one request in the caller's account,
 * which only the account holder signed in themselves allows. The request binds the extension, the
 * action, the instance, the exact input and a digest of the action's code, so an approval runs what
 * the person saw and nothing else (apply-extension-decision.ts). Nothing runs and nothing is charged here.
 */
export async function askPersonToDecide(
  ctx: { storage: Storage; config: AimeatConfig },
  args: {
    ext: ExtensionRecord;
    /** The stored name, with `@version` when the call pinned one: what the approval resolves again. */
    extRef: string;
    instanceId?: string;
    action: ExtensionAction;
    input: unknown;
    caller: { gaii: string; owner: string; kind: string };
  },
): Promise<PersonDecisionAsk> {
  const { ext, action, caller } = args;
  const where = await wherePersonDecides(ctx.config, ctx.storage, ext);
  const input = JSON.stringify(args.input ?? {});
  if (input.length > INPUT_MAX_CHARS) {
    return { ok: false, status: 413, code: PERSON_DECIDES,
      message: personDecidesText(ext.name, action.id, where, `its input is ${input.length} characters, more than the ${INPUT_MAX_CHARS} a request for the person's approval carries`) };
  }
  const preview = input.length > INPUT_PREVIEW_CHARS ? `${input.slice(0, INPUT_PREVIEW_CHARS)}…` : input;
  const requester = caller.kind === 'ecosystem'
    ? { principal: caller.gaii, kind: 'app' as const, sub: caller.gaii }
    : { principal: caller.gaii, kind: 'agent' as const, sub: caller.gaii };
  const filed = await fileAsk(ctx, caller.owner, requester, {
    kind: EXTENSION_DECISION_KIND,
    target: {
      extension: args.extRef,
      action: action.id,
      input,
      ...(args.instanceId ? { instance: args.instanceId } : {}),
      // The action's code when it was asked: an approval after the code changed runs nothing.
      digest: memoryValueDigest({ script: action.scriptContent, decision: action.decision ?? null }),
    },
    title: `the action ${action.id} of the extension ${ext.name}`,
    name: `${ext.name}/${action.id}`,
    change: { field: 'decision', from: null, to: input },
    approval: {
      approver: 'owner',
      asks: `run the action "${action.id}" of the extension ${ext.name} as your own decision, with the input ${preview}`,
      why: `The extension marks this action as the person's own decision, so an AI does not make it alone. If you allow it, the node runs it now as your act, with exactly this input. You can also make the decision yourself at ${where}.`,
      // The decision is the person's own: only they, signed in themselves, allow it; never an agent or an app.
      in_person: true,
      labels: { allow: 'Run it as my decision', deny: 'Do not run it', key: 'approval_extension_decision' },
      change: { link: '/v1/profile?tab=extensions', key: 'approval_change.extensions' },
      i18n: { key: 'approval_extension_decision', vars: { extension: ext.name, action: action.id, input: preview } },
    },
  });
  if (!filed.ok) return { ok: false, status: filed.status, code: filed.code, message: filed.message };
  const body = publishRequestedBody(ctx, filed);
  return {
    ok: true,
    body: {
      ...body,
      decision: PERSON_DECISION,
      decide_yourself_at: where,
      next_step: `${body.next_step} Do not call the action again: when the person allows it, the node runs it with the input you sent.`,
    },
  };
}
