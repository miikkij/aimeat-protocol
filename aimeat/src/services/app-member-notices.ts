/**
 * @file app-member-notices.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the app member roster says to people, in the recipient's language: the bell
 *   notifications of an approval, a removal, an ask, a role change and a decline, and the email that
 *   invites an address with no account here.
 *
 *   LANGUAGE. The recipient's own profile language (displayPrefsFor, services/display-prefs.ts),
 *   the same field the node's other emails and notification sweeps read, cut to en, fi or es; any
 *   other or none is English. A date is written the way the recipient writes dates (formatForPerson).
 *   The invitation email has no recipient account to read, so its language is the inviter's, or the
 *   one the inviter named (inviteEmailLocale, services/invitations.ts).
 *
 *   The text is written here rather than as `notiftext.*` locale keys, so the push that leaves the
 *   node with the notification carries the same language as the bell.
 * @structure NoticeLang · noticeLang · MemberNoticeKind · memberNoticeText · memberActionLabel ·
 *   sendMemberNotice · appMemberInviteEmail
 * @usage await sendMemberNotice(storage, 'bob@node', 'approved', { app: 'club', by: 'alice', role: 'member' }, { link });
 * @version-history
 *   v1.1.0 — 2026-10-01 — The invitation email's button accepts the invitation through its sign-up
 *     link, and the text says what happens there (en, fi, es).
 *   v1.0.0 — 2026-10-01 — Initial (IAM round 2, B4): the roster's notifications in en, fi and es,
 *     and the app invitation email (A2).
 */
import type { Storage } from '../storage/interface.js';
import { displayPrefsFor, formatForPerson } from './display-prefs.js';
import { notify, type NotifAction } from './notify.js';
import { wrapHtml, esc } from './email-templates.js';
import { logger } from '../utils/logger.js';

export type NoticeLang = 'en' | 'fi' | 'es';

/** The language for a stored locale tag: en, fi or es, English for anything else. */
export function noticeLang(locale: string | null | undefined): NoticeLang {
  const tag = String(locale ?? '').slice(0, 2).toLowerCase();
  return tag === 'fi' || tag === 'es' ? tag : 'en';
}

export type MemberNoticeKind = 'approved' | 'revoked' | 'request' | 'role_changed' | 'declined';

/** The notification type each kind is stored under. */
const TYPE: Record<MemberNoticeKind, string> = {
  approved: 'app_member_approved',
  revoked: 'app_member_revoked',
  request: 'app_member_request',
  role_changed: 'app_member_role_changed',
  declined: 'app_member_declined',
};

type Text = { title: string; body: string };
const NOTICES: Record<NoticeLang, Record<MemberNoticeKind, Text> & { noNote: string; approveAs: string; decline: string }> = {
  en: {
    approved: { title: 'You were approved for {app}', body: '{by} approved you as {role}.' },
    revoked: { title: 'Your access to {app} ended', body: '{by} removed you from the member list.' },
    request: { title: '{who} asked for access to {app}', body: '{note}' },
    role_changed: { title: 'Your role in {app} is now {role}', body: '{by} changed your role. It was {from}.' },
    declined: { title: 'Your request to join {app} was declined', body: 'You can ask again from {date}.' },
    noNote: 'No message was left.',
    approveAs: 'Approve as {role}',
    decline: 'Decline',
  },
  fi: {
    approved: { title: 'Sinut hyväksyttiin sovellukseen {app}', body: '{by} hyväksyi sinut rooliin {role}.' },
    revoked: { title: 'Pääsysi sovellukseen {app} päättyi', body: '{by} poisti sinut jäsenten listalta.' },
    request: { title: '{who} pyytää pääsyä sovellukseen {app}', body: '{note}' },
    role_changed: { title: 'Roolisi sovelluksessa {app} on nyt {role}', body: '{by} vaihtoi roolisi. Aiempi rooli oli {from}.' },
    declined: { title: 'Pyyntösi liittyä sovellukseen {app} hylättiin', body: 'Voit pyytää uudelleen {date} alkaen.' },
    noNote: 'Viestiä ei jätetty.',
    approveAs: 'Hyväksy rooliin {role}',
    decline: 'Hylkää',
  },
  es: {
    approved: { title: 'Te aprobaron en {app}', body: '{by} te aprobó con el rol {role}.' },
    revoked: { title: 'Tu acceso a {app} terminó', body: '{by} te quitó de la lista de miembros.' },
    request: { title: '{who} pidió acceso a {app}', body: '{note}' },
    role_changed: { title: 'Tu rol en {app} ahora es {role}', body: '{by} cambió tu rol. Antes era {from}.' },
    declined: { title: 'Tu solicitud para unirte a {app} fue rechazada', body: 'Puedes volver a pedirlo a partir del {date}.' },
    noNote: 'No dejó ningún mensaje.',
    approveAs: 'Aprobar como {role}',
    decline: 'Rechazar',
  },
};

