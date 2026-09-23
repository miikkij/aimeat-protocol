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
 * @structure
 *   - EmailTab({ data, locale }) — the sections, or the not-configured page when there is no host
 *   - Status: the word, the sentence and the log line that open section 01
 *   - RightNow: section 01, the settings and the numeral strip
 *   - Automatic: section 03, the six messages the node sends by itself plus the group send
 *   - NotConfigured: the whole page when no SMTP host is set: what stops working, and what to set
 *   - Sections 02 and 04 are in email-tab.send.js, section 05 in email-tab.templates.js
 *
 * @version-history
 *   v3.0.0 — 2026-09-22 — Composed from the shared component set (components/poster-parts.js):
 *     shared sections, the numeral band for the strip, the shared table for the automatic messages,
 *     a code surface for the settings to set. The page's own sheet (admin-email.css) is gone.
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
import { num, Empty, Badge, Row } from './shared.js';
import { Section, Columns, Stack, Table, NumeralBand, Surface, Text } from '/components/poster-parts.js';
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
];

/** "notifications@aimeat.io" out of "AIMEAT <notifications@aimeat.io>", and its domain. */
function fromParts(fromHeader) {
  const raw = String(fromHeader || '');
  const inAngles = raw.match(/<([^>]+)>/);
  const address = (inAngles ? inAngles[1] : raw).trim();
  const at = address.lastIndexOf('@');
  return { address, domain: at > 0 ? address.slice(at + 1) : '' };
}

/** The status word, the sentence under it and the one mono log line. */
function Status({ word, line, log, danger }) {
  return html`<${Stack} density="compact">
    <${Text} kind="number" tone=${danger ? 'danger' : 'plain'}>${word}<//>
    <${Text}>${line}<//>
    <${Text} kind="mono" tone="muted">${log}<//>
  <//>`;
}

/** Section 01: every setting, what it does, and the numeral strip under it. */
function RightNow({ email }) {
  const from = fromParts(email.smtp_from);
  const host = String(email.smtp_host || '');
  const sent = email.sent || {};
  const rec = email.recipients || {};
  // The From domain matters on its own: the receiving side checks SPF and DKIM against it, and
  // those records live in DNS. Same domain family as the server is the ordinary case.
  const sameFamily = !!from.domain && (host === from.domain || host.endsWith('.' + from.domain));
  const secure = email.smtp_secure === true;

  return html`
    <${Section} title=${E('now.title')} count="01">
      <${Columns} layout="trailing" collapse=${900}>
        <${Status} word=${E('now.word')} line=${E('now.line', { host })}
          log=${E('now.log', { host, port: email.smtp_port, mode: secure ? 'TLS' : 'STARTTLS', from: from.address })} />
        <div>
          <${Row} title=${E('now.server')} why=${E('now.serverWhy')}
            chip=${html`<${Badge} type="healthy" label=${E('now.configured')} />`}
            value=${host + ':' + email.smtp_port} />
          <${Row} title=${E('now.transport')} why=${E('now.transportWhy')}
            chip=${html`<${Badge} type="healthy" label=${secure ? 'TLS' : 'STARTTLS'} />`}
            value=${secure ? E('now.tlsValue') : E('now.starttlsValue')} />
          <${Row} title=${E('now.certificate')} why=${E('now.certificateWhy')}
            chip=${html`<${Badge} type=${email.smtp_reject_unauthorized ? 'healthy' : 'warning'}
              label=${email.smtp_reject_unauthorized ? E('now.on') : E('now.off')} />`}
            value=${email.smtp_reject_unauthorized ? E('now.certOnValue') : E('now.certOffValue')} />
          <${Row} title=${E('now.from')} why=${E('now.fromWhy')} value=${email.smtp_from} />
          <${Row} title=${E('now.fromDomain')} why=${sameFamily ? E('now.fromDomainWhy') : E('now.fromDomainOtherWhy', { host })}
            chip=${html`<${Badge} type=${sameFamily ? 'healthy' : 'muted'} label=${sameFamily ? E('now.sameDomain') : E('now.otherDomain')} />`}
            value=${from.domain} />
          <${Row} title=${E('now.credentials')} why=${E('now.credentialsWhy')}
            chip=${html`<${Badge} type=${email.smtp_user_configured && email.smtp_pass_configured ? 'healthy' : 'warning'}
              label=${email.smtp_user_configured && email.smtp_pass_configured ? E('now.bothSet') : E('now.missing')} />`}
            value="AIMEAT_SMTP_USER / _PASS" />
          <${Row} title=${E('now.verification')} why=${E('now.verificationWhy')}
            chip=${html`<${Badge} type=${email.confirmation_required ? 'healthy' : 'muted'}
              label=${email.confirmation_required ? E('now.required') : E('now.notRequired')} />`}
            value="AIMEAT_EMAIL_CONFIRMATION_REQUIRED" />
        </div>
      <//>
      <${NumeralBand} tone="plain" items=${[
        { label: E('strip.sent'), value: sent.counted ? num(sent.total ?? 0) : '—', note: sent.counted ? E('strip.sentSub') : E('strip.notCounted') },
        { label: E('strip.week'), value: sent.counted ? num(sent.last_7_days ?? 0) : '—', note: E('strip.weekSub') },
        { label: E('strip.failed'), value: sent.counted ? num(sent.failed ?? 0) : '—', note: E('strip.failedSub'), tone: sent.failed ? 'coral' : undefined },
        { label: E('strip.reach'), value: num(rec.with_address ?? 0), note: E('strip.reachSub', { total: num(rec.accounts ?? 0) }) },
      ]} />
    <//>`;
}

