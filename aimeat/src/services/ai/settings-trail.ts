/**
 * @file src/services/ai/settings-trail.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The account event an applied change to the person's AI settings writes: the routing
 *   (routing.ts setRouting), the model rules (policy-store.ts setOwnerAiPolicy), the roles (roles.ts
 *   setRoles), the image rules (gen-rules-store.ts setOwnerGenRules) and a provider's model
 *   (provider-model.ts setProviderModel).
 *
 *   WHY. An agent proposes such a change and applies it with a confirm token the client holds, so the
 *   owner's confirmation happens in the chat, outside the node. Without a row the person could not
 *   see later that the change was made, when, and by which agent. The row is the existing
 *   `ai_settings_changed` event the budget change writes (routes/ai.ts): `changed` names the setting,
 *   not the values, and `by` names the agent or app when it was not the person in their own session.
 *   A proposal writes nothing; only an applied change does.
 * @structure AiSettingsChange · recordAiSettingsApplied(storage, ownerGhii, actor, changed)
 * @usage await recordAiSettingsApplied(storage, gaii, actor.kind === 'agent' ? actor.principal : null, 'routing');
 * @version-history
 *   v1.1.0 — 2026-11-20 — 'provider model': the model of one capability of an owner's provider.
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, report 2.3).
 */
import type { Storage } from '../../storage/interface.js';
import { recordAccountEvent } from '../account/events.js';

/** Which AI setting changed, as the feed line names it. */
export type AiSettingsChange = 'routing' | 'model rules' | 'roles' | 'image rules' | 'provider model';

/**
 * Write the account event of an applied change. `by` is the agent's or app's identity when one
 * applied it, null when the person did in their own session. Never throws (recordAccountEvent logs a
 * failure), and is awaited so the row is there when the caller's answer arrives.
 */
export async function recordAiSettingsApplied(
  storage: Storage, ownerGhii: string, by: string | null, changed: AiSettingsChange,
): Promise<void> {
  await recordAccountEvent(storage, {
    ownerGhii,
    kind: 'ai_settings_changed',
    actorGaii: by ?? ownerGhii,
    link: '/v1/profile?tab=ai',
    data: { changed, ...(by ? { by } : {}) },
  });
}
