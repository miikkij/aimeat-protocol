/**
 * @file src/services/connections/delegation-caller.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may publish through a delegation over a shared channel.
 *
 *   A delegation gives ONE app one action over a channel, and the app's users publish through it: a
 *   campaign where many people post through one app. The publish names the delegation by the app id
 *   and action in the request body, and those are labels a channel owner types, so the body alone
 *   does not say that the caller is the app or one of its users. This module answers that from the
 *   signed token instead (secaudit2026oct26, delegated-publish/app-id-not-bound-to-caller).
 *
 *   WHO PUBLISHES THROUGH IT, unchanged from before:
 *     - the app itself, through any user's grant for it (the token's signed `app` claim);
 *     - an ecosystem app the delegation names (the token's signed `eco_app` claim);
 *     - a person who uses the app (a live grant for it), in person or through their agents;
 *     - the channel owner, in person, through their agents or through their own apps.
 *   A caller that is none of these only wrote the app's name in the body, and is refused with a
 *   sentence that names the app to publish through.
 *
 *   THE LABEL. Delegations were written as free labels (`app:funvids` in the suite) and keep working
 *   as they are, with no stored change: `app:` and `eco:` in front are dropped, and the rest names an
 *   app the way the AI doors already accept a body app id (services/ai-app-id.ts namesSignedApp): its
 *   file name with or without `.html`, or its full `owner/filename`. A channel owner who types the full
 *   `owner/filename` binds the delegation to exactly that app.
 *
 *   THE AUTHOR (round 8c). A label that is only a file name matches an app of that name by any author,
 *   so the delegation is bound to one author's app (services/connections/delegation-binding.ts): the
 *   channel owner's own app binds it at once; an app by another author waits for the channel owner's
 *   one-press answer the first time it publishes, and the caller is answered pending.
 * @structure namesDelegationApp · DelegationCallerDecision · delegationCallerDecision
 * @usage const d = await delegationCallerDecision({ storage, config }, req.auth!, appId, action);
 * @version-history
 *   2026-10-29 — A delegation whose label is a bare file name belongs to one author's app: the channel
 *     owner's own app binds it, another author's app asks the channel owner once and answers pending
 *     until then, and an app the delegation is not bound to is refused (secaudit2026oct26 round 8c,
 *     delegated-publish/app-id-not-bound-to-caller).
 *   2026-10-27 — Initial (secaudit2026oct26, delegated-publish/app-id-not-bound-to-caller).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { VerifiedToken } from '../../auth/jwt.js';
import { namesSignedApp } from '../ai-app-id.js';
import { localAccountOf, ownerGhiiOf, resolveIdentity } from '../../utils/gaii.js';
import { serialByKey } from '../../utils/serial-by-key.js';
import { filePublishRequest, readPublishRequest, effectiveState } from '../publish-requests/store.js';
import {
  bareLabel, labelNamesAuthor, readDelegationApp, bindDelegationApp, ownAppOf, noteAsked, noteDeclined, tellBoundToOwnApp,
} from './delegation-binding.js';
import { logger } from '../../utils/logger.js';

/** True when a delegation's label names the signed app `signed` (`owner/filename`). */
export function namesDelegationApp(label: string, signed: string): boolean {
  const bare = bareLabel(label);
  return bare !== '' && namesSignedApp(bare, signed);
}

/** True when a delegation's label names the ecosystem app `ecoApp` (its global name). */
function namesEcoApp(label: string, ecoApp: string): boolean {
  return bareLabel(label).toLowerCase() === ecoApp.trim().toLowerCase();
}

export interface DelegationCallerRefusal { code: 'DELEGATION_NOT_FOR_CALLER'; reason: string }

/** What the channel owner is asked, as the publish answers it while the question waits. */
export interface DelegationPending {
  request_id: string;
  status: 'awaiting_owner';
  waiting_for: 'channel_owner';
  asks: string;
  why: string;
  expires_at: string;
  already_waiting: boolean;
  next_step: string;
}

