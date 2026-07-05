/**
 * @file email-templates.ts
 * @description Clean, minimal HTML email templates with AIMEAT branding. Supports 'en' (default)
 *   and 'fi' locales. Templates: verification code, magic link, notification, match suggestion,
 *   organism invitation, and provisioned-code access-key invitation.
 * @structure i18n string table + wrapHtml() layout + per-template builder functions.
 * @usage import { inviteEmailHtml, inviteEmailSubject } from './email-templates.js';
 * @version-history
 *   v1.0.0 — 2026-04-10 — Initial (verification, magic link, notification, match).
 *   v1.1.0 — 2026-07-04 — Add inviteEmailHtml/inviteEmailSubject + esc() for user-controlled fields.
 *   v1.2.0 — 2026-07-05 — Add keyInviteEmailHtml/keyInviteEmailSubject (provisioned-code access keys).
 *   v1.2.1 — 2026-07-05 — wrapHtml takes optional brand/footer; key-invite email shows the AIME♥AT
 *     wordmark + a "Sent from the AIMEAT machine room" footer (scoped to that template only).
 */

export interface MatchSuggestion {
  ghii: string;
  displayName: string;
  sharedInterests: string[];
  distance?: string;
}

// ── i18n strings ─────────────────────────────────────────

const i18n: Record<string, Record<string, string>> = {
  en: {
    verificationSubject: 'Your AIMEAT Verification Code',
    verificationHeading: 'Email Verification',
    verificationBody: 'Use the following code to verify your email address:',
    verificationExpiry: 'This code expires in 15 minutes.',
    verificationIgnore: 'If you did not request this, you can safely ignore this email.',
    magicLinkSubject: 'Your AIMEAT Login Link',
    magicLinkHeading: 'Sign In to AIMEAT',
    magicLinkBody: 'Click the button below to sign in to your account:',
    magicLinkButton: 'Sign In',
    magicLinkExpiry: 'This link expires in 15 minutes.',
    magicLinkIgnore: 'If you did not request this, you can safely ignore this email.',
    magicLinkFallback: 'Or copy and paste this URL into your browser:',
    notificationHeading: 'AIMEAT Notification',
    matchSubject: 'New Match Suggestions on AIMEAT',
    matchHeading: 'Match Suggestions',
    matchBody: 'We found some interesting matches for you:',
    matchSharedInterests: 'Shared interests:',
    matchDistance: 'Distance:',
    matchViewProfile: 'View Profile',
    inviteSubject: "You're invited to join {org} on AIMEAT",
    inviteHeading: "You're invited to AIMEAT",
    inviteSentence: '{inviter} invited you to join {org} on AIMEAT.',
    inviteNewAccount: "You don't need an account yet — the link below lets you register and join in a single step.",
    inviteWorkspacesLabel: "You'll get access to:",
    inviteButton: 'Accept invitation',
    inviteExpiryPrefix: 'This invitation expires on',
    inviteFallback: 'Or copy and paste this URL into your browser:',
    inviteIgnore: "If you weren't expecting this invitation, you can safely ignore this email.",
    inviteMessageLabel: 'Personal message:',
    keySubject: 'Your access key to {org} on AIMEAT',
    keyHeading: "You've received an access key",
    keyCodeLabel: 'Your access code:',
    keyInstructions: 'The code is your password, keep it to yourself.',
    keyButton: 'Enter',
    keyExpiryPrefix: 'This key expires on',
    keyFallback: 'Or copy and paste this address into your browser:',
    keyIgnore: "If you weren't expecting this key, you can safely ignore this email.",
    keyFooter: 'Sent from the AIMEAT machine room',
    roleViewer: 'viewer',
    roleContributor: 'contributor',
    footer: 'Sent by AIMEAT Protocol',
    footerUnsubscribe: 'Manage your notification settings in your AIMEAT profile.',
  },
  fi: {
    verificationSubject: 'AIMEAT-vahvistuskoodisi',
    verificationHeading: 'Sähköpostivahvistus',
    verificationBody: 'Käytä seuraavaa koodia sähköpostiosoitteesi vahvistamiseen:',
    verificationExpiry: 'Koodi vanhenee 15 minuutissa.',
    verificationIgnore: 'Jos et pyytänyt tätä, voit ohittaa tämän viestin.',
    magicLinkSubject: 'AIMEAT-kirjautumislinkkisi',
    magicLinkHeading: 'Kirjaudu AIMEAT-tilillesi',
    magicLinkBody: 'Klikkaa alla olevaa painiketta kirjautuaksesi tilillesi:',
    magicLinkButton: 'Kirjaudu',
    magicLinkExpiry: 'Linkki vanhenee 15 minuutissa.',
    magicLinkIgnore: 'Jos et pyytänyt tätä, voit ohittaa tämän viestin.',
    magicLinkFallback: 'Tai kopioi ja liitä tämä URL selaimeesi:',
    notificationHeading: 'AIMEAT-ilmoitus',
    matchSubject: 'Uusia ehdotuksia AIMEAT:ssa',
    matchHeading: 'Ehdotukset',
    matchBody: 'Löysimme sinulle mielenkiintoisia osumia:',
    matchSharedInterests: 'Yhteiset kiinnostukset:',
    matchDistance: 'Etäisyys:',
    matchViewProfile: 'Näytä profiili',
    inviteSubject: 'Sinut on kutsuttu liittymään: {org}',
    inviteHeading: 'Sinut on kutsuttu AIMEAT-palveluun',
    inviteSentence: '{inviter} kutsui sinut liittymään: {org}.',
    inviteNewAccount: 'Et tarvitse vielä tiliä — alla oleva linkki antaa sinun rekisteröityä ja liittyä yhdellä kertaa.',
    inviteWorkspacesLabel: 'Saat käyttöoikeuden:',
    inviteButton: 'Hyväksy kutsu',
    inviteExpiryPrefix: 'Tämä kutsu vanhenee',
    inviteFallback: 'Tai kopioi ja liitä tämä osoite selaimeesi:',
    inviteIgnore: 'Jos et odottanut tätä kutsua, voit ohittaa tämän viestin.',
    inviteMessageLabel: 'Henkilökohtainen viesti:',
    keySubject: 'Pääsyavaimesi: {org} — AIMEAT',
    keyHeading: 'Sait pääsyavaimen',
    keyCodeLabel: 'Pääsykoodisi:',
    keyInstructions: 'Koodi on salasanasi, pidä se omanasi.',
    keyButton: 'Astu sisään',
    keyExpiryPrefix: 'Tämä avain vanhenee',
    keyFallback: 'Tai kopioi ja liitä tämä osoite selaimeesi:',
    keyIgnore: 'Jos et odottanut tätä avainta, voit jättää viestin huomiotta.',
    keyFooter: 'Lähetetty AIMEATin konehuoneesta',
    roleViewer: 'katselija',
    roleContributor: 'osallistuja',
    footer: 'Lähetetty AIMEAT-protokollan kautta',
    footerUnsubscribe: 'Hallinnoi ilmoitusasetuksiasi AIMEAT-profiilissasi.',
  },
};

