/**
 * @file src/services/compliance-agreements-notify.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every step of a data processing agreement tells the party it concerns (plan
 *   doc-mvmr4i2wdk0p, D4.3, and the notification table of the design): a bell notice with a push to
 *   an account on this node, and an e-mail, which reaches a counterparty who has no account at all.
 *   Who gets what, per step:
 *
 *     step                counterparty               operator
 *     sent                e-mail + bell              -
 *     reminder            e-mail                     bell (on the 7th day)
 *     counterparty-signed e-mail (receipt)          bell + e-mail
 *     copy-received       e-mail (received)          bell (confirm or reject)
 *     copy-rejected       e-mail + bell (the reason) -
 *     in-force            e-mail with the PDF + bell e-mail with the PDF + bell
 *     notice              e-mail + bell              bell
 *     notice-reminder     e-mail                     -
 *     objection           -                          bell + e-mail
 *     breach              e-mail + bell              bell
 *     ended               e-mail                     bell (the deletion clock)
 *     deletion-done       e-mail (the certificate)   -
 *
 *   The e-mails of sent, notice, breach and ended go out whatever the person's notification settings
 *   say, because the agreement requires them; the bell follows the person's own settings as always.
 *   A step is told once; the caller writes what went out into the agreement's history.
 * @structure AgreementEvent · tellAgreement()
 * @usage const told = await tellAgreement(deps, agreement, 'sent', { pdf });
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvmr4i2wdk0p, D4.3).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { notify } from './notify.js';
import { getActiveEmailService } from './email.js';
import { wrapHtml, esc } from './email-templates.js';
import { displayPrefsFor, formatForPerson } from './display-prefs.js';
import { inForce, newest } from './compliance-agreements.js';
import type { Agreement } from './compliance-agreements-schemas.js';

type Deps = { storage: Storage; config: AimeatConfig };
type Lang = 'fi' | 'en';

export type AgreementEvent =
  | 'sent' | 'reminder' | 'counterparty-signed' | 'copy-received' | 'copy-rejected' | 'in-force'
  | 'notice' | 'notice-reminder' | 'objection' | 'breach' | 'ended' | 'deletion-done';

export interface TellExtra {
  pdf?: { data: Buffer; name: string };
  reason?: string;
  days?: number;
  breach?: { title: string; discoveredAt: string; summary: string };
}

export interface Told { counterpartyEmail: boolean; counterpartyBell: boolean; operatorBell: boolean; operatorEmail: boolean }

const L = (lang: Lang, fi: string, en: string): string => (lang === 'fi' ? fi : en);
/** A calendar date in a message: written the way the reader asked, else the agreement's language's way. */
type DayFn = (iso: string | undefined, lang: Lang) => string;

