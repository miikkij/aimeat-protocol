/**
 * @file email-template-reset.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The password reset code email (POST /v1/ghii/password/reset-request, recovery.ts).
 *   Until 2026-09-29 the reset code went out in the email-verification template, "Your AIMEAT
 *   Verification Code ... verify your email address", so a person who asked to reset a password read
 *   a mail about something else, with the same subject as the code they got at sign-up. The shop's
 *   test on a sold customer node found it. In its own file, with its own three-language table,
 *   because email-templates.ts is near the 800-line limit; the layout is the shared wrapHtml().
 * @structure passwordResetEmail()
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial.
 */
import { wrapHtml, esc } from './email-templates.js';

const strings: Record<string, Record<string, string>> = {
    en: {
        subject: 'Your AIMEAT password reset code',
        heading: 'Reset your password',
        body: 'Use this code to set a new password for your account:',
        expiry: 'The code works for 10 minutes. Only the newest code you asked for works.',
        ignore: 'If you did not ask to reset your password, you can ignore this email. Your password has not changed.',
    },
    fi: {
        subject: 'AIMEAT-salasanan palautuskoodi',
        heading: 'Vaihda salasana',
        body: 'Tällä koodilla asetat tilillesi uuden salasanan:',
        expiry: 'Koodi on voimassa 10 minuuttia. Vain uusin pyytämäsi koodi toimii.',
        ignore: 'Jos et pyytänyt salasanan palautusta, voit jättää viestin huomiotta. Salasanasi ei ole muuttunut.',
    },
    es: {
        subject: 'Tu código para restablecer la contraseña de AIMEAT',
        heading: 'Restablece tu contraseña',
        body: 'Usa este código para crear una contraseña nueva para tu cuenta:',
        expiry: 'El código funciona durante 10 minutos. Solo funciona el código más reciente que pediste.',
        ignore: 'Si no pediste restablecer la contraseña, puedes ignorar este correo. Tu contraseña no cambió.',
    },
};

/** The reset code email in the account's language (English when the node has no table for it). */
export function passwordResetEmail(code: string, locale?: string): { subject: string; html: string; text: string } {
    const tag = (locale ?? '').slice(0, 2).toLowerCase();
    const lang = Object.prototype.hasOwnProperty.call(strings, tag) ? tag : 'en';
    const s = strings[lang];
    const html = wrapHtml(s.heading, `
    <p>${s.body}</p>
    <div class="code">${esc(code)}</div>
    <p>${s.expiry}</p>
    <p style="color: #999; font-size: 13px;">${s.ignore}</p>
  `, lang);
    const text = [s.heading, '', s.body, '', `  ${code}`, '', s.expiry, '', s.ignore].join('\n');
    return { subject: s.subject, html, text };
}
