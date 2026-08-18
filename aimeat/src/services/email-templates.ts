/**
 * @file email-templates.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.4.0 — 2026-08-06 — Add outboundEmailHtml: the outbound door's generic layout (caller supplies
 *     pre-escaped body HTML + the plain-text twin; brand may name the sending business).
 *   v1.3.0 — 2026-07-07 — Add keyCredentialsEmailHtml/keyCredentialsEmailSubject: durable login
 *     (username + freshly issued password) emailed on a provisioned-code account's first sign-in (TARGET-011).
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
    regInviteSubject: 'Someone asked us to set up an AIMEAT account for this address',
    regInviteHeading: 'An AI asked for an account here',
    regInviteLead: 'An AI assistant asked AIMEAT to create an account for this email address. No account exists yet, and none will unless you press the button below.',
    regInviteWhoHeading: 'Where the request came from',
    regInviteClaimNote: 'The AI told us these about itself. We have no way to check them, so treat them as what it said rather than as fact:',
    regInviteObservedNote: 'These we saw ourselves:',
    regInviteFieldModel: 'Model',
    regInviteFieldVendor: 'Made by',
    regInviteFieldClient: 'App',
    regInviteFieldIp: 'IP address',
    regInviteFieldAgent: 'Browser / client',
    regInviteFieldAt: 'Time',
    regInviteUnstated: 'not stated',
    regInviteButton: 'Continue and pick a username',
    regInviteNoCode: 'There is no code to type. This link is the proof that the address is yours.',
    regInviteFallback: 'If the button does not work, open this address:',
    regInviteExpiry: 'The link works until',
    regInviteIgnore: 'If you did not ask for this, do nothing. No account is created, and this address is not stored beyond the expiry above.',
    regInviteReport: 'You can report misuse here:',
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
    credSubject: 'Your login to {org} on AIMEAT',
    credHeading: "You're in. Here is your login.",
    credIntro: 'Your access code opened the door. These are your durable login details for AIMEAT. Use them to sign in again on any device, and to reach the linked apps in read only mode.',
    credUserLabel: 'Username',
    credPwLabel: 'Password',
    credInstructions: 'Sign in with these at the address below:',
    credButton: 'Sign in',
    credNote: 'Keep these to yourself. You can change your password later in your profile settings.',
    credIgnore: "If you did not use an access code, you can safely ignore this email.",
    roleViewer: 'viewer',
    roleContributor: 'contributor',
    footer: 'Sent by AIMEAT Protocol',
    footerUnsubscribe: 'Manage your notification settings in your AIMEAT profile.',
  },
  fi: {
    regInviteSubject: 'Joku pyysi meitä luomaan AIMEAT-tilin tähän osoitteeseen',
    regInviteHeading: 'Tekoäly pyysi tänne tiliä',
    regInviteLead: 'Tekoälyavustaja pyysi AIMEATia luomaan tilin tähän sähköpostiosoitteeseen. Tiliä ei ole vielä olemassa, eikä sitä synny ellet paina alla olevaa nappia.',
    regInviteWhoHeading: 'Mistä pyyntö tuli',
    regInviteClaimNote: 'Nämä tekoäly kertoi itsestään. Emme voi tarkistaa niitä, joten ne ovat sen oma väite eivätkä tosiasia:',
    regInviteObservedNote: 'Nämä näimme itse:',
    regInviteFieldModel: 'Malli',
    regInviteFieldVendor: 'Tekijä',
    regInviteFieldClient: 'Sovellus',
    regInviteFieldIp: 'IP-osoite',
    regInviteFieldAgent: 'Selain tai asiakasohjelma',
    regInviteFieldAt: 'Aika',
    regInviteUnstated: 'ei kerrottu',
    regInviteButton: 'Jatka ja valitse käyttäjänimi',
    regInviteNoCode: 'Koodia ei tarvitse näppäillä. Tämä linkki on todiste siitä että osoite on sinun.',
    regInviteFallback: 'Jos nappi ei toimi, avaa tämä osoite:',
    regInviteExpiry: 'Linkki toimii',
    regInviteIgnore: 'Jos et pyytänyt tätä, älä tee mitään. Tiliä ei synny, eikä tätä osoitetta säilytetä yllä mainitun voimassaolon jälkeen.',
    regInviteReport: 'Voit ilmoittaa väärinkäytöstä täällä:',
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
    credSubject: 'Kirjautumistietosi: {org} (AIMEAT)',
    credHeading: 'Olet sisällä. Tässä kirjautumistietosi.',
    credIntro: 'Pääsykoodisi avasi oven. Nämä ovat pysyvät AIMEAT-kirjautumistietosi. Käytä niitä kirjautuaksesi uudelleen millä tahansa laitteella ja päästäksesi liitettyihin appeihin lukutilassa.',
    credUserLabel: 'Käyttäjätunnus',
    credPwLabel: 'Salasana',
    credInstructions: 'Kirjaudu näillä alla olevassa osoitteessa:',
    credButton: 'Kirjaudu',
    credNote: 'Pidä nämä omanasi. Voit vaihtaa salasanan myöhemmin profiiliasetuksissasi.',
    credIgnore: 'Jos et käyttänyt pääsykoodia, voit jättää viestin huomiotta.',
    roleViewer: 'katselija',
    roleContributor: 'osallistuja',
    footer: 'Lähetetty AIMEAT-protokollan kautta',
    footerUnsubscribe: 'Hallinnoi ilmoitusasetuksiasi AIMEAT-profiilissasi.',
  },
  es: {
    regInviteSubject: 'Alguien nos pidió crear una cuenta de AIMEAT para esta dirección',
    regInviteHeading: 'Una IA pidió una cuenta aquí',
    regInviteLead: 'Un asistente de IA le pidió a AIMEAT crear una cuenta para esta dirección de correo. Todavía no existe ninguna cuenta, y no se creará ninguna a menos que presiones el botón de abajo.',
    regInviteWhoHeading: 'De dónde vino la solicitud',
    regInviteClaimNote: 'Esto es lo que la IA contó sobre sí misma. No tenemos forma de comprobarlo, así que tómalo como lo que ella afirma y no como un hecho:',
    regInviteObservedNote: 'Esto lo vimos nosotros mismos:',
    regInviteFieldModel: 'Modelo',
    regInviteFieldVendor: 'Creado por',
    regInviteFieldClient: 'Aplicación',
    regInviteFieldIp: 'Dirección IP',
    regInviteFieldAgent: 'Navegador o cliente',
    regInviteFieldAt: 'Hora',
    regInviteUnstated: 'sin especificar',
    regInviteButton: 'Continuar y elegir un nombre de usuario',
    regInviteNoCode: 'No hay ningún código que escribir. Este enlace es la prueba de que la dirección es tuya.',
    regInviteFallback: 'Si el botón no funciona, abre esta dirección:',
    regInviteExpiry: 'El enlace funciona hasta',
    regInviteIgnore: 'Si no pediste esto, no hagas nada. No se crea ninguna cuenta, y esta dirección no se guarda más allá de la fecha de arriba.',
    regInviteReport: 'Puedes denunciar un uso indebido aquí:',
    verificationSubject: 'Tu código de verificación de AIMEAT',
    verificationHeading: 'Verificación del correo',
    verificationBody: 'Usa este código para verificar tu dirección de correo:',
    verificationExpiry: 'El código caduca en 15 minutos.',
    verificationIgnore: 'Si no pediste esto, puedes ignorar este correo sin problema.',
    magicLinkSubject: 'Tu enlace de acceso a AIMEAT',
    magicLinkHeading: 'Inicia sesión en AIMEAT',
    magicLinkBody: 'Presiona el botón de abajo para iniciar sesión en tu cuenta:',
    magicLinkButton: 'Iniciar sesión',
    magicLinkExpiry: 'El enlace caduca en 15 minutos.',
    magicLinkIgnore: 'Si no pediste esto, puedes ignorar este correo sin problema.',
    magicLinkFallback: 'O copia esta dirección en tu navegador:',
    notificationHeading: 'Aviso de AIMEAT',
    matchSubject: 'Nuevas coincidencias para ti en AIMEAT',
    matchHeading: 'Coincidencias',
    matchBody: 'Encontramos algunas coincidencias que te pueden interesar:',
    matchSharedInterests: 'Intereses en común:',
    matchDistance: 'Distancia:',
    matchViewProfile: 'Ver el perfil',
    inviteSubject: 'Te invitaron a unirte a {org} en AIMEAT',
    inviteHeading: 'Tienes una invitación a AIMEAT',
    inviteSentence: '{inviter} te invitó a unirte a {org} en AIMEAT.',
    inviteNewAccount: 'Todavía no necesitas una cuenta: el enlace de abajo te deja registrarte y unirte en un solo paso.',
    inviteWorkspacesLabel: 'Tendrás acceso a:',
    inviteButton: 'Aceptar la invitación',
    inviteExpiryPrefix: 'Esta invitación caduca el',
    inviteFallback: 'O copia esta dirección en tu navegador:',
    inviteIgnore: 'Si no esperabas esta invitación, puedes ignorar este correo sin problema.',
    inviteMessageLabel: 'Mensaje personal:',
    keySubject: 'Tu clave de acceso a {org} en AIMEAT',
    keyHeading: 'Recibiste una clave de acceso',
    keyCodeLabel: 'Tu código de acceso:',
    keyInstructions: 'El código es tu contraseña, no lo compartas con nadie.',
    keyButton: 'Iniciar sesión',
    keyExpiryPrefix: 'Esta clave caduca el',
    keyFallback: 'O copia esta dirección en tu navegador:',
    keyIgnore: 'Si no esperabas esta clave, puedes ignorar este correo sin problema.',
    keyFooter: 'Enviado desde la sala de máquinas de AIMEAT',
    credSubject: 'Tu acceso a {org} en AIMEAT',
    credHeading: 'Ya estás dentro. Estos son tus datos de acceso.',
    credIntro: 'Tu código de acceso abrió la puerta. Estos son tus datos de acceso permanentes a AIMEAT. Úsalos para iniciar sesión de nuevo desde cualquier dispositivo y para abrir las aplicaciones enlazadas en modo de solo lectura.',
    credUserLabel: 'Nombre de usuario',
    credPwLabel: 'Contraseña',
    credInstructions: 'Inicia sesión con estos datos en la dirección de abajo:',
    credButton: 'Iniciar sesión',
    credNote: 'Guárdalos solo para ti. Puedes cambiar la contraseña más adelante en los ajustes de tu perfil.',
    credIgnore: 'Si no usaste ningún código de acceso, puedes ignorar este correo sin problema.',
    roleViewer: 'lector',
    roleContributor: 'colaborador',
    footer: 'Enviado por AIMEAT Protocol',
    footerUnsubscribe: 'Gestiona tus avisos en tu perfil de AIMEAT.',
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

/** The language this email is written in: the requested one when we have it, else English. */
function emailLang(locale: string | undefined): string {
  const tag = (locale ?? '').slice(0, 2).toLowerCase();
  return Object.prototype.hasOwnProperty.call(i18n, tag) ? tag : 'en';
}