/** What one step says to each side, in the agreement's language. */
function words(a: Agreement, ev: AgreementEvent, x: TellExtra, day: DayFn): { cp?: { subject: string; lines: string[] }; op?: { subject: string; lines: string[] } } {
  const lang = a.language;
  const v = newest(a);
  const opName = v0(a);
  const cp = a.counterparty.name;
  switch (ev) {
    case 'sent': return {
      cp: { subject: L(lang, 'Käsittelijäsopimus odottaa allekirjoitustasi', 'A data processing agreement waits for your signature'), lines: [
        L(lang, `${opName} käsittelee henkilötietojanne palvelun tuottamiseksi. Laki vaatii siitä kirjallisen sopimuksen. Sopimus on EU-komission vakiomalli, ja siihen on täytetty palvelunne tiedot.`,
          `${opName} processes personal data on your behalf to provide the service. The law requires a written agreement for that. The agreement is the European Commission's standard model, filled in with your service's details.`),
        L(lang, 'Voit allekirjoittaa AIMEAT-tunnuksellasi, EU:n digitaalisella lompakolla, omalla allekirjoituspalvelullanne (esimerkiksi DocuSign) tai paperilla.',
          'You can sign with your AIMEAT account, the EU Digital Identity Wallet, your own signing service (for example DocuSign) or on paper.'),
      ] },
    };
    case 'reminder': return {
      cp: { subject: L(lang, 'Muistutus: käsittelijäsopimus odottaa allekirjoitusta', 'Reminder: a data processing agreement waits for your signature'), lines: [
        L(lang, `Sopimus lähetettiin ${day(v.sentAt, lang)}, eikä sitä ole vielä allekirjoitettu.`, `The agreement was sent on ${day(v.sentAt, lang)} and is not signed yet.`),
      ] },
      ...(x.days && x.days >= 7 ? { op: { subject: L(lang, `${cp} ei ole allekirjoittanut ${x.days} päivässä`, `${cp} has not signed in ${x.days} days`), lines: [L(lang, 'Voit lähettää henkilökohtaisen viestin tai soittaa.', 'You can send a personal message or call.')] } } : {}),
    };
    case 'counterparty-signed': return {
      cp: { subject: L(lang, 'Allekirjoituksesi on vastaanotettu', 'Your signature has been received'), lines: [L(lang, `Odotamme vielä ${opName}:n allekirjoitusta. Saat valmiin sopimuksen tähän osoitteeseen.`, `We are waiting for ${opName}'s signature. You will receive the finished agreement at this address.`)] },
      op: { subject: L(lang, `${cp} allekirjoitti. Allekirjoita sinä.`, `${cp} signed. Your signature is next.`), lines: [L(lang, 'Sopimus tulee voimaan, kun sinäkin olet allekirjoittanut.', 'The agreement takes effect once you have signed too.')] },
    };
    case 'copy-received': return {
      cp: { subject: L(lang, 'Allekirjoitettu kopio vastaanotettu', 'Signed copy received'), lines: [L(lang, 'Tarkistamme sen, ja saat tiedon tähän osoitteeseen.', 'We are checking it, and you will hear from us at this address.')] },
      op: { subject: L(lang, `${cp}:n allekirjoitettu kopio odottaa: vahvista tai hylkää`, `${cp}'s signed copy waits: confirm or reject`), lines: [L(lang, 'Tarkistuksen raportti on sopimuksen sivulla.', "The check's report is on the agreement's page.")] },
    };
    case 'copy-rejected': return {
      cp: { subject: L(lang, 'Allekirjoitettua kopiota ei voitu hyväksyä', 'The signed copy could not be accepted'), lines: [x.reason ?? '', L(lang, 'Voit allekirjoittaa uudelleen samasta linkistä.', 'You can sign again from the same link.')] },
    };
    case 'in-force': return {
      cp: { subject: L(lang, 'Käsittelijäsopimus on voimassa', 'The data processing agreement is in force'), lines: [L(lang, `Sopimus on voimassa ${day(inForce(a)?.effectiveFrom, lang)} alkaen. Allekirjoitettu sopimus on liitteenä.`, `The agreement is in force from ${day(inForce(a)?.effectiveFrom, lang)}. The signed agreement is attached.`)] },
      op: { subject: L(lang, `Sopimus ${cp}:n kanssa on voimassa`, `The agreement with ${cp} is in force`), lines: [L(lang, 'Valmis sopimus on liitteenä.', 'The finished agreement is attached.')] },
    };
    case 'notice': return {
      cp: { subject: L(lang, `Alikäsittelijä muuttuu ${day(v.notice?.objectionUntil, lang)}`, `A sub-processor changes on ${day(v.notice?.objectionUntil, lang)}`), lines: [
        L(lang, `Sopimuksemme mukaan kerromme ${v.options.noticeDays} päivää etukäteen, jos alikäsittelijät muuttuvat. Teidän ei tarvitse tehdä mitään, jos muutos sopii. Jos se ei sovi, voitte vastustaa sitä ${day(v.notice?.objectionUntil, lang)} asti.`,
          `Under our agreement we tell you ${v.options.noticeDays} days in advance when the sub-processors change. You need to do nothing if the change suits you. If it does not, you can object until ${day(v.notice?.objectionUntil, lang)}.`),
        ...changedSubprocessors(a, lang),
      ] },
      op: { subject: L(lang, `Ilmoitus muutoksesta lähti: ${cp}`, `Change notice sent: ${cp}`), lines: [L(lang, `Vastustusaika päättyy ${day(v.notice?.objectionUntil, lang)}.`, `The objection period ends on ${day(v.notice?.objectionUntil, lang)}.`)] },
    };
    case 'notice-reminder': return {
      cp: { subject: L(lang, `Muistutus: alikäsittelijä muuttuu ${day(v.notice?.objectionUntil, lang)}`, `Reminder: a sub-processor changes on ${day(v.notice?.objectionUntil, lang)}`), lines: changedSubprocessors(a, lang) },
    };
    case 'objection': return {
      op: { subject: L(lang, `${cp} vastustaa alikäsittelijän muutosta`, `${cp} objects to the sub-processor change`), lines: [x.reason ?? '', L(lang, 'Muutos ei tule voimaan tälle asiakkaalle ennen kuin asia on ratkaistu.', 'The change does not take effect for this customer until it is settled.')] },
    };
    case 'breach': return {
      cp: { subject: L(lang, 'Tietoturvaloukkaus, joka koskee tietojanne', 'A personal data breach that concerns your data'), lines: [
        x.breach?.title ?? '', L(lang, `Havaittu: ${day(x.breach?.discoveredAt, lang)}.`, `Discovered: ${day(x.breach?.discoveredAt, lang)}.`), x.breach?.summary ?? '',
        L(lang, 'Kuittaa tämä viesti, koska teidän 72 tunnin määräaikanne valvojalle alkaa.', 'Please acknowledge this message: your 72-hour deadline towards the supervisory authority starts.'),
      ] },
      op: { subject: L(lang, `Loukkausilmoitus lähti: ${cp}`, `Breach notice sent: ${cp}`), lines: [x.breach?.title ?? ''] },
    };
    case 'ended': return {
      cp: { subject: L(lang, 'Käsittelijäsopimus päättyy', 'The data processing agreement ends'), lines: [
        L(lang, `Sopimus päättyi ${day(a.endedAt, lang)}. Tiedot ${a.deletion?.choice === 'return' ? 'palautetaan' : 'poistetaan'} viimeistään ${day(a.deletion?.dueAt, lang)}, ja saatte siitä vahvistuksen.`,
          `The agreement ended on ${day(a.endedAt, lang)}. The data will be ${a.deletion?.choice === 'return' ? 'returned' : 'deleted'} by ${day(a.deletion?.dueAt, lang)}, and you will receive a confirmation.`),
      ] },
      op: { subject: L(lang, `Sopimus ${cp}:n kanssa päättyi: poista tiedot ${day(a.deletion?.dueAt, lang)} mennessä`, `The agreement with ${cp} ended: delete the data by ${day(a.deletion?.dueAt, lang)}`), lines: [] },
    };
    case 'deletion-done': return {
      cp: { subject: L(lang, 'Vahvistus: tiedot on poistettu', 'Confirmation: the data has been deleted'), lines: [
        L(lang, `${opName} vahvistaa, että sopimuksen ${a.id} perusteella käsitellyt henkilötiedot on ${a.deletion?.choice === 'return' ? 'palautettu ja kopiot poistettu' : 'poistettu'} ${day(a.deletion?.doneAt, lang)}.`,
          `${opName} certifies that the personal data processed under agreement ${a.id} was ${a.deletion?.choice === 'return' ? 'returned and its copies deleted' : 'deleted'} on ${day(a.deletion?.doneAt, lang)}.`),
        a.deletion?.note ?? '',
      ] },
    };
  }
}