/** Put each `{name}` of `template` in place from `vars`; a missing one becomes an empty string. */
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '');
}

/**
 * The title and body of one notice in one language. `vars`: app (the app's file name without
 * .html), by (who acted), role, from (the earlier role), who (the asker), note (the asker's note;
 * an empty one says no message was left), date (already written for the reader).
 */
export function memberNoticeText(kind: MemberNoticeKind, lang: NoticeLang, vars: Record<string, string>): Text {
  const table = NOTICES[lang];
  const v = kind === 'request' && !vars.note ? { ...vars, note: table.noNote } : vars;
  return { title: fill(table[kind].title, v), body: fill(table[kind].body, v) };
}

/** The label of the request notification's Approve or Decline button. */
export function memberActionLabel(action: 'approveAs' | 'decline', lang: NoticeLang, vars: Record<string, string> = {}): string {
  return fill(NOTICES[lang][action], vars);
}

/**
 * Notify one person about the roster, in their language. Never throws: the roster change it reports
 * stands whether or not the notification could be written.
 *
 * @param recipient the person's identity (`bob@node`); an identity of another node reads as English
 * @param dates names in `vars` that hold an ISO time, written the way the recipient writes dates
 * @param actions the buttons, built for the recipient's language by the caller through `lang`
 */
export async function sendMemberNotice(
  storage: Storage, recipient: string, kind: MemberNoticeKind, vars: Record<string, string>,
  extra: { link?: string; dates?: string[]; actions?: (lang: NoticeLang) => NotifAction[] } = {},
): Promise<void> {
  try {
    const prefs = await displayPrefsFor(storage, recipient);
    const lang = noticeLang(prefs.locale);
    const v = { ...vars };
    for (const name of extra.dates ?? []) if (v[name]) v[name] = formatForPerson(prefs, v[name], { dateStyle: 'medium' });
    const text = memberNoticeText(kind, lang, v);
    await notify(storage, recipient, {
      type: TYPE[kind], title: text.title, body: text.body,
      ...(extra.link ? { link: extra.link } : {}),
      ...(extra.actions ? { actions: extra.actions(lang) } : {}),
    });
  } catch (err) {
    logger.warn('app-members: a roster notification failed, the change stands', { kind, error: String(err) });
  }
}