function t(locale: string | undefined, key: string): string {
  return i18n[emailLang(locale)][key] ?? i18n['en'][key] ?? key;
}

// ── Shared layout ────────────────────────────────────────

function wrapHtml(heading: string, bodyHtml: string, locale?: string, opts?: { brand?: string; footer?: string }): string {
  // brand/footer are trusted constants (never user input) — brand may carry inline HTML (e.g. a heart).
  const brand = opts?.brand ?? 'AIMEAT';
  const footer = opts?.footer ?? t(locale, 'footer');
  return `<!DOCTYPE html>
<html lang="${emailLang(locale)}">
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

export interface RegistrationInviteEmailArgs {
  acceptUrl: string;
  /** What the AI said about itself. Unverifiable, and labelled as such in the message. */
  agent: { model?: string | null; vendor?: string | null; client?: string | null };
  /** What the server saw. This is the part that makes the request traceable. */
  observed: { ip: string; userAgent: string | null; at: string };
  expiresLabel: string;
  reportUrl: string;
}

/**
 * The agent-door email (12-ai-rekisteroi.md).
 *
 * This message arrives unrequested, so its job is to be judgeable: it says an AI asked, shows what
 * the AI claimed about itself SEPARATELY from what the server observed, and states plainly that
 * doing nothing means no account is created. That separation is the whole design — an open
 * endpoint that emails strangers becomes traceable rather than dangerous when every message writes
 * a complete account of its own origin into the mailbox of the person it concerns.
 *
 * There is no code to type. The link IS the proof that the address belongs to whoever opened it.
 */
export function registrationInviteEmail(
  args: RegistrationInviteEmailArgs, locale?: string,
): { subject: string; html: string; text: string } {
  const unstated = t(locale, 'regInviteUnstated');
  const claimed: Array<[string, string]> = [
    [t(locale, 'regInviteFieldModel'), args.agent.model || unstated],
    [t(locale, 'regInviteFieldVendor'), args.agent.vendor || unstated],
    [t(locale, 'regInviteFieldClient'), args.agent.client || unstated],
  ];
  const observed: Array<[string, string]> = [
    [t(locale, 'regInviteFieldIp'), args.observed.ip],
    [t(locale, 'regInviteFieldAgent'), args.observed.userAgent || unstated],
    [t(locale, 'regInviteFieldAt'), args.observed.at],
  ];
  const rows = (pairs: Array<[string, string]>) => pairs
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#777;font-size:13px;">${esc(k)}</td><td style="padding:4px 0;font-size:13px;"><code>${esc(v)}</code></td></tr>`)
    .join('');

  const html = wrapHtml(t(locale, 'regInviteHeading'), `
    <p>${t(locale, 'regInviteLead')}</p>
    <p style="text-align: center;">
      <a href="${args.acceptUrl}" class="btn">${t(locale, 'regInviteButton')}</a>
    </p>
    <p style="font-size:13px;color:#999;">${t(locale, 'regInviteNoCode')}</p>
    <p style="font-size:13px;color:#999;">${t(locale, 'regInviteExpiry')} ${esc(args.expiresLabel)}.</p>

    <h3 style="font-size:15px;margin-top:24px;">${t(locale, 'regInviteWhoHeading')}</h3>
    <p style="font-size:13px;color:#777;margin-bottom:4px;">${t(locale, 'regInviteClaimNote')}</p>
    <table style="border-collapse:collapse;">${rows(claimed)}</table>
    <p style="font-size:13px;color:#777;margin:12px 0 4px;">${t(locale, 'regInviteObservedNote')}</p>
    <table style="border-collapse:collapse;">${rows(observed)}</table>

    <p style="font-size: 13px; color: #999;">${t(locale, 'regInviteFallback')}</p>
    <p class="url-fallback">${args.acceptUrl}</p>
    <p style="color:#999;font-size:13px;">${t(locale, 'regInviteIgnore')}</p>
    <p style="color:#999;font-size:13px;">${t(locale, 'regInviteReport')} <a href="${args.reportUrl}">${args.reportUrl}</a></p>
  `, locale);

  const text = [
    t(locale, 'regInviteHeading'),
    '',
    t(locale, 'regInviteLead'),
    '',
    args.acceptUrl,
    '',
    t(locale, 'regInviteNoCode'),
    `${t(locale, 'regInviteExpiry')} ${args.expiresLabel}.`,
    '',
    t(locale, 'regInviteWhoHeading'),
    t(locale, 'regInviteClaimNote'),
    ...claimed.map(([k, v]) => `  ${k}: ${v}`),
    t(locale, 'regInviteObservedNote'),
    ...observed.map(([k, v]) => `  ${k}: ${v}`),
    '',
    t(locale, 'regInviteIgnore'),
    `${t(locale, 'regInviteReport')} ${args.reportUrl}`,
    '',
    `-- ${t(locale, 'footer')}`,
  ].join('\n');

  return { subject: t(locale, 'regInviteSubject'), html, text };
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

