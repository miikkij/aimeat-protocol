/**
 * @file src/services/connections/providers-mail.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MAIL providers, extracted from providers.ts at the max-file-lines boundary. A
 *   move, not a rewrite.
 *
 *   THEY COME IN READ/SEND PAIRS, and that is the one thing to understand before adding a third
 *   service here. Reading somebody's mail and writing in their name are different consent: a
 *   permission that is never requested cannot be misused, cannot be leaked, and does not have to be
 *   explained on a consent screen to a person who only wanted their invoices read. So Gmail is two
 *   entries and Outlook is two entries, and the panel groups each pair as one card with two
 *   switches — what a person SEES is one mailbox with two permissions.
 *
 *   MICROSOFT IS NOT GOOGLE WITH DIFFERENT URLS. Three differences, each silent if it is missed:
 *   the tenant is in the URL path; `offline_access` is a SCOPE where Google wants
 *   `access_type=offline` as a parameter (so these providers set `offlineAccess: false` WITH the
 *   scope in the list — YouTube's trap, exactly inverted); and the identity comes from Graph's
 *   `/me`, which needs `User.Read`.
 * @structure googleMail / googleMailSend / microsoftMail / microsoftMailSend · microsoftEndpoints
 *   · clampLimit
 * @usage import { googleMail, microsoftMail } from './providers-mail.js';
 * @version-history
 *   v1.0.0 — 2026-08-26 — Extracted from providers.ts.
 */
import type { OutboundProvider, OAuthEndpoints } from './providers.js';

/**
 * Gmail, read-only.
 *
 * THE FIRST CONNECTION THAT EXISTS TO BE READ RATHER THAN WRITTEN TO, and the reason the read
 * direction was built at all: mail is the connector everybody already has. A person forwards
 * themselves an invoice, a booking, a meter reading, and it sits in a mailbox no tool of theirs can
 * see.
 *
 * `gmail.readonly` and NOTHING else. Google offers scopes that send, delete and modify, and none of
 * them are asked for: a permission that is never requested cannot be misused, cannot be leaked and
 * does not have to be explained to the person on the consent screen. If sending ever becomes a
 * feature it becomes a SECOND provider entry with its own consent, not a wider scope on this one.
 *
 * Shares the Google client with YouTube, because they are one registered application at Google. The
 * scopes are what differ, and the consent screen names them.
 */
