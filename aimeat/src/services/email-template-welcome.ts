/**
 * @file email-template-welcome.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The welcome email for an account an install set created (install-set-people.ts): the
 *   account name, a sign-in button that works once for seven days, and how to sign in after that.
 *   In its own file, with its own three-language table, because email-templates.ts is near the
 *   800-line limit; the layout is the shared wrapHtml().
 *
 *   What "later" says is what the sign-in dialog offers: "Email me a sign-in link", which is on every
 *   node that sends mail (and this mail was sent), and Google or Microsoft when the node has them.
 *   The quoted labels are the dialog's own strings (locales modal.loginLinkAsk); change both together.
 * @structure welcomeEmail()
 * @version-history
 *   v1.1.0 — 2026-09-29 — "Later" names the dialog's "Email me a sign-in link" instead of "Forgot
 *     password?", now that the dialog has it (auth/modal-login-link.js).
 *   v1.0.0 — 2026-09-29 — Initial (install packages: users created at install can sign in).
 */
import { wrapHtml, esc } from './email-templates.js';

const strings: Record<string, Record<string, string>> = {
    en: {
        subject: 'Your AIMEAT account is ready',
        heading: 'Your account is ready',
        lead: 'An account was created for you at {site}. Your username is {user}. Press the button to sign in. You need no password for this.',
        button: 'Sign in',
        expiry: 'The button works once, for 7 days.',
        later: 'To sign in later, choose "Email me a sign-in link" on the sign-in page and enter this address. If the sign-in page offers Google or Microsoft, they work with this address too.',
        fallback: 'If the button does not work, open this address:',
        ignore: 'If you did not expect this message, you can ignore it.',
    },
    fi: {
        subject: 'AIMEAT-tilisi on valmis',
        heading: 'Tilisi on valmis',
        lead: 'Sinulle on luotu tili palveluun {site}. Käyttäjätunnuksesi on {user}. Kirjaudu sisään painikkeella. Salasanaa ei tarvita.',
        button: 'Kirjaudu',
        expiry: 'Painike toimii kerran, ja se on voimassa 7 päivää.',
        later: 'Kun kirjaudut myöhemmin, valitse kirjautumissivulta "Lähetä kirjautumislinkki sähköpostiin" ja anna tämä osoite. Jos kirjautumissivulla on Google- tai Microsoft-kirjautuminen, voit käyttää niitä tällä osoitteella.',
        fallback: 'Jos painike ei toimi, avaa tämä osoite:',
        ignore: 'Jos et odottanut tätä viestiä, voit jättää sen huomiotta.',
    },
    es: {
        subject: 'Tu cuenta de AIMEAT está lista',
        heading: 'Tu cuenta está lista',
        lead: 'Se creó una cuenta para ti en {site}. Tu nombre de usuario es {user}. Presiona el botón para iniciar sesión. No necesitas contraseña.',
        button: 'Iniciar sesión',
        expiry: 'El botón funciona una sola vez durante 7 días.',
        later: 'Para iniciar sesión más adelante, elige "Envíame un enlace de acceso" en la página de inicio de sesión y escribe esta dirección. Si la página ofrece Google o Microsoft, también puedes usarlos con esta dirección.',
        fallback: 'Si el botón no funciona, abre esta dirección:',
        ignore: 'Si no esperabas este correo, puedes ignorarlo.',
    },
};

/** The welcome email in the account's language (English when the node has no table for it). */
export function welcomeEmail(args: { site: string; username: string; loginUrl: string }, locale?: string): { subject: string; html: string; text: string } {
    const lang = Object.prototype.hasOwnProperty.call(strings, (locale ?? '').slice(0, 2).toLowerCase()) ? (locale ?? '').slice(0, 2).toLowerCase() : 'en';
    const s = strings[lang];
    const fill = (text: string, html: boolean) => text
        .replace('{site}', html ? `<strong>${esc(args.site)}</strong>` : args.site)
        .replace('{user}', html ? `<strong>${esc(args.username)}</strong>` : args.username);
    const url = esc(args.loginUrl);
    const html = wrapHtml(s.heading, `
    <p>${fill(esc(s.lead), true)}</p>
    <p style="text-align: center;">
      <a href="${url}" class="btn">${s.button}</a>
    </p>
    <p>${s.expiry}</p>
    <p>${esc(s.later)}</p>
    <p style="font-size: 13px; color: #999;">${s.fallback}</p>
    <p class="url-fallback">${url}</p>
    <p style="color: #999; font-size: 13px;">${s.ignore}</p>
  `, lang);
    const text = [s.heading, '', fill(s.lead, false), '', args.loginUrl, '', s.expiry, '', s.later, '', s.ignore].join('\n');
    return { subject: s.subject, html, text };
}
