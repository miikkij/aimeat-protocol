/**
 * @file public/views/admin/email-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Email page in the poster face (design canvas "AIMEAT Admin Email"). Five
 *   numbered sections in the order an operator asks: what the SMTP settings are and what each one
 *   does, a test message that reports what the server answered, what the node sends automatically
 *   and how much of it has gone out, a message to a group with the recipient count on the button,
 *   and the templates.
 *
 *   The words are the ordinary ones: SMTP, port, STARTTLS, certificate, From address, placeholder.
 *   Each row says what the setting does and what changing it costs.
 *
 *   The page draws library components and passes them data; it writes no class.
 *
 * @structure
 *   - EmailTab({ data, locale }) — the sections, or the not-configured page when there is no host
 *   - RightNow: section 01, the settings (Verdict + Readings) and the figure strip
 *   - Automatic: section 03, the six messages the node sends by itself plus the group send (List)
 *   - NotConfigured: the whole page when no SMTP host is set: what stops working, and what to set
 *   - Sections 02 and 04 are in email-tab.send.js, section 05 in email-tab.templates.js
 *
 * @version-history
 *   v3.0.0 — 2026-09-27 — The page draws library components (Section, Verdict, Readings,
 *     FigureStrip, List, Note, Label, Code) and writes no class; admin-email.css goes. The automatic
 *     messages are a List whose cells say their column on a phone; a hard-coded message keeps its
 *     coral word, and a count of none stays grey.
 *   v2.1.0 — 2026-09-13 — Compose shared poster section headings.
 *   v2.0.0 — 2026-09-12 — The poster face. The page now shows the setting that decides whether a
 *     new account must confirm its address (the status route has always returned it and no screen
 *     showed it), all six messages the node sends rather than three, how many people a group send
 *     would reach before it is pressed, and how many messages have actually gone out. The test-send
 *     menu no longer offers "Match suggestion", which is not a message type this node has.
 *   v1.2.0 — 2026-09-05 — The four yes/no cells say ✓ and ✗ instead of two emoji.
 *   v1.1.0 — 2026-06-02 — Admin design unification.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section } from '/components/Section.js';
import { Verdict, Readings } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row as ListRow, Name, Desc, Cell, Num } from '/components/List.js';
import { Note } from '/components/Note.js';
import { Label, Code } from '/components/Mark.js';
import { num, Empty, Badge } from './shared.js';
import { TestSend, GroupSend } from './email-tab.send.js';
import Templates from './email-tab.templates.js';

const E = (key, params) => t('admin.email.' + key, params);

/** The messages the node sends without anyone pressing anything, in the order they are met. */
const AUTOMATIC = [
  { id: 'verification', counter: 'verification', template: 'verification' },
  { id: 'magic_link', counter: 'magic_link', template: 'magic_link' },
  { id: 'notification', counter: 'notification', template: 'notification' },
  { id: 'invitation', counter: 'invitation', template: null },
  { id: 'key_invitation', counter: 'key_invitation', template: null },
  { id: 'key_credentials', counter: 'key_credentials', template: null },
  // Not automatic, but it goes out through the same server and is counted the same way.
  { id: 'group_send', counter: 'group_send', template: null },
];

/** The sample settings the not-configured page gives to copy. */
const ENV_SAMPLE = [
  'AIMEAT_SMTP_HOST=mail.example.com',
  'AIMEAT_SMTP_PORT=587',
  'AIMEAT_SMTP_USER=notifications@example.com',
  'AIMEAT_SMTP_PASS=…',
  'AIMEAT_SMTP_FROM=Example <notifications@example.com>',
  'AIMEAT_SMTP_SECURE=false',
  'AIMEAT_SMTP_REJECT_UNAUTHORIZED=true',
].join('\n');

/** "notifications@aimeat.io" out of "AIMEAT <notifications@aimeat.io>", and its domain. */
function fromParts(fromHeader) {
  const raw = String(fromHeader || '');
  const inAngles = raw.match(/<([^>]+)>/);
  const address = (inAngles ? inAngles[1] : raw).trim();
  const at = address.lastIndexOf('@');
  return { address, domain: at > 0 ? address.slice(at + 1) : '' };
}