export interface KeyCredentialsEmailArgs {
  username: string;   // the exact login username (e.g. "excvip001") — shown verbatim, no transforms
  password: string;   // a clean, validator-passing password with no separators — shown verbatim
  orgName: string;
  loginUrl: string;   // where the recipient signs in (the apex, not an app origin)
}

/** Subject line for the first-login credentials email. */
export function keyCredentialsEmailSubject(orgName: string, locale?: string): string {
  return t(locale, 'credSubject').replace('{org}', orgName);
}

/** First-login credentials email: after a provisioned-code account's FIRST successful sign-in, it
 *  receives its durable login (username + a freshly issued password) shown as two clearly separated,
 *  copy-friendly fields — the exact values the login form accepts, with no dashes to mislead. */
export function keyCredentialsEmailHtml(args: KeyCredentialsEmailArgs, locale?: string): { html: string; text: string } {
  const field = (label: string, value: string) => `
    <p style="margin:14px 0 4px;color:#555;font-size:14px;">${label}</p>
    <p style="text-align:center;font-family:'Courier New',monospace;font-size:20px;font-weight:bold;letter-spacing:1px;background:#111;color:#fff;border-radius:6px;padding:12px;word-break:break-all;">${esc(value)}</p>`;

  const html = wrapHtml(t(locale, 'credHeading'), `
    <p>${t(locale, 'credIntro')}</p>
    ${field(t(locale, 'credUserLabel'), args.username)}
    ${field(t(locale, 'credPwLabel'), args.password)}
    <p>${t(locale, 'credInstructions')}</p>
    <p style="text-align: center;">
      <a href="${args.loginUrl}" class="btn">${t(locale, 'credButton')}</a>
    </p>
    <p style="font-size: 13px; color: #999;">${t(locale, 'keyFallback')}</p>
    <p class="url-fallback">${args.loginUrl}</p>
    <p style="font-size: 13px; color: #777;">${t(locale, 'credNote')}</p>
    <p style="color: #999; font-size: 13px;">${t(locale, 'credIgnore')}</p>
  `, locale, { brand: 'AIME<span class="hrt">&#9829;</span>AT', footer: t(locale, 'keyFooter') });

  const text = [
    t(locale, 'credHeading'),
    '',
    t(locale, 'credIntro'),
    '',
    `${t(locale, 'credUserLabel')}: ${args.username}`,
    `${t(locale, 'credPwLabel')}: ${args.password}`,
    '',
    t(locale, 'credInstructions'),
    args.loginUrl,
    '',
    t(locale, 'credNote'),
    '',
    t(locale, 'credIgnore'),
    '',
    `-- ${t(locale, 'keyFooter')}`,
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

/**
 * Outbound-door generic email: caller supplies the ALREADY-ESCAPED body HTML and its
 * plain-text twin (the door composes both, including the marketing unsubscribe footer).
 * `brand` (trusted constant or validated business name) shows in place of the AIMEAT wordmark.
 */
export function outboundEmailHtml(heading: string, bodyHtml: string, textBody: string, locale?: string, opts?: { brand?: string }): { html: string; text: string } {
  const html = wrapHtml(heading, bodyHtml, locale, opts?.brand ? { brand: esc(opts.brand) } : undefined);
  return { html, text: textBody };
}
