/**
 * @file providers-social.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three outbound providers that arrived on 2026-10-15 for the LÄHETIN social desk:
 *   a Facebook Page, an Instagram professional account, and Reddit. A pure extension of the registry
 *   in providers.ts, kept in its own file because that one sits at the max-file-lines boundary.
 *
 *   WHAT THE THREE HAVE IN COMMON, AND WHY IT IS NEW. Every earlier provider's token is the account:
 *   the code is exchanged and what comes back publishes. Here the authorization round yields a token
 *   that must be TURNED INTO the publishing credential afterwards:
 *     - Facebook answers with a short-lived USER token. A Page is published to with a PAGE token,
 *       read from /me/accounts after the user token has been exchanged for a long-lived one. A page
 *       token derived from a long-lived user token does not expire, so the stored credential has no
 *       expiry and no refresh token, which is the honest state rather than a gap.
 *     - Instagram (the "Instagram API with Instagram Login" path, which needs no Facebook Page)
 *       answers with a one-hour token that is exchanged for a 60-day one, and renewed by its own GET
 *       rather than by a refresh_token grant.
 *     - Reddit issues a refresh token only when the authorize round asked for `duration=permanent`,
 *       and refuses a request that carries no descriptive User-Agent.
 *   services/connections/social-finish.ts performs those steps; this file only describes the
 *   providers.
 *
 *   FREE, AND WHAT THAT MEANS. Meta charges nothing for the Graph API. An app in development mode,
 *   or live with standard access, serves the accounts of people who hold a role on the app without
 *   App Review: that is the company's own Page and Instagram account, which is the use this was
 *   built for. Serving other people's accounts needs Advanced Access and App Review, which is a
 *   process at Meta, not code here. Reddit's API is free for this volume; its policy asks a new app
 *   to be registered and described.
 * @structure facebook · instagram · reddit · REDDIT_USER_AGENT · GRAPH_VERSION
 * @usage import { facebook, instagram, reddit } from './providers-social.js';
 * @version-history
 *   v1.0.0 — 2026-10-15 — Facebook Page, Instagram (Instagram Login) and Reddit.
 */

import type { OutboundProvider } from './providers-types.js';

/**
 * The Graph API version every Meta call names. Meta retires a version about two years after it
 * ships, and an absent or retired one answers with an error that does not name the version, so it
 * is one named constant rather than a literal in each call.
 */
export const GRAPH_VERSION = 'v26.0'; // released 2026-07-29; v25.0 is served until 2028-07-29

/** Base addresses. Instagram Login tokens are spoken to graph.instagram.com, never graph.facebook.com. */
export const FACEBOOK_GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const FACEBOOK_GRAPH_VIDEO = `https://graph-video.facebook.com/${GRAPH_VERSION}`;
export const INSTAGRAM_GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;

/**
 * Reddit refuses, or throttles to nothing, a request whose User-Agent is generic. Its rules ask for
 * `<platform>:<app id>:<version> (by /u/<name>)`; the node names itself, and the account a request
 * acts for is in its token.
 */
export const REDDIT_USER_AGENT = 'server:aimeat-node:4 (AIMEAT outbound connections; https://aimeat.io)';

function disabledReason(capabilityOn: boolean, configured: boolean, envBase: string): string | null {
  if (capabilityOn && configured) return null;
  return !capabilityOn
    ? 'connections capability is off (AIMEAT_CONNECTIONS_ENABLED)'
    : `no client credentials (${envBase}_CLIENT_ID / _SECRET)`;
}

/**
 * A Facebook Page.
 *
 * The connection is the PAGE, not the person: `externalId` is the page id and the label is the
 * page's name, because that is where a post lands and what the owner reads in the panel. A person
 * who manages several pages names the one they mean when they start the round (`account`), and a
 * person who names none gets their only page, or the first one with a note in the label.
 *
 * pages_read_user_content and pages_manage_engagement are what let the node read the comments on
 * the page's own posts (the replies reader). pages_read_engagement is the reactions and the counts.
 */