export function googleMail(clientId: string, clientSecret: string, capabilityOn: boolean): OutboundProvider {
  const configured = Boolean(clientId && clientSecret);
  const enabled = capabilityOn && configured;
  const READ = 'https://www.googleapis.com/auth/gmail.readonly';
  const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

  return {
    id: 'google-mail',
    label: 'Gmail',
    credentialShape: 'oauth2',
    instanceScoped: false,
    enabled,
    capabilityOn,
    disabledReason: enabled
      ? null
      : !capabilityOn
        ? 'connections capability is off (AIMEAT_CONNECTIONS_ENABLED)'
        : 'no client credentials (AIMEAT_CONNECT_GOOGLE_CLIENT_ID / _SECRET)',
    client: configured ? { id: clientId, secret: clientSecret } : null,
    scopes: [READ],
    pkce: true,
    tokenAuth: 'body',
    offlineAccess: true,
    // Reading is all it does. It carries no publish capability, so no surface offers it a post box.
    capabilities: ['read-mail'],
    sharedDailyLimit: null,
    attachFields: null,
    resources: {
      messages: {
        label: 'the list of messages',
        requiresScopes: [READ],
        url(params) {
          const limit = clampLimit(params.limit, 25, 100);
          const q = typeof params.query === 'string' ? params.query.slice(0, 500) : '';
          const page = typeof params.page_token === 'string' ? params.page_token.slice(0, 200) : '';
          const u = new URL(`${API}/messages`);
          u.searchParams.set('maxResults', String(limit));
          if (q) u.searchParams.set('q', q);
          if (page) u.searchParams.set('pageToken', page);
          return u.toString();
        },
      },
      message: {
        label: 'one message',
        requiresScopes: [READ],
        url(params) {
          const id = typeof params.id === 'string' ? params.id.trim() : '';
          // The id goes into the PATH, so it is checked rather than trusted: Gmail ids are
          // hexadecimal, and anything else here is either a mistake or an attempt to walk the URL
          // somewhere this node never meant to send a token.
          if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
            throw new Error('Name which message to open. The id comes from the message list.');
          }
          const u = new URL(`${API}/messages/${id}`);
          u.searchParams.set('format', params.format === 'raw' ? 'raw' : 'full');
          return u.toString();
        },
      },
      attachment: {
        label: 'a file attached to a message',
        requiresScopes: [READ],
        url(params) {
          // Gmail hands back attachments by REFERENCE rather than inline, so a message with a
          // 3 MB invoice on it is still a small answer and the bytes are fetched only when
          // somebody wants them. Both ids go into the path, so both are checked.
          const message = typeof params.message_id === 'string' ? params.message_id.trim() : '';
          const attachment = typeof params.attachment_id === 'string' ? params.attachment_id.trim() : '';
          if (!/^[A-Za-z0-9_-]{1,128}$/.test(message)) {
            throw new Error('Name which message the attachment is on. The id comes from the message list.');
          }
          if (!/^[A-Za-z0-9_-]{1,512}$/.test(attachment)) {
            throw new Error('Name which attachment. The id is on the message, under its parts.');
          }
          return `${API}/messages/${message}/attachments/${attachment}`;
        },
      },
      profile: {
        label: 'which mailbox this is',
        requiresScopes: [READ],
        url() { return `${API}/profile`; },
      },
      // The verified addresses this mailbox may send AS — Google Workspace aliases and any address
      // the person has confirmed in Gmail. It is READ here and used by the SENDING provider's From
      // picker, which is why a read-only connection is enough to populate it: `gmail.readonly` is
      // one of the scopes Google accepts for settings.sendAs.list, so the alias list costs nothing.
      //
      // This is the "just press a button" that people describe: the alias is configured once at
      // Google, and it then appears here without DNS, without a second mailbox licence, and with SPF
      // and DKIM already coming from the person's own domain, because the message really leaves
      // through their own Gmail.
      sendAs: {
        label: 'the addresses this mailbox may send as',
        requiresScopes: [READ],
        url() { return `${API}/settings/sendAs`; },
      },
    },
    endpoints: () => ({
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      revoke: 'https://oauth2.googleapis.com/revoke',
    }),
  };
}

/**
 * Gmail, sending.
 *
 * A SECOND PROVIDER RATHER THAN A WIDER SCOPE, which is the rule googleMail() above wrote down and
 * this is the first case of it: a permission that is never requested cannot be misused, cannot be
 * leaked, and does not have to be explained on a consent screen to somebody who only wants their
 * invoices read. A person who wants both presses two buttons; the panel groups them as one Gmail
 * card with two switches, so what they SEE is one mailbox with two permissions.
 *
 * `gmail.send` AND `userinfo.email`, and the second is not optional. `gmail.send` grants the write
 * and nothing else, so `users.getProfile` — how the node learns WHICH mailbox this is — comes back
 * 403 with a perfectly valid token. That identity is the dedupe key and the account label, so this
 * is the narrowest pair that actually works rather than a convenience. It is the same mistake
 * YouTube cost an hour to find, one product over.
 */