/** Section 03: what leaves the node without anyone pressing anything, and how much has. */
function Automatic({ email }) {
  const sent = email.sent || {};
  const byType = sent.by_type || {};
  const count = key => (sent.counted ? (byType[key] ?? 0) : null);
  const cell = n => (n === null || !n
    ? html`<${Text} kind="mono" tone="muted">${n === null ? '—' : num(n)}<//>`
    : { text: num(n), align: 'end' });
  const template = (name) => (name
    ? { text: name, mono: true }
    : html`<${Text} kind="caption" tone="muted">${E('auto.hardCoded')}<//>`);

  return html`
    <${Section} title=${E('auto.title')} count="03" description=${E('auto.lead')}>
      <${Table} collapse=${640}
        headers=${[E('auto.colMessage'), E('auto.colWhen'), E('auto.colTemplate'), E('auto.colSent')]}
        rows=${[
          ...AUTOMATIC.map(m => [html`<strong>${E('kind.' + m.id)}</strong>`, E('auto.when.' + m.id), template(m.template), cell(count(m.counter))]),
          [html`<strong>${E('kind.group_send')}</strong>`, E('auto.when.group_send'), template(null), cell(count('group_send'))],
        ]} />
      <${Text} kind="caption" tone="muted">${E('auto.note')}<//>
    <//>`;
}

/** The whole page when no SMTP host is set: what stops working, and what to set. */
function NotConfigured() {
  return html`
    <${Stack}>
      <${Section} title=${E('now.title')} count="01">
        <${Columns} layout="trailing" collapse=${900}>
          <${Status} word=${E('off.word')} line=${E('off.line')} log=${E('off.log')} danger=${true} />
          <div>
            <${Row} title=${E('kind.verification')} why=${E('off.verificationWhy')}
              chip=${html`<${Badge} type="warning" label=${E('off.notSent')} />`} value=${E('off.atSignUp')} />
            <${Row} title=${E('kind.magic_link')} why=${E('off.magicWhy')}
              chip=${html`<${Badge} type="warning" label=${E('off.notSent')} />`} value=${E('off.atSignIn')} />
            <${Row} title=${E('kind.notification')} why=${E('off.notificationWhy')}
              chip=${html`<${Badge} type="warning" label=${E('off.notSent')} />`} value=${E('off.inAppOnly')} />
            <${Row} title=${E('off.invites')} why=${E('off.invitesWhy')}
              chip=${html`<${Badge} type="muted" label=${E('off.linkOnly')} />`} value=${E('off.noEmail')} />
          </div>
        <//>
      <//>

      <${Section} title=${E('off.setTitle')} count="02" description=${E('off.setLead')}>
        <${Stack}>
          <${Stack} density="compact">
            <${Text} kind="label">${E('off.envLabel')}<//>
            <${Surface} kind="code">${[
    'AIMEAT_SMTP_HOST=mail.example.com',
    'AIMEAT_SMTP_PORT=587',
    'AIMEAT_SMTP_USER=notifications@example.com',
    'AIMEAT_SMTP_PASS=…',
    'AIMEAT_SMTP_FROM=Example <notifications@example.com>',
    'AIMEAT_SMTP_SECURE=false',
    'AIMEAT_SMTP_REJECT_UNAUTHORIZED=true',
  ].join('\n')}<//>
          <//>
          <${Text} kind="caption" tone="muted">${E('off.setNote')}<//>
          <${Text} kind="caption" tone="muted">${E('off.dnsNote')}<//>
        <//>
      <//>
    <//>`;
}

export default function EmailTab({ data, locale }) {
  const email = data.email;
  if (!email) return html`<${Empty} text=${t('dashboard.emailNotAvailable')} />`;
  if (!email.enabled) return html`<${NotConfigured} />`;

  return html`
    <${Stack}>
      <${RightNow} email=${email} />
      <${TestSend} locale=${locale || 'en'} />
      <${Automatic} email=${email} />
      <${GroupSend} recipients=${email.recipients} />
      <${Templates} locale=${locale || 'en'} />
    <//>`;
}