/** Minimal HTML escape for user-controlled fields interpolated into email HTML. */
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function t(locale: string | undefined, key: string): string {
  const lang = locale === 'fi' ? 'fi' : 'en';
  return i18n[lang][key] ?? i18n['en'][key] ?? key;
}

// ── Shared layout ────────────────────────────────────────

function wrapHtml(heading: string, bodyHtml: string, locale?: string, opts?: { brand?: string; footer?: string }): string {
  // brand/footer are trusted constants (never user input) — brand may carry inline HTML (e.g. a heart).
  const brand = opts?.brand ?? 'AIMEAT';
  const footer = opts?.footer ?? t(locale, 'footer');
  return `<!DOCTYPE html>
<html lang="${locale === 'fi' ? 'fi' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${heading}</title>
  <style>
    body { margin: 0; padding: 0; background: #f4f4f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    .container { max-width: 580px; margin: 0 auto; padding: 20px; }
    .card { background: #ffffff; border-radius: 8px; padding: 32px; margin-top: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .logo { text-align: center; padding: 20px 0 0; font-size: 24px; font-weight: 700; color: #333; letter-spacing: 1px; }
    .logo .hrt { color: #E8564A; }
    h1 { color: #333; font-size: 20px; margin: 0 0 16px; }
    p { color: #555; font-size: 15px; line-height: 1.6; margin: 0 0 12px; }
    .code { display: block; text-align: center; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #333; background: #f0f0f5; border-radius: 6px; padding: 16px; margin: 20px 0; }
    .btn { display: inline-block; background: #4f46e5; color: #ffffff !important; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-size: 15px; font-weight: 600; margin: 16px 0; }
    .url-fallback { word-break: break-all; font-size: 13px; color: #777; }
    .footer { text-align: center; padding: 20px 0; font-size: 12px; color: #999; }
    .match-card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin: 12px 0; }
    .match-name { font-weight: 600; color: #333; font-size: 16px; }
    .match-ghii { font-size: 13px; color: #777; }
    .match-interests { font-size: 13px; color: #555; margin-top: 8px; }
    .match-distance { font-size: 13px; color: #888; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">${brand}</div>
    <div class="card">
      <h1>${heading}</h1>
      ${bodyHtml}
    </div>
    <div class="footer">
      <p>${footer}</p>
      <p>${t(locale, 'footerUnsubscribe')}</p>
    </div>
  </div>
</body>
</html>`;
}