export function facebook(
  clientId: string, clientSecret: string, capabilityOn: boolean, configId = '',
): OutboundProvider {
  const configured = Boolean(clientId && clientSecret);
  return {
    id: 'facebook',
    label: 'Facebook Page',
    credentialShape: 'oauth2',
    instanceScoped: false,
    enabled: capabilityOn && configured,
    capabilityOn,
    disabledReason: disabledReason(capabilityOn, configured, 'AIMEAT_CONNECT_FACEBOOK'),
    client: configured ? { id: clientId, secret: clientSecret } : null,
    scopes: [
      'pages_show_list', 'pages_manage_posts', 'pages_read_engagement',
      'pages_read_user_content', 'pages_manage_engagement',
    ],
    scopeSeparator: ',',
    // A Business app signs in through Facebook Login for Business, whose dialog takes the id of a
    // configuration made in the app dashboard (token type, assets, permissions). The scopes are
    // still sent, which Meta allows, so a node without the id still asks for the right things.
    ...(configId ? { authorizeParams: { config_id: configId } } : {}),
    // Meta's login dialog does not document PKCE for a confidential web client (its PKCE flow is
    // still marked as in testing); the secret is the proof at the token endpoint.
    pkce: false,
    tokenAuth: 'body',
    offlineAccess: false,
    capabilities: ['publish-post', 'publish-video', 'read-metrics', 'read-replies'],
    attachFields: null,
    // Meta limits per page and per app by usage over time rather than by a fixed daily count.
    sharedDailyLimit: null,
    endpoints() {
      return {
        authorize: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`,
        token: `${FACEBOOK_GRAPH}/oauth/access_token`,
        // There is no token revocation endpoint. DELETE /me/permissions needs the USER token, which
        // is not kept: only the page token is stored. Disconnecting is local, and the owner removes
        // the app from their Facebook settings to withdraw the grant there.
        revoke: null,
      };
    },
  };
}

/**
 * An Instagram professional (business or creator) account, through Instagram Login.
 *
 * NOT through Facebook Login, deliberately: that path needs the Instagram account linked to a
 * Facebook Page and a Page token, which is two accounts and two consents for one thing. Instagram
 * Login is one account and one consent, and it is the path Meta documents for publishing now.
 *
 * Publishing takes media at a PUBLIC address that Instagram fetches; there is no binary upload for
 * an image. services/connections/media-handoff.ts serves the stored file at a short-lived address
 * for exactly that fetch.
 */
export function instagram(clientId: string, clientSecret: string, capabilityOn: boolean): OutboundProvider {
  const configured = Boolean(clientId && clientSecret);
  return {
    id: 'instagram',
    label: 'Instagram',
    credentialShape: 'oauth2',
    instanceScoped: false,
    enabled: capabilityOn && configured,
    capabilityOn,
    disabledReason: disabledReason(capabilityOn, configured, 'AIMEAT_CONNECT_INSTAGRAM'),
    client: configured ? { id: clientId, secret: clientSecret } : null,
    scopes: [
      'instagram_business_basic', 'instagram_business_content_publish',
      'instagram_business_manage_comments', 'instagram_business_manage_insights',
    ],
    scopeSeparator: ',',
    pkce: false,
    tokenAuth: 'body',
    offlineAccess: false,
    // No publish-post: Instagram has no text-only post, and advertising one would put a button in
    // front of a person that can only ever be refused.
    capabilities: ['publish-image', 'publish-video', 'read-metrics', 'read-replies'],
    attachFields: null,
    // 100 API-published posts in a rolling 24 hours, per ACCOUNT rather than per app, so it is not
    // the shared ceiling this field models.
    sharedDailyLimit: null,
    // A 60-day token renewed by its own GET, which Meta accepts only once the token is a day old and
    // not yet expired. Renewing a week ahead gives a connection that is used weekly a chance to renew.
    refreshSkewMs: 7 * 24 * 60 * 60 * 1000,
    endpoints() {
      return {
        authorize: 'https://www.instagram.com/oauth/authorize',
        token: 'https://api.instagram.com/oauth/access_token',
        revoke: null,
      };
    },
  };
}

/**
 * Reddit, for posting to a subreddit the company runs and reading the comments there.
 *
 * `duration=permanent` is what makes a refresh token arrive at all, the same silent trap as Google's
 * access_type=offline: without it the token dies in an hour and nothing said so. The secret goes in
 * an HTTP Basic header, as on X.
 */
export function reddit(clientId: string, clientSecret: string, capabilityOn: boolean): OutboundProvider {
  const configured = Boolean(clientId && clientSecret);
  return {
    id: 'reddit',
    label: 'Reddit',
    credentialShape: 'oauth2',
    instanceScoped: false,
    enabled: capabilityOn && configured,
    capabilityOn,
    disabledReason: disabledReason(capabilityOn, configured, 'AIMEAT_CONNECT_REDDIT'),
    client: configured ? { id: clientId, secret: clientSecret } : null,
    // identity names the account, submit posts, read reads the comments and the counts back.
    scopes: ['identity', 'submit', 'read'],
    pkce: false,
    tokenAuth: 'basic',
    offlineAccess: false,
    authorizeParams: { duration: 'permanent' },
    tokenHeaders: { 'User-Agent': REDDIT_USER_AGENT },
    // Text and link posts. An image or a video goes through Reddit's media-asset upload, which is
    // not part of its documented API, so a file is refused rather than dropped.
    capabilities: ['publish-post', 'read-metrics', 'read-replies'],
    attachFields: null,
    sharedDailyLimit: null,
    endpoints() {
      return {
        authorize: 'https://www.reddit.com/api/v1/authorize',
        token: 'https://www.reddit.com/api/v1/access_token',
        revoke: 'https://www.reddit.com/api/v1/revoke_token',
      };
    },
  };
}
