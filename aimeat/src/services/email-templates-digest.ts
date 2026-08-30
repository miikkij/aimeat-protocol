/**
 * @file email-templates-digest.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The notification digest email: what stayed unread in the bell for longer than the
 *   owner chose, as one message with a link to the Notifications page. Built on the layout and the
 *   string table email-templates.ts exports, kept apart because that file is at its size limit.
 * @structure notificationDigestEmail
 * @usage const { subject, html, text } = notificationDigestEmail({ count, items, pageUrl }, locale);
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { wrapHtml, esc, emailText } from './email-templates.js';

const STRINGS: Record<string, Record<string, string>> = {
  en: {
    subject: '{n} notifications waiting for you on AIMEAT',
    heading: 'Waiting for you',
    intro: 'These arrived while you were away and are still unread.',
    button: 'Open notifications',
    why: 'You asked for this digest on your Notifications page; turn it off there.',
  },
  fi: {
    subject: '{n} ilmoitusta odottaa sinua AIMEATissa',
    heading: 'Odottaa sinua',
    intro: 'Nämä saapuivat poissaollessasi ja ovat yhä lukematta.',
    button: 'Avaa ilmoitukset',
    why: 'Pyysit tämän koosteen Ilmoitukset-sivullasi; samasta paikasta sen saa pois.',
  },
  es: {
    subject: '{n} notificaciones te esperan en AIMEAT',
    heading: 'Te esperan',
    intro: 'Llegaron mientras no estabas y siguen sin leer.',
    button: 'Abrir las notificaciones',
    why: 'Pediste este resumen en tu página de Notificaciones; ahí mismo se apaga.',
  },
};
const s = (locale: string | undefined, key: string): string => {
  const tag = (locale ?? '').slice(0, 2).toLowerCase();
  return (STRINGS[tag] ?? STRINGS.en)[key] ?? STRINGS.en[key];
};

export interface DigestEmailArgs {
  count: number;
  items: Array<{ title: string; body?: string; at: string }>;
  pageUrl: string;
}

export function notificationDigestEmail(args: DigestEmailArgs, locale?: string): { subject: string; html: string; text: string } {
  const subject = s(locale, 'subject').replace('{n}', String(args.count));
  const rows = args.items.map(i => `<li style="margin:0 0 10px;"><strong>${esc(i.title)}</strong>${i.body ? `<br><span style="color:#555;">${esc(i.body.split('\n')[0].slice(0, 200))}</span>` : ''}</li>`).join('\n');
  const html = wrapHtml(s(locale, 'heading'), `
    <p>${s(locale, 'intro')}</p>
    <ul style="padding-left:18px;font-size:14px;line-height:1.5;">${rows}</ul>
    <p style="text-align: center;"><a href="${args.pageUrl}" class="btn">${s(locale, 'button')}</a></p>
    <p style="color: #999; font-size: 13px;">${s(locale, 'why')}</p>
  `, locale);
  const text = [
    s(locale, 'heading'), '', s(locale, 'intro'), '',
    ...args.items.map(i => `- ${i.title}${i.body ? `: ${i.body.split('\n')[0].slice(0, 200)}` : ''}`),
    '', args.pageUrl, '', s(locale, 'why'), '', `-- ${emailText(locale, 'footer')}`,
  ].join('\n');
  return { subject, html, text };
}