// ── Template functions ───────────────────────────────────

export function verificationEmailHtml(code: string, locale?: string): { html: string; text: string } {
  const html = wrapHtml(t(locale, 'verificationHeading'), `
    <p>${t(locale, 'verificationBody')}</p>
    <div class="code">${code}</div>
    <p>${t(locale, 'verificationExpiry')}</p>
    <p style="color: #999; font-size: 13px;">${t(locale, 'verificationIgnore')}</p>
  `, locale);

  const text = [
    t(locale, 'verificationHeading'),
    '',
    t(locale, 'verificationBody'),
    '',
    `  ${code}`,
    '',
    t(locale, 'verificationExpiry'),
    '',
    t(locale, 'verificationIgnore'),
    '',
    `-- ${t(locale, 'footer')}`,
  ].join('\n');

  return { html, text };
}

export function magicLinkEmailHtml(loginUrl: string, locale?: string): { html: string; text: string } {
  const html = wrapHtml(t(locale, 'magicLinkHeading'), `
    <p>${t(locale, 'magicLinkBody')}</p>
    <p style="text-align: center;">
      <a href="${loginUrl}" class="btn">${t(locale, 'magicLinkButton')}</a>
    </p>
    <p>${t(locale, 'magicLinkExpiry')}</p>
    <p style="font-size: 13px; color: #999;">${t(locale, 'magicLinkFallback')}</p>
    <p class="url-fallback">${loginUrl}</p>
    <p style="color: #999; font-size: 13px;">${t(locale, 'magicLinkIgnore')}</p>
  `, locale);

  const text = [
    t(locale, 'magicLinkHeading'),
    '',
    t(locale, 'magicLinkBody'),
    '',
    loginUrl,
    '',
    t(locale, 'magicLinkExpiry'),
    '',
    t(locale, 'magicLinkIgnore'),
    '',
    `-- ${t(locale, 'footer')}`,
  ].join('\n');

  return { html, text };
}

export interface InviteEmailArgs {
  orgName: string;
  inviterName: string;
  acceptUrl: string;
  workspaces: { ws: string; role: string }[];
  message?: string | null;
  expiresLabel?: string; // preformatted date string for display
}

/** Subject line for an invitation email. */
export function inviteEmailSubject(orgName: string, locale?: string): string {
  return t(locale, 'inviteSubject').replace('{org}', orgName);
}

