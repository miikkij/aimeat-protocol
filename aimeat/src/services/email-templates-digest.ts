/**
 * @file email-templates-digest.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The notification digest email: what stayed unread in the bell for longer than the
 *   owner chose, as one message with a link to the Notifications page. Built on the layout and the
 *   string table email-templates.ts exports, kept apart because that file is at its size limit.
 * @structure DigestSection · DIGEST_SECTIONS · notificationDigestEmail
 * @usage const { subject, html, text } = notificationDigestEmail({ count, items, pageUrl }, locale);
 * @version-history
 *   v1.2.0 — 2026-10-18 — The lines come in three sections, in this order: messages, then what the
 *     owner's apps sent, then everything else, each under its own heading with its count. Asked by
 *     Jouni: a message from a person is what he reads first, and nine lines of agents waiting had
 *     hidden it in one flat list.
 *   v1.1.0 — 2026-09-12 — Each line carries the time it arrived, in the recipient's own format and
 *     clock. The timestamp had been passed in since the first version and never rendered, so a
 *     message whose whole premise is "these arrived while you were away" said nothing about when.
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
    'section.messages': 'Messages',
    'section.apps': 'From your apps',
    'section.other': 'Everything else',
  },
  fi: {
    subject: '{n} ilmoitusta odottaa sinua AIMEATissa',
    heading: 'Odottaa sinua',
    intro: 'Nämä saapuivat poissaollessasi ja ovat yhä lukematta.',
    button: 'Avaa ilmoitukset',
    why: 'Pyysit tämän koosteen Ilmoitukset-sivullasi; samasta paikasta sen saa pois.',
    'section.messages': 'Viestit',
    'section.apps': 'Sovelluksistasi',
    'section.other': 'Muut',
  },
  es: {
    subject: '{n} notificaciones te esperan en AIMEAT',
    heading: 'Te esperan',
    intro: 'Llegaron mientras no estabas y siguen sin leer.',
    button: 'Abrir las notificaciones',
    why: 'Pediste este resumen en tu página de Notificaciones; ahí mismo se apaga.',
    'section.messages': 'Mensajes',
    'section.apps': 'De tus aplicaciones',
    'section.other': 'Todo lo demás',
  },
};
const s = (locale: string | undefined, key: string): string => {
  const tag = (locale ?? '').slice(0, 2).toLowerCase();
  return (STRINGS[tag] ?? STRINGS.en)[key] ?? STRINGS.en[key];
};

/**
 * The digest's sections, in the order they are printed: what a person wrote, what the owner's apps
 * sent, and the rest. The caller decides which section a notification belongs to; a line without one
 * is printed under "other".
 */
export type DigestSection = 'messages' | 'apps' | 'other';
export const DIGEST_SECTIONS: readonly DigestSection[] = ['messages', 'apps', 'other'];

export interface DigestEmailArgs {
  count: number;
  /**
   * `atLabel` is the arrival time ALREADY WRITTEN in the recipient's own format and clock, the way
   * every other template here takes its dates. A template has no storage and no recipient record,
   * so it cannot look a preference up; the caller reads it with `displayPrefsFor` and writes it
   * with `formatForPerson`. Absent means the caller had nothing worth printing, and the line
   * simply carries no time — which is what EVERY line did until 2026-09-12, although `at` was
   * being passed in and dropped.
   */
  items: Array<{ title: string; body?: string; at: string; atLabel?: string; section?: DigestSection }>;
  pageUrl: string;
}

type DigestItem = DigestEmailArgs['items'][number];

export function notificationDigestEmail(args: DigestEmailArgs, locale?: string): { subject: string; html: string; text: string } {
  const subject = s(locale, 'subject').replace('{n}', String(args.count));
  const when = (i: DigestItem) =>
    i.atLabel ? `<span style="color:#999;font-size:12px;"> · ${esc(i.atLabel)}</span>` : '';
  const firstLine = (body: string) => body.split('\n')[0].slice(0, 200);
  // Each section keeps the order the caller gave its lines in; an empty section is not printed.
  const sections = DIGEST_SECTIONS
    .map(key => ({ key, items: args.items.filter(i => (i.section ?? 'other') === key) }))
    .filter(sec => sec.items.length > 0);
  const heading = (key: DigestSection, n: number) => `${s(locale, `section.${key}`)} (${n})`;
  const htmlSections = sections.map(sec => {
    const rows = sec.items.map(i => `<li style="margin:0 0 10px;"><strong>${esc(i.title)}</strong>${when(i)}${i.body ? `<br><span style="color:#555;">${esc(firstLine(i.body))}</span>` : ''}</li>`).join('\n');
    return `<h3 style="margin:18px 0 6px;font-size:15px;">${esc(heading(sec.key, sec.items.length))}</h3>
    <ul style="padding-left:18px;font-size:14px;line-height:1.5;margin-top:0;">${rows}</ul>`;
  }).join('\n');
  const html = wrapHtml(s(locale, 'heading'), `
    <p>${s(locale, 'intro')}</p>
    ${htmlSections}
    <p style="text-align: center;"><a href="${args.pageUrl}" class="btn">${s(locale, 'button')}</a></p>
    <p style="color: #999; font-size: 13px;">${s(locale, 'why')}</p>
  `, locale);
  const text = [
    s(locale, 'heading'), '', s(locale, 'intro'),
    ...sections.flatMap(sec => [
      '', heading(sec.key, sec.items.length),
      ...sec.items.map(i => `- ${i.title}${i.atLabel ? ` (${i.atLabel})` : ''}${i.body ? `: ${firstLine(i.body)}` : ''}`),
    ]),
    '', args.pageUrl, '', s(locale, 'why'), '', `-- ${emailText(locale, 'footer')}`,
  ].join('\n');
  return { subject, html, text };
}