export function googleMailSend(clientId: string, clientSecret: string, capabilityOn: boolean): OutboundProvider {
  const configured = Boolean(clientId && clientSecret);
  const enabled = capabilityOn && configured;
  const SEND = 'https://www.googleapis.com/auth/gmail.send';
  const EMAIL = 'https://www.googleapis.com/auth/userinfo.email';

  return {
    id: 'google-mail-send',
    label: 'Gmail (sending)',
    credentialShape: 'oauth2',
    instanceScoped: false,
    enabled,
    capabilityOn,
    disabledReason: enabled
      ? null
      : !capabilityOn
        ? 'connections capability is off (AIMEAT_CONNECTIONS_ENABLED)'
        : 'no client credentials (AIMEAT_CONNECT_GOOGLE_CLIENT_ID / _SECRET)',
    client: configured ? { id: clientId, secret: clientSecret } : null,
    scopes: [SEND, EMAIL],
    pkce: true,
    tokenAuth: 'body',
    offlineAccess: true,
    // Sending is all it does. It carries no read-mail capability, so nothing offers it a mailbox to
    // search: reading is the other connection, with its own consent.
    capabilities: ['send-mail'],
    sharedDailyLimit: null,
    attachFields: null,
    endpoints: () => ({
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      revoke: 'https://oauth2.googleapis.com/revoke',
    }),
  };
}

/**
 * Microsoft mail, reading. Outlook.com and Microsoft 365, through Graph.
 *
 * THREE THINGS DIFFER FROM EVERY GOOGLE PROVIDER HERE, and each one is silent if it is missed:
 *
 *   THE TENANT IS IN THE URL. `/{tenant}/oauth2/v2.0/authorize` — 'common', 'organizations', or a
 *   directory GUID. A wrong tenant is a sign-in that fails at Microsoft with a message about the
 *   application, not about the tenant.
 *
 *   `offline_access` IS A SCOPE, NOT A PARAMETER. Google wants `access_type=offline&prompt=consent`
 *   in the authorize URL, which is what `offlineAccess: true` emits; Microsoft wants the scope and
 *   would ignore those parameters. So this is `offlineAccess: false` WITH the scope in the list —
 *   the same trap YouTube has, exactly inverted, and just as invisible: the connection authorises,
 *   works for an hour, and cannot renew.
 *
 *   THE IDENTITY IS `/me`, and it needs `User.Read`. Without it the connection has no dedupe key and
 *   no label, which fails at the very last step of somebody's first attempt.
 */
export function microsoftMail(
  clientId: string, clientSecret: string, tenant: string, capabilityOn: boolean,
): OutboundProvider {
  const configured = Boolean(clientId && clientSecret);
  const enabled = capabilityOn && configured;
  const GRAPH = 'https://graph.microsoft.com/v1.0/me';
  const READ = 'Mail.Read';

  return {
    id: 'microsoft-mail',
    label: 'Outlook',
    credentialShape: 'oauth2',
    instanceScoped: false,
    enabled,
    capabilityOn,
    disabledReason: enabled
      ? null
      : !capabilityOn
        ? 'connections capability is off (AIMEAT_CONNECTIONS_ENABLED)'
        : 'no client credentials (AIMEAT_CONNECT_MICROSOFT_CLIENT_ID / _SECRET)',
    client: configured ? { id: clientId, secret: clientSecret } : null,
    scopes: [READ, 'User.Read', 'offline_access'],
    pkce: true,
    tokenAuth: 'body',
    offlineAccess: false,
    capabilities: ['read-mail'],
    sharedDailyLimit: null,
    attachFields: null,
    resources: {
      messages: {
        label: 'the list of messages',
        requiresScopes: [READ],
        url(params) {
          const u = new URL(`${GRAPH}/messages`);
          u.searchParams.set('$top', String(clampLimit(params.limit, 25, 100)));
          // $search and $filter are mutually exclusive in Graph, and asking for both is a 400 that
          // names neither. The caller's `query` is a search when it is free text.
          const q = typeof params.query === 'string' ? params.query.slice(0, 500) : '';
          if (q) u.searchParams.set('$search', `"${q.replace(/"/g, '')}"`);
          else if (typeof params.filter === 'string') u.searchParams.set('$filter', params.filter.slice(0, 500));
          const page = typeof params.page_token === 'string' ? params.page_token.slice(0, 400) : '';
          if (page) u.searchParams.set('$skiptoken', page);
          return u.toString();
        },
      },
      message: {
        label: 'one message',
        requiresScopes: [READ],
        url(params) {
          const id = typeof params.id === 'string' ? params.id.trim() : '';
          // Into the PATH, so it is checked rather than trusted. Graph ids are long and base64url-ish
          // with the occasional '=' padding; anything outside that is a mistake or an attempt to walk
          // the URL somewhere this node never meant to send a token.
          if (!/^[A-Za-z0-9_\-=]{1,512}$/.test(id)) {
            throw new Error('Name which message to open. The id comes from the message list.');
          }
          return `${GRAPH}/messages/${id}`;
        },
      },
      attachment: {
        label: 'a file attached to a message',
        requiresScopes: [READ],
        url(params) {
          const message = typeof params.message_id === 'string' ? params.message_id.trim() : '';
          const attachment = typeof params.attachment_id === 'string' ? params.attachment_id.trim() : '';
          if (!/^[A-Za-z0-9_\-=]{1,512}$/.test(message)) {
            throw new Error('Name which message the attachment is on. The id comes from the message list.');
          }
          if (!/^[A-Za-z0-9_\-=]{1,512}$/.test(attachment)) {
            throw new Error('Name which attachment. The id is on the message, under its attachments.');
          }
          return `${GRAPH}/messages/${message}/attachments/${attachment}`;
        },
      },
      profile: {
        label: 'which mailbox this is',
        requiresScopes: ['User.Read'],
        url() { return GRAPH; },
      },
    },
    endpoints: (_instance, forTenant) => microsoftEndpoints(forTenant || tenant),
  };
}

