/**
 * @file src/services/sso-overview.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one read behind the Organisation sign-in page: the connections, and the two
 *   node-wide switches that decide whether any of them does anything.
 *
 *   WHAT NO SURFACE COULD ANSWER. A connection can be complete — the company created, their
 *   identity provider's metadata read, a provisioning token minted, the connection listed — and
 *   nobody can sign in, because `sso.enabled` is off and both public doors answer 503. That
 *   ordering is deliberate (config-types-enterprise-sso.ts: "a node is configured first and
 *   switched on second"), which is exactly why a surface has to say which of the two phases the
 *   node is in. The page showed five setup steps; the real sequence has six, and the sixth is a
 *   setting on another page.
 *
 *   THE SECOND SWITCH IS INVISIBLE THE SAME WAY. `sso.connections_locked` makes every admin write
 *   answer 403, so on a frozen node the create button looks pressable and the operator learns
 *   otherwise by pressing it. It is reported here so a surface can say so before the press.
 *
 *   THREE CONDITIONS DECIDE ONE OUTCOME. A company's button appears on the public sign-in page
 *   only when the feature is on AND its SAML half is configured AND it is listed rather than
 *   hidden — held in three places (routes/libs.ts reads all three). "Is their button up right now"
 *   is the operator's actual question, and `button_showing` is it, computed once here rather than
 *   inferred from a Listed/Hidden column.
 * @structure
 *   - SsoConnectionState — the one word for where a connection stands, and the one thing in its way
 *   - buildSsoOverview(config, storage) — connections + node switches + the summary
 * @usage
 *   import { buildSsoOverview } from '../services/sso-overview.js';
 *   const data = await buildSsoOverview(config, storage);
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the Organisation sign-in page's rebuild.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { listSsoConnectionViews, getSsoConnectionView, type SsoConnectionView } from './sso-connections.js';
import { logger } from '../utils/logger.js';

/**
 * Where one connection stands, as one word.
 *
 * `blocked_by_switch` is the state the old page could not express at all: everything an operator
 * can do on the page IS done, and the thing in the way is somewhere else.
 */
export type SsoConnectionState =
  /** Step 2 has not happened: no identity provider, so there is nowhere to send anybody. */
  | 'no_idp'
  /** Fully configured, and the node-wide switch is off. Nothing here fixes it. */
  | 'blocked_by_switch'
  /** Live, and its button is on the public sign-in page. */
  | 'live'
  /** Live, and deliberately off the public page: its people use a direct link. */
  | 'live_hidden';

export interface SsoConnectionRow extends SsoConnectionView {
  state: SsoConnectionState;
  /** Could a person at this company get in at this moment? */
  can_sign_in: boolean;
  /** Is this company's button on the public sign-in page right now? */
  button_showing: boolean;
  /** How many of the six steps are done, so a surface can say "5 of 6" without recounting. */
  steps_done: number;
}

/** The six steps, in the order the setup actually happens. The sixth is not on this page. */
export const SSO_STEPS_TOTAL = 6;

function rowFor(c: SsoConnectionView, enabled: boolean): SsoConnectionRow {
  const listed = c.login_visibility === 'listed';
  const canSignIn = enabled && c.saml_configured;
  const buttonShowing = canSignIn && listed;

  const state: SsoConnectionState = !c.saml_configured
    ? 'no_idp'
    : !enabled
      ? 'blocked_by_switch'
      : listed ? 'live' : 'live_hidden';

  // Counted the way the page numbers them: exists, IdP read, findable, token minted, somebody has
  // signed in, the door is open. The fifth cannot happen before the sixth, which is the whole
  // point of reporting the sixth.
  const steps_done =
    1
    + (c.saml_configured ? 1 : 0)
    + 1                                        // visibility is always decided, listed or hidden
    + (c.scim_token_configured ? 1 : 0)
    + (c.last_login_at ? 1 : 0)
    + (enabled ? 1 : 0);

  return { ...c, state, can_sign_in: canSignIn, button_showing: buttonShowing, steps_done };
}

/**
 * One connection, with the same derived fields the list carries.
 *
 * The single-connection read used to return the raw view, so a surface showing one company had no
 * `state`, no `can_sign_in` and no `steps_done` and had to infer them — which is how the detail
 * view came to say "0 of 6" beside a list that said 4 of 6. Two reads of the same thing must
 * answer the same thing.
 */
export async function buildSsoConnectionRow(
  config: AimeatConfig,
  storage: Storage,
  id: string,
): Promise<SsoConnectionRow | null> {
  const view = await getSsoConnectionView(config, storage, id);
  return view ? rowFor(view, !!config.ssoEnabled) : null;
}

/**
 * Everything the Organisation sign-in page shows, in one read.
 *
 * The node block is the half that was missing. It is cheap — two config reads and a count — and it
 * is what turns a list of connections into an answer about whether anybody can sign in.
 */
export async function buildSsoOverview(
  config: AimeatConfig,
  storage: Storage,
): Promise<Record<string, unknown>> {
  const enabled = !!config.ssoEnabled;
  const views = await listSsoConnectionViews(config, storage);
  const connections = views.map(c => rowFor(c, enabled));

  // The account count is for the empty state, which has to say what connecting a company would
  // change. "61 accounts, every one of them a password" is the before; it is not a health metric.
  let accounts: number;
  try {
    accounts = (await storage.listOwners()).length;
  } catch (err) {
    // A count that cannot be read is left at zero rather than failing the page; the sentence that
    // uses it degrades to the general case. Logged, because a storage read that fails here is
    // failing everywhere and this is a cheap place to notice it.
    logger.warn('sso-overview: could not count accounts for the empty state', { error: String(err) });
    accounts = 0;
  }

  return {
    node: {
      /** The master switch. While false, the SAML door and the SCIM door both answer 503. */
      enabled,
      /** Where an operator changes it — this page cannot, and saying so is the point. */
      enabled_setting: 'sso.enabled',
      /** While true, every write on this page answers 403 SEALED_CONFIG. */
      locked: !!config.ssoConnectionsLocked,
      locked_setting: 'sso.connections_locked',
      accounts,
    },
    connections,
    summary: {
      total: connections.length,
      /** Complete, and waiting only on the node-wide switch. */
      blocked_by_switch: connections.filter(c => c.state === 'blocked_by_switch').length,
      /** Not yet configured at the identity provider. */
      incomplete: connections.filter(c => c.state === 'no_idp').length,
      /** Buttons on the public sign-in page at this moment. */
      buttons_showing: connections.filter(c => c.button_showing).length,
      /** Companies whose people could get in right now, by button or by direct link. */
      can_sign_in: connections.filter(c => c.can_sign_in).length,
      /** Has anybody actually arrived this way, and has any directory ever called? */
      logins_seen: connections.filter(c => !!c.last_login_at).length,
      directories_calling: connections.filter(c => !!c.last_scim_request_at).length,
      steps_total: SSO_STEPS_TOTAL,
    },
  };
}