export type DelegationCallerDecision =
  | { kind: 'pass' }
  | { kind: 'refuse'; refusal: DelegationCallerRefusal }
  | { kind: 'pending'; pending: DelegationPending };

const PASS: DelegationCallerDecision = { kind: 'pass' };
const fileOf = (app: string) => app.slice(app.indexOf('/') + 1);
const authorOf = (app: string) => app.slice(0, app.indexOf('/'));

/**
 * Pass when the caller may publish through the delegation (appId, action), or when there is no such
 * delegation (the publish gate answers that one as before). Otherwise the refusal to send, or the
 * channel owner's question the publish waits for.
 */
export async function delegationCallerDecision(
  ctx: { storage: Storage; config: AimeatConfig },
  auth: VerifiedToken,
  appId: string,
  action: string,
): Promise<DelegationCallerDecision> {
  const { storage, config } = ctx;
  const delegation = await storage.findDelegation(appId, action);
  if (!delegation) return PASS;
  const connection = await storage.getConnection(delegation.connectionId);
  if (!connection) return PASS;

  // The channel owner, and every principal acting for them.
  const channelOwner = ownerGhiiOf(connection.principal);
  const callerOwner = ownerGhiiOf(resolveIdentity(auth, config.nodeId));
  if (callerOwner === channelOwner) return PASS;

  const label = delegation.appId;
  const refuse = (extra = ''): DelegationCallerDecision => ({
    kind: 'refuse',
    refusal: {
      code: 'DELEGATION_NOT_FOR_CALLER',
      reason: `The channel owner gave the action "${action}" to the app "${label}"${extra}, so it is published through that app. `
        + 'Open that app, sign in to it, and publish from there. After that, your agents can publish through it for you too.',
    },
  });

  if (auth.roles.includes('ecosystem')) return auth.eco_app && namesEcoApp(label, auth.eco_app) ? PASS : refuse();

  // The apps the caller publishes as: an app as itself (its own signed id, never the body's), and a
  // person or their agent as each app they hold a live grant for.
  let apps: string[];
  if (auth.roles.includes('app')) {
    apps = auth.app && namesDelegationApp(label, auth.app) ? [auth.app] : [];
  } else {
    const account = localAccountOf(callerOwner);
    const grants = account ? await storage.listAppGrantsByOwner(account) : [];
    apps = [...new Set(grants.filter(g => !g.revoked && namesDelegationApp(label, g.app)).map(g => g.app))];
  }
  if (!apps.length) return refuse();
  // A label that names its author binds the delegation by itself.
  if (labelNamesAuthor(label)) return PASS;

  // One answer at a time per delegation, so a campaign's first users do not ask the channel owner twice.
  return serialByKey(`delegation-app ${delegation.id}`, async () => {
    let bound = await readDelegationApp(storage, config.nodeId, delegation.id);
    if (!bound.app) {
      // Positive evidence: the channel owner's own app of that file name.
      const own = await ownAppOf(storage, channelOwner, label);
      if (own) {
        bound = await bindDelegationApp(storage, config.nodeId, delegation.id, own, 'own-app');
        if (bound.app === own) await tellBoundToOwnApp(storage, channelOwner, { label, action, app: own });
      }
    }
    if (bound.app) {
      const boundApp = bound.app;
      return apps.some(a => namesSignedApp(boundApp, a)) ? PASS : refuse(` made by ${authorOf(boundApp)}`);
    }

    // Not bound: the first app by another author that is not already kept out asks the channel owner.
    const owner = channelOwner;
    for (const app of apps) {
      if (bound.declined.includes(app)) continue;
      const askedId = bound.asked[app];
      const asked = askedId ? await readPublishRequest(storage, owner, askedId) : null;
      const state = asked ? effectiveState(asked) : null;
      if (state === 'declined') {
        await noteDeclined(storage, config.nodeId, delegation.id, app);
        continue;
      }
      if (state === 'approved') {
        // The applier bound it; read again, since a press may have landed after the read above.
        const now = await readDelegationApp(storage, config.nodeId, delegation.id);
        if (now.app && namesSignedApp(now.app, app)) return PASS;
        continue;
      }
      // Asked already and still waiting: every user of the app sees the same question, asked once.
      if (asked && state === 'awaiting_owner' && asked.approval) return pendingOf(asked.id, asked.expires_at, asked.approval, true);
      return await askChannelOwner(ctx, {
        owner, delegationId: delegation.id, label, action, app, channel: connection.accountLabel || connection.provider,
        asker: callerOwner, sub: auth.sub,
      });
    }
    return refuse(' and did not allow this one');
  });
}