/** What changed in Annex IV against the version in force, as lines a reader understands. */
function changedSubprocessors(a: Agreement, lang: Lang): string[] {
  const now = newest(a).annexes.IV.subprocessors;
  const before = new Set((inForce(a)?.annexes.IV.subprocessors ?? []).map(s => s.name));
  const after = new Set(now.map(s => s.name));
  const added = now.filter(s => !before.has(s.name)).map(s => `${s.name}${s.country ? ` (${s.country})` : ''}: ${s.description}`);
  const removed = [...before].filter(n => !after.has(n));
  return [
    ...added.map(s => L(lang, `Uusi: ${s}`, `New: ${s}`)),
    ...removed.map(n => L(lang, `Poistuu: ${n}`, `Removed: ${n}`)),
  ];
}

async function emailOf(storage: Storage, account: string | undefined): Promise<string | null> {
  if (!account) return null;
  const g = await storage.getGHII(account);
  return (g as { notificationEmail?: string | null } | null)?.notificationEmail ?? null;
}

function html(lang: Lang, subject: string, lines: string[], link: string | null, linkText: string, a: Agreement): { html: string; text: string } {
  const body = lines.filter(Boolean).map(l => `<p>${esc(l)}</p>`).join('\n')
    + (link ? `\n<p><a class="btn" href="${esc(link)}">${esc(linkText)}</a></p>` : '')
    + `\n<p class="url-fallback">${esc(`${a.id} · ${L(lang, 'versio', 'version')} ${newest(a).n}`)}</p>`;
  const text = [...lines.filter(Boolean), ...(link ? [`${linkText}: ${link}`] : []), `${a.id} v${newest(a).n}`].join('\n\n');
  return { html: wrapHtml(esc(subject), body, lang), text };
}