export function inviteEmailHtml(args: InviteEmailArgs, locale?: string): { html: string; text: string } {
  const roleLabel = (role: string) => t(locale, role === 'contributor' ? 'roleContributor' : 'roleViewer');
  const sentence = t(locale, 'inviteSentence')
    .replace('{inviter}', esc(args.inviterName))
    .replace('{org}', `<strong>${esc(args.orgName)}</strong>`);

  const wsHtml = args.workspaces.length > 0
    ? `<p style="margin-top:16px;">${t(locale, 'inviteWorkspacesLabel')}</p>
       <ul style="color:#555;font-size:14px;line-height:1.6;">
         ${args.workspaces.map(w => `<li>${esc(w.ws)} — ${roleLabel(w.role)}</li>`).join('\n')}
       </ul>`
    : '';
  const messageHtml = args.message
    ? `<p style="background:#f0f0f5;border-radius:6px;padding:12px;color:#444;"><em>${t(locale, 'inviteMessageLabel')}</em><br>${esc(args.message)}</p>`
    : '';
  const expiryHtml = args.expiresLabel
    ? `<p style="font-size:13px;color:#999;">${t(locale, 'inviteExpiryPrefix')} ${esc(args.expiresLabel)}.</p>`
    : '';

  const html = wrapHtml(t(locale, 'inviteHeading'), `
    <p>${sentence}</p>
    <p>${t(locale, 'inviteNewAccount')}</p>
    ${wsHtml}
    ${messageHtml}
    <p style="text-align: center;">
      <a href="${args.acceptUrl}" class="btn">${t(locale, 'inviteButton')}</a>
    </p>
    ${expiryHtml}
    <p style="font-size: 13px; color: #999;">${t(locale, 'inviteFallback')}</p>
    <p class="url-fallback">${args.acceptUrl}</p>
    <p style="color: #999; font-size: 13px;">${t(locale, 'inviteIgnore')}</p>
  `, locale);

  const text = [
    t(locale, 'inviteHeading'),
    '',
    t(locale, 'inviteSentence').replace('{inviter}', args.inviterName).replace('{org}', args.orgName),
    '',
    t(locale, 'inviteNewAccount'),
    '',
    ...(args.workspaces.length ? [t(locale, 'inviteWorkspacesLabel'), ...args.workspaces.map(w => `  - ${w.ws} (${roleLabel(w.role)})`), ''] : []),
    ...(args.message ? [`${t(locale, 'inviteMessageLabel')} ${args.message}`, ''] : []),
    args.acceptUrl,
    '',
    ...(args.expiresLabel ? [`${t(locale, 'inviteExpiryPrefix')} ${args.expiresLabel}.`, ''] : []),
    t(locale, 'inviteIgnore'),
    '',
    `-- ${t(locale, 'footer')}`,
  ].join('\n');

  return { html, text };
}

export interface KeyInviteEmailArgs {
  code: string;          // the access code (also the account password) — displayed once, prominently
  landingUrl: string;    // where the recipient enters the code
  orgName: string;
  inviterName: string;   // bare owner name of the inviter (available for future framing; body uses `message`)
  message?: string | null; // the caller-composed, already-localized explanation (operator vs referrer variant)
  expiresLabel?: string;
}

/** Subject line for a provisioned-code invitation ("key") email. */
export function keyInviteEmailSubject(orgName: string, locale?: string): string {
  return t(locale, 'keySubject').replace('{org}', orgName);
}

/** A provisioned-code invitation ("key") email: the M-ROOM-style explanation (from `message`) + the
 *  access code shown prominently + a CTA to the landing URL. All service-specific copy arrives in
 *  `message` (localized by the caller), so this template stays generic. */
