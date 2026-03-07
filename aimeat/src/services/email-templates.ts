/**
 * Email Templates — Phase 1.1
 *
 * Clean, minimal HTML email templates with AIMEAT branding.
 * Supports 'en' (default) and 'fi' locales.
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
    footer: 'Lähetetty AIMEAT-protokollan kautta',
    footerUnsubscribe: 'Hallinnoi ilmoitusasetuksiasi AIMEAT-profiilissasi.',
  },
};

function t(locale: string | undefined, key: string): string {
  const lang = locale === 'fi' ? 'fi' : 'en';
  return i18n[lang][key] ?? i18n['en'][key] ?? key;
}

// ── Shared layout ────────────────────────────────────────

function wrapHtml(heading: string, bodyHtml: string, locale?: string): string {
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
    <div class="logo">AIMEAT</div>
    <div class="card">
      <h1>${heading}</h1>
      ${bodyHtml}
    </div>
    <div class="footer">
      <p>${t(locale, 'footer')}</p>
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