/** Tell both sides what this step means for them. Never throws: a notice failing must not undo the step. */
export async function tellAgreement(deps: Deps, a: Agreement, ev: AgreementEvent, x: TellExtra = {}): Promise<Told> {
  const told: Told = { counterpartyEmail: false, counterpartyBell: false, operatorBell: false, operatorEmail: false };
  try {
    const lang = a.language;
    // The counterparty's own date format when it has an account and said one; else the agreement language's.
    const own = a.counterparty.account ? await displayPrefsFor(deps.storage, a.counterparty.account) : null;
    const prefs = { locale: null, timezone: own?.timezone ?? null, region: own?.region ?? (lang === 'fi' ? 'fi-FI' : 'en-GB') };
    const day: DayFn = iso => (iso ? formatForPerson(prefs, iso, { dateStyle: 'long' }) : '');
    const w = words(a, ev, x, day);
    const base = deps.config.baseUrl.replace(/\/$/, '');
    const cpLink = a.counterparty.account ? `/v1/profile?tab=agreements#agreements/${a.id}` : null;
    const opLink = `/v1/admin?tab=compliance#agreements/${a.id}`;
    const email = getActiveEmailService();
    const created = a.history.find(h => h.event === 'created');
    const operatorAccount = created?.by && created.by.includes('@') && !created.by.includes('#') ? created.by : null;

    if (w.cp) {
      const to = a.counterparty.contactEmail ?? await emailOf(deps.storage, a.counterparty.account);
      if (to && email?.enabled) {
        const m = html(lang, w.cp.subject, w.cp.lines, cpLink ? `${base}${cpLink}` : null, L(lang, 'Avaa sopimus', 'Open the agreement'), a);
        told.counterpartyEmail = x.pdf
          ? await email.sendWithAttachments(to, w.cp.subject, m.html, m.text, [{ filename: x.pdf.name, content: x.pdf.data, contentType: 'application/pdf' }])
          : await email.sendRaw(to, w.cp.subject, m.html, m.text);
      }
      if (a.counterparty.account && ev !== 'reminder' && ev !== 'notice-reminder' && ev !== 'counterparty-signed' && ev !== 'copy-received' && ev !== 'deletion-done') {
        const r = await notify(deps.storage, a.counterparty.account, {
          type: `agreement_${ev.replace(/-/g, '_')}`, title: w.cp.subject, body: w.cp.lines.filter(Boolean)[0] ?? '', link: cpLink ?? undefined,
          i18n: { key: `agreement_${ev.replace(/-/g, '_')}_cp`, vars: { operator: v0(a), agreement: a.id } },
        });
        told.counterpartyBell = r.stored;
      }
    }
    if (w.op) {
      if (operatorAccount) {
        const r = await notify(deps.storage, operatorAccount, {
          type: `agreement_${ev.replace(/-/g, '_')}`, title: w.op.subject, body: w.op.lines.filter(Boolean)[0] ?? '', link: opLink,
          i18n: { key: `agreement_${ev.replace(/-/g, '_')}_op`, vars: { counterparty: a.counterparty.name, agreement: a.id } },
        });
        told.operatorBell = r.stored;
      }
      const opEmail = deps.config.operator?.email;
      if (opEmail && email?.enabled && (ev === 'counterparty-signed' || ev === 'in-force' || ev === 'objection')) {
        const m = html(lang, w.op.subject, w.op.lines, `${base}${opLink}`, L(lang, 'Avaa sopimus', 'Open the agreement'), a);
        told.operatorEmail = x.pdf
          ? await email.sendWithAttachments(opEmail, w.op.subject, m.html, m.text, [{ filename: x.pdf.name, content: x.pdf.data, contentType: 'application/pdf' }])
          : await email.sendRaw(opEmail, w.op.subject, m.html, m.text);
      }
    }
  } catch (err) {
    logger.warn('agreements: a notice could not be sent', { agreement: a.id, event: ev, error: String(err) });
  }
  return told;
}

/** The operator's name as the counterparty reads it. */
function v0(a: Agreement): string {
  const v = newest(a);
  return a.ourRole === 'processor' ? v.annexes.I.processor.name : v.annexes.I.controller.name;
}