export function keyInviteEmailHtml(args: KeyInviteEmailArgs, locale?: string): { html: string; text: string } {
  const messageHtml = args.message
    ? `<p style="background:#f0f0f5;border-radius:6px;padding:12px;color:#444;line-height:1.6;">${esc(args.message)}</p>`
    : '';
  const codeHtml = `<p style="margin:8px 0 4px;color:#555;font-size:14px;">${t(locale, 'keyCodeLabel')}</p>
    <p style="text-align:center;font-family:'Courier New',monospace;font-size:22px;font-weight:bold;letter-spacing:2px;background:#111;color:#fff;border-radius:6px;padding:14px;">${esc(args.code)}</p>`;
  const expiryHtml = args.expiresLabel
    ? `<p style="font-size:13px;color:#999;">${t(locale, 'keyExpiryPrefix')} ${esc(args.expiresLabel)}.</p>`
    : '';

  const html = wrapHtml(t(locale, 'keyHeading'), `
    ${messageHtml}
    ${codeHtml}
    <p>${t(locale, 'keyInstructions')}</p>
    <p style="text-align: center;">
      <a href="${args.landingUrl}" class="btn">${t(locale, 'keyButton')}</a>
    </p>
    ${expiryHtml}
    <p style="font-size: 13px; color: #999;">${t(locale, 'keyFallback')}</p>
    <p class="url-fallback">${args.landingUrl}</p>
    <p style="color: #999; font-size: 13px;">${t(locale, 'keyIgnore')}</p>
  `, locale, { brand: 'AIME<span class="hrt">&#9829;</span>AT', footer: t(locale, 'keyFooter') });

  const text = [
    t(locale, 'keyHeading'),
    '',
    ...(args.message ? [args.message, ''] : []),
    `${t(locale, 'keyCodeLabel')} ${args.code}`,
    '',
    t(locale, 'keyInstructions'),
    '',
    args.landingUrl,
    '',
    ...(args.expiresLabel ? [`${t(locale, 'keyExpiryPrefix')} ${args.expiresLabel}.`, ''] : []),
    t(locale, 'keyIgnore'),
    '',
    `-- ${t(locale, 'footer')}`,
  ].join('\n');

  return { html, text };
}

export function notificationEmailHtml(subject: string, body: string, locale?: string): { html: string; text: string } {
  const html = wrapHtml(subject, `
    <p>${body}</p>
  `, locale);

  const text = [
    subject,
    '',
    body,
    '',
    `-- ${t(locale, 'footer')}`,
  ].join('\n');

  return { html, text };
}

export function matchSuggestionEmailHtml(matches: MatchSuggestion[], locale?: string): { html: string; text: string } {
  const matchCardsHtml = matches.map(m => {
    const interests = m.sharedInterests.length > 0
      ? `<p class="match-interests">${t(locale, 'matchSharedInterests')} ${m.sharedInterests.join(', ')}</p>`
      : '';
    const distance = m.distance
      ? `<p class="match-distance">${t(locale, 'matchDistance')} ${m.distance}</p>`
      : '';
    return `
      <div class="match-card">
        <div class="match-name">${m.displayName}</div>
        <div class="match-ghii">${m.ghii}</div>
        ${interests}
        ${distance}
      </div>`;
  }).join('\n');

  const html = wrapHtml(t(locale, 'matchHeading'), `
    <p>${t(locale, 'matchBody')}</p>
    ${matchCardsHtml}
  `, locale);

  const matchTexts = matches.map(m => {
    const parts = [`  ${m.displayName} (${m.ghii})`];
    if (m.sharedInterests.length > 0) {
      parts.push(`    ${t(locale, 'matchSharedInterests')} ${m.sharedInterests.join(', ')}`);
    }
    if (m.distance) {
      parts.push(`    ${t(locale, 'matchDistance')} ${m.distance}`);
    }
    return parts.join('\n');
  }).join('\n\n');

  const text = [
    t(locale, 'matchHeading'),
    '',
    t(locale, 'matchBody'),
    '',
    matchTexts,
    '',
    `-- ${t(locale, 'footer')}`,
  ].join('\n');

  return { html, text };
}