/**
 * Microsoft mail, sending. The same three differences as the read half, plus one honest limit.
 *
 * `Mail.Send` LETS THE APP SEND AS THE SIGNED-IN MAILBOX, and the message lands in that mailbox's
 * Sent Items, which is the behaviour people actually want from this. Sending as a DIFFERENT address
 * — an alias, or a shared mailbox — is an Exchange SendAs permission granted by an administrator,
 * not a Graph scope this can request, so it is NOT advertised here and must be proven against a
 * real tenant before it is offered to anyone.
 */
export function microsoftMailSend(
  clientId: string, clientSecret: string, tenant: string, capabilityOn: boolean,
): OutboundProvider {
  const configured = Boolean(clientId && clientSecret);
  const enabled = capabilityOn && configured;

  return {
    id: 'microsoft-mail-send',
    label: 'Outlook (sending)',
    credentialShape: 'oauth2',
    instanceScoped: false,
    enabled,
    capabilityOn,
    disabledReason: enabled
      ? null
      : !capabilityOn
        ? 'connections capability is off (AIMEAT_CONNECTIONS_ENABLED)'
        : 'no client credentials (AIMEAT_CONNECT_MICROSOFT_CLIENT_ID / _SECRET)',
    client: configured ? { id: clientId, secret: clientSecret } : null,
    scopes: ['Mail.Send', 'User.Read', 'offline_access'],
    pkce: true,
    tokenAuth: 'body',
    offlineAccess: false,
    capabilities: ['send-mail'],
    sharedDailyLimit: null,
    attachFields: null,
    endpoints: (_instance, forTenant) => microsoftEndpoints(forTenant || tenant),
  };
}

/** One place that builds Microsoft's three URLs, so the tenant cannot end up in two of them. */
function microsoftEndpoints(tenant: string): OAuthEndpoints {
  // A tenant reaches this from config or from a principal's own client row, so it is checked rather
  // than interpolated: it goes into a URL path, and anything outside this shape is either a typo or
  // an attempt to send a token somewhere else.
  const safe = /^[A-Za-z0-9-]{1,64}$/.test(tenant) ? tenant : 'common';
  const base = `https://login.microsoftonline.com/${safe}/oauth2/v2.0`;
  return {
    authorize: `${base}/authorize`,
    token: `${base}/token`,
    // Microsoft's logout endpoint ends a SESSION; it does not retire a refresh token the way
    // Google's revoke does. Null is the honest value: revoking is local, and the person removes the
    // app's consent from their Microsoft account page if they want it gone at both ends.
    revoke: null,
  };
}

/** A caller-supplied count, made safe without an error: a silly number is a small number. */
function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}