/** Ask the channel owner once whether `app` may publish through the delegation; answer pending. */
async function askChannelOwner(
  ctx: { storage: Storage; config: AimeatConfig },
  q: { owner: string; delegationId: string; label: string; action: string; app: string; channel: string; asker: string; sub: string },
): Promise<DelegationCallerDecision> {
  const file = fileOf(q.app);
  const author = authorOf(q.app);
  const asks = `let the app ${file} by ${author} publish "${q.action}" through your channel ${q.channel}`;
  const why = `You let the app "${q.label}" publish "${q.action}" on this channel, but named it only by its file name. This app of that name was made by ${author}, not by you. `
    + `If you allow it, only ${author}'s app may use the permission from now on, and an app of the same name by anyone else may not. If you do not, this app may not publish on your channel.`;
  const filed = await filePublishRequest(ctx, q.owner, {
    kind: 'delegation-binding',
    target: { delegation: q.delegationId, app: q.app, label: q.label, action: q.action },
    title: `the app ${file} by ${author} on your delegation "${q.label}"`,
    name: `${file} (${author})`,
    change: { field: 'delegation.app', from: null, to: q.app },
    requested_by: { principal: q.asker, kind: 'person', sub: q.sub },
    approval: {
      approver: 'owner',
      asks,
      why,
      // An agent of the channel owner that may change their connections may answer it.
      approve_scope: 'connections:write',
      i18n: { key: 'approval_delegation_binding', vars: { app: file, author, label: q.label, action: q.action, channel: q.channel } },
    },
  });
  if (!filed.ok) {
    logger.warn('delegation app: the channel owner could not be asked; nothing is published', { owner: q.owner, delegation: q.delegationId, app: q.app, error: filed.message });
    return {
      kind: 'refuse',
      refusal: {
        code: 'DELEGATION_NOT_FOR_CALLER',
        reason: `The channel owner gave the action "${q.action}" to the app "${q.label}" and has not yet said whether the app ${file} by ${author} may use it. They could not be asked just now (${filed.message}). Try again later.`,
      },
    };
  }
  await noteAsked(ctx.storage, ctx.config.nodeId, q.delegationId, q.app, filed.request.id);
  return pendingOf(filed.request.id, filed.request.expires_at, { asks, why }, filed.alreadyWaiting);
}

/** The pending answer of a publish that waits for the channel owner's question. */
function pendingOf(id: string, expiresAt: string, words: { asks: string; why: string }, alreadyWaiting: boolean): DelegationCallerDecision {
  return {
    kind: 'pending',
    pending: {
      request_id: id,
      status: 'awaiting_owner',
      waiting_for: 'channel_owner',
      asks: words.asks,
      why: words.why,
      expires_at: expiresAt,
      already_waiting: alreadyWaiting,
      next_step: `Nothing was published. The channel owner was asked once to ${words.asks}, and the question waits until ${expiresAt.slice(0, 10)}. `
        + 'The one who asked first hears the answer in their notifications. Publish again after the channel owner allows it.',
    },
  };
}