const INVITE_EMAIL: Record<NoticeLang, Record<'subject' | 'heading' | 'sentence' | 'howTo' | 'howToLink' | 'button' | 'buttonAccept' | 'expiry' | 'ignore', string>> = {
  en: {
    subject: '{inviter} invites you to {app}',
    heading: 'You are invited',
    sentence: '{inviter} invites you to use {app} as {role}.',
    howTo: 'Create an account with this email address, or add the address to your account and confirm it. Then you are a member of {app} right away.',
    howToLink: 'Open the invitation and choose a username and a password. Your account uses this email address, and you are a member of {app} at once. If you already have an account with this address, sign in first and then open the invitation.',
    button: 'Open the app',
    buttonAccept: 'Accept the invitation',
    expiry: 'The invitation is valid until {date}.',
    ignore: 'If you did not expect this email, you can ignore it.',
  },
  fi: {
    subject: '{inviter} kutsuu sinut sovellukseen {app}',
    heading: 'Sinut on kutsuttu',
    sentence: '{inviter} kutsuu sinut käyttämään sovellusta {app} roolissa {role}.',
    howTo: 'Luo tili tällä sähköpostiosoitteella tai lisää osoite tiliisi ja vahvista se. Sen jälkeen olet heti sovelluksen {app} jäsen.',
    howToLink: 'Avaa kutsu ja valitse käyttäjänimi ja salasana. Tilisi käyttää tätä sähköpostiosoitetta, ja olet heti sovelluksen {app} jäsen. Jos sinulla on jo tili tällä osoitteella, kirjaudu ensin sisään ja avaa sitten kutsu.',
    button: 'Avaa sovellus',
    buttonAccept: 'Hyväksy kutsu',
    expiry: 'Kutsu on voimassa {date} asti.',
    ignore: 'Jos et odottanut tätä viestiä, voit jättää sen huomiotta.',
  },
  es: {
    subject: '{inviter} te invita a {app}',
    heading: 'Tienes una invitación',
    sentence: '{inviter} te invita a usar {app} con el rol {role}.',
    howTo: 'Crea una cuenta con esta dirección de correo, o agrega la dirección a tu cuenta y confírmala. Así serás miembro de {app} de inmediato.',
    howToLink: 'Abre la invitación y elige un nombre de usuario y una contraseña. Tu cuenta usa esta dirección de correo y quedas como miembro de {app} de inmediato. Si ya tienes una cuenta con esta dirección, inicia sesión primero y luego abre la invitación.',
    button: 'Abrir la aplicación',
    buttonAccept: 'Aceptar la invitación',
    expiry: 'La invitación es válida hasta el {date}.',
    ignore: 'Si no esperabas este correo, puedes ignorarlo.',
  },
};

/**
 * The email that invites an address with no account here to an app. Says who invites, to which app
 * and as what, and how the invitation is taken up. With `acceptUrl` (the sign-up link,
 * services/app-invite-link.ts) the button accepts the invitation; without it the button opens the
 * app and the text asks for an account with this address, confirmed. `date` is the expiry as the
 * reader should see it.
 */
export function appMemberInviteEmail(
  lang: NoticeLang, args: { inviter: string; app: string; role: string; appUrl: string; acceptUrl?: string | null; date: string },
): { subject: string; html: string; text: string } {
  const s = INVITE_EMAIL[lang];
  const plain = { inviter: args.inviter, app: args.app, role: args.role, date: args.date };
  const safe = { inviter: `<strong>${esc(args.inviter)}</strong>`, app: esc(args.app), role: esc(args.role), date: esc(args.date) };
  const link = args.acceptUrl || args.appUrl;
  const howTo = args.acceptUrl ? s.howToLink : s.howTo;
  const html = wrapHtml(s.heading, `
    <p>${fill(s.sentence, safe)}</p>
    <p>${fill(howTo, safe)}</p>
    <p style="text-align: center;">
      <a href="${esc(link)}" class="btn">${args.acceptUrl ? s.buttonAccept : s.button}</a>
    </p>
    <p class="url-fallback">${esc(link)}</p>
    <p style="font-size: 13px; color: #999;">${fill(s.expiry, safe)}</p>
    <p style="color: #999; font-size: 13px;">${s.ignore}</p>
  `, lang);
  const text = [
    s.heading, '',
    fill(s.sentence, plain), '',
    fill(howTo, plain), '',
    link, '',
    fill(s.expiry, plain), '',
    s.ignore,
  ].join('\n');
  return { subject: fill(s.subject, plain), html, text };
}