/** Section 01: every setting, what it does, and the figure strip under it. */
function RightNow({ email }) {
  const from = fromParts(email.smtp_from);
  const host = String(email.smtp_host || '');
  const sent = email.sent || {};
  const rec = email.recipients || {};
  // The From domain matters on its own: the receiving side checks SPF and DKIM against it, and
  // those records live in DNS. Same domain family as the server is the ordinary case.
  const sameFamily = !!from.domain && (host === from.domain || host.endsWith('.' + from.domain));
  const secure = email.smtp_secure === true;
  const credsSet = email.smtp_user_configured && email.smtp_pass_configured;

  return html`
    <${Section} num="01" title=${E('now.title')} first>
      <${Verdict} word=${E('now.word')} line=${E('now.line', { host })}
        stamp=${E('now.log', { host, port: email.smtp_port, mode: secure ? 'TLS' : 'STARTTLS', from: from.address })}>
        <${Readings} rows=${[
          { key: 'server', name: E('now.server'), why: E('now.serverWhy'),
            mark: html`<${Badge} type="healthy" label=${E('now.configured')} />`, value: host + ':' + email.smtp_port },
          { key: 'transport', name: E('now.transport'), why: E('now.transportWhy'),
            mark: html`<${Badge} type="healthy" label=${secure ? 'TLS' : 'STARTTLS'} />`,
            value: secure ? E('now.tlsValue') : E('now.starttlsValue') },
          { key: 'cert', name: E('now.certificate'), why: E('now.certificateWhy'),
            mark: html`<${Badge} type=${email.smtp_reject_unauthorized ? 'healthy' : 'warning'}
              label=${email.smtp_reject_unauthorized ? E('now.on') : E('now.off')} />`,
            value: email.smtp_reject_unauthorized ? E('now.certOnValue') : E('now.certOffValue') },
          { key: 'from', name: E('now.from'), why: E('now.fromWhy'), mark: null, value: email.smtp_from },
          { key: 'domain', name: E('now.fromDomain'), why: sameFamily ? E('now.fromDomainWhy') : E('now.fromDomainOtherWhy', { host }),
            mark: html`<${Badge} type=${sameFamily ? 'healthy' : 'muted'} label=${sameFamily ? E('now.sameDomain') : E('now.otherDomain')} />`,
            value: from.domain },
          { key: 'creds', name: E('now.credentials'), why: E('now.credentialsWhy'),
            mark: html`<${Badge} type=${credsSet ? 'healthy' : 'warning'} label=${credsSet ? E('now.bothSet') : E('now.missing')} />`,
            value: 'AIMEAT_SMTP_USER / _PASS' },
          { key: 'verify', name: E('now.verification'), why: E('now.verificationWhy'), last: true,
            mark: html`<${Badge} type=${email.confirmation_required ? 'healthy' : 'muted'}
              label=${email.confirmation_required ? E('now.required') : E('now.notRequired')} />`,
            value: 'AIMEAT_EMAIL_CONFIRMATION_REQUIRED' },
        ]} />
      <//>
      <${FigureStrip} wrap items=${[
        { key: 'sent', n: sent.counted ? num(sent.total ?? 0) : '—', label: E('strip.sent'),
          sub: sent.counted ? E('strip.sentSub') : E('strip.notCounted') },
        { key: 'week', n: sent.counted ? num(sent.last_7_days ?? 0) : '—', label: E('strip.week'), sub: E('strip.weekSub') },
        // The one figure to look at, in coral, once anything has failed.
        { key: 'failed', n: sent.counted ? num(sent.failed ?? 0) : '—', tone: sent.failed ? 'notice' : undefined,
          label: E('strip.failed'), sub: E('strip.failedSub') },
        { key: 'reach', n: num(rec.with_address ?? 0), label: E('strip.reach'),
          sub: E('strip.reachSub', { total: num(rec.accounts ?? 0) }) },
      ]} />
    <//>`;
}

/** Section 03: what leaves the node without anyone pressing anything, and how much has. */
function Automatic({ email }) {
  const sent = email.sent || {};
  const byType = sent.by_type || {};
  const count = key => (sent.counted ? (byType[key] ?? 0) : null);

  return html`
    <${Section} num="03" title=${E('auto.title')}>
      <${Note} kind="lead">${E('auto.lead')}<//>
      <${List} cols="name-desc-code-n" labels
        head=${[E('auto.colMessage'), E('auto.colWhen'), E('auto.colTemplate'), { label: E('auto.colSent'), num: true }]}>
        ${AUTOMATIC.map((m) => {
    const n = count(m.counter);
    return html`
          <${ListRow} key=${m.id}>
            <${Name}>${E('kind.' + m.id)}<//>
            <${Desc}>${E('auto.when.' + m.id)}<//>
            ${m.template
      ? html`<${Cell} meta>${m.template}<//>`
      // A message with no template to edit says so in coral: it is written into the code.
      : html`<${Cell} sign>${E('auto.hardCoded')}<//>`}
            <${Num} dim=${!n}>${n === null ? '—' : num(n)}<//>
          <//>`;
  })}
      <//>
      <${Note}>${E('auto.note')}<//>
    <//>`;
}

/** The whole page when no SMTP host is set: what stops working, and what to set. */
function NotConfigured() {
  return html`
    <${Section} num="01" title=${E('now.title')} first>
      <${Verdict} word=${E('off.word')} tone="danger" line=${E('off.line')} stamp=${E('off.log')}>
        <${Readings} rows=${[
          { key: 'verification', name: E('kind.verification'), why: E('off.verificationWhy'),
            mark: html`<${Badge} type="warning" label=${E('off.notSent')} />`, value: E('off.atSignUp') },
          { key: 'magic', name: E('kind.magic_link'), why: E('off.magicWhy'),
            mark: html`<${Badge} type="warning" label=${E('off.notSent')} />`, value: E('off.atSignIn') },
          { key: 'notification', name: E('kind.notification'), why: E('off.notificationWhy'),
            mark: html`<${Badge} type="warning" label=${E('off.notSent')} />`, value: E('off.inAppOnly') },
          { key: 'invites', name: E('off.invites'), why: E('off.invitesWhy'), last: true,
            mark: html`<${Badge} type="muted" label=${E('off.linkOnly')} />`, value: E('off.noEmail') },
        ]} />
      <//>
    <//>

    <${Section} num="02" title=${E('off.setTitle')}>
      <${Note} kind="lead">${E('off.setLead')}<//>
      <${Label} block>${E('off.envLabel')}<//>
      <${Code} block>${ENV_SAMPLE}<//>
      <${Note}>${E('off.setNote')}<//>
      <${Note}>${E('off.dnsNote')}<//>
    <//>`;
}

export default function EmailTab({ data, locale }) {
  const email = data.email;
  if (!email) return html`<${Empty} text=${t('dashboard.emailNotAvailable')} />`;
  if (!email.enabled) return html`<${NotConfigured} />`;

  return html`
    <${RightNow} email=${email} />
    <${TestSend} locale=${locale || 'en'} />
    <${Automatic} email=${email} />
    <${GroupSend} recipients=${email.recipients} />
    <${Templates} locale=${locale || 'en'} />`;
}
