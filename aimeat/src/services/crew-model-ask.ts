/**
 * @file src/services/crew-model-ask.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A crew model choice with its own address, set by an app, waits for the owner's
 *   one-press answer under the approval standard (services/approval-standard.ts).
 *
 *   WHY (secaudit2026oct22, lead 228; Jouni, 2026-10-25). A `model` choice names base_url and
 *   api_key_env, and the crew runtime on the owner's machine sends the owner's provider key to that
 *   address (python/aimeat-crewai crew_llm.py). Round 6 refused every app grant (535879c69, reverted by
 *   f65075a5b). The developer: an app grant may set the choice again, made safe. So a choice of kind
 *   node or profile, a model choice that names no address of its own, and a clear apply at once; a
 *   model choice that names an address, set by an app grant or an ecosystem app, is filed for the
 *   owner, and the crew keeps the model it has until the owner allows it. The owner and the owner's
 *   agents set any choice at once, as before.
 *
 *   WHAT AN APPROVAL WRITES. Exactly the choice that was asked, checked again (crew-menu.ts
 *   checkLlmChoice), for the same agent, as the owner (publish-requests/apply-crew-model.ts).
 * @structure isAppCaller · needsOwnerForChoice · askOwnerForCrewModel
 * @usage
 *   if (needsOwnerForChoice(caller.roles, valid)) return { ok: true, key, cleared: false, ...await askOwnerForCrewModel(ctx, ...) };
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, lead 228 reworked; the approval standard).
 */
import { fileAsk, publishRequestedBody } from './publish-requests/ask.js';
import type { PublishRequester, PublishStoreCtx } from './publish-requests/store.js';
import { choiceAddresses } from './crew-llm-guard.js';
import { logger } from '../utils/logger.js';

/** The largest choice a request carries; a real one is a few hundred characters. */
const MAX_CHOICE_CHARS = 4000;

/** An app grant or an ecosystem app: software the owner approved, not the owner or their agent. */
export function isAppCaller(roles: readonly string[]): boolean {
  return roles.includes('app') || roles.includes('ecosystem');
}

/** Does this checked choice, from these roles, wait for the owner? A model choice naming an address, set by an app. */
export function needsOwnerForChoice(roles: readonly string[], choice: Record<string, unknown>): boolean {
  return isAppCaller(roles) && choice.kind === 'model' && choiceAddresses(choice.provider).length > 0;
}

/** The host part of an address, for a person to read; the address itself when it does not parse. */
const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host : url);

export type CrewModelAsk =
  | { approval_request: ReturnType<typeof publishRequestedBody> }
  | { warnings: Array<{ code: 'APPROVAL_NOT_ASKED'; message: string }> };

/** File the owner's question about a model address an app chose. Never throws. */
export async function askOwnerForCrewModel(
  ctx: PublishStoreCtx,
  args: { owner: string; agentName: string | null; key: string; choice: Record<string, unknown>; requester: PublishRequester },
): Promise<CrewModelAsk> {
  const choice = JSON.stringify(args.choice);
  if (choice.length > MAX_CHOICE_CHARS) {
    return { warnings: [{ code: 'APPROVAL_NOT_ASKED', message: `The choice is longer than ${MAX_CHOICE_CHARS} characters, so it was not saved or asked about.` }] };
  }
  const provider = (args.choice.provider ?? {}) as Record<string, unknown>;
  const hosts = choiceAddresses(provider).map(hostOf);
  const keyEnv = typeof provider.api_key_env === 'string' ? provider.api_key_env : 'its provider key';
  const whom = args.agentName ? `your agent ${args.agentName}` : 'all your agents';
  try {
    const filed = await fileAsk(ctx, args.owner, args.requester, {
      kind: 'crew-model',
      target: { key: args.key, agent: args.agentName ?? '', choice },
      title: `the model address ${hosts.join(', ')} for ${args.agentName ? `the agent ${args.agentName}` : 'every agent'}`,
      name: args.agentName ?? 'all agents',
      change: { field: args.key, from: null, to: 'model' },
      approval: {
        approver: 'owner',
        asks: `point ${whom} at the model address ${hosts.join(', ')}`,
        why: `The crew sends your provider key (${keyEnv}) to that address when it thinks. An app set it, so you confirm the address first; until then the crew keeps the model it has.`,
        // An agent of the owner sets any choice at once, so one holding memory:write may approve it.
        approve_scope: 'memory:write',
        // The answered notice says where the model is changed later: the agent's Crew tab.
        change: {
          link: args.agentName ? `/v1/profile?tab=agents&agent=${encodeURIComponent(args.agentName)}` : '/v1/profile?tab=agents',
          key: 'approval_change.crew',
        },
        i18n: {
          key: args.agentName ? 'approval_crew_model' : 'approval_crew_model_default',
          vars: { agent: args.agentName ?? '', host: hosts.join(', '), key: keyEnv },
        },
      },
    });
    if (filed.ok) return { approval_request: publishRequestedBody(ctx, filed) };
    return { warnings: [{ code: 'APPROVAL_NOT_ASKED', message: `The owner was not asked, so the crew keeps the model it has: ${filed.message}` }] };
  } catch (err) {
    logger.warn('crew model ask: the question could not be filed', { owner: args.owner, key: args.key, error: String(err) });
    return { warnings: [{ code: 'APPROVAL_NOT_ASKED', message: 'The owner could not be asked, so the crew keeps the model it has. Try again in a moment.' }] };
  }
}
