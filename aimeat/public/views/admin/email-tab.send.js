/**
 * @file public/views/admin/email-tab.send.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 02 and 04 of the Email page (design canvas "AIMEAT Admin Email"): the test
 *   message, and the message to a group. Both go out through the SMTP server the page describes
 *   above them, so both say what the server answered rather than only that a button was pressed.
 *   The group send prints its recipient count before it is pressed, from the numbers the status
 *   route now returns.
 *
 * @structure
 *   - TestSend({ locale, sent }) — section 02, one address, three message types
 *   - GroupSend({ recipients }) — section 04, operators or everyone, subject and message
 *   - Choice — the row of tab words a radio choice is made from
 *
 * @version-history
 *   v2.0.0 — 2026-09-22 — Composed from the shared component set: shared sections, fields, tab
 *     words with radio semantics for the choices, and the answer box as a box of key-value rows.
 *     No class of the page's own any more.
 *   v1.1.0 — 2026-09-13 — Compose shared poster send-section headings.
 *   v1.0.0 — 2026-09-12 — Initial, with the Email page in the poster face.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { time as fmtTime } from '/js/format.js';
import { num } from './shared.js';
import { Section, Columns, Stack, KeyValue, Field, Surface, Action, Text } from '/components/poster-parts.js';
import { sendTestEmail, sendGroupEmail } from '/js/services/admin.js';

const E = (key, params) => t('admin.email.' + key, params);

/** The three message types a test can be sent as; the node has a template for each. */
const TEST_TYPES = ['notification', 'verification', 'magic_link'];

/** A labelled row of choices, one of them on. */
function Choice({ label, options, value, onChange }) {
  return html`<${Stack} density="compact">
    <${Text} kind="label">${label}<//>
    <${Stack} direction="wrap" role="radiogroup" label=${label}>
      ${options.map(o => html`<${Action} key=${o.id} kind="tab" semantics="radio" selected=${value === o.id} onClick=${() => onChange(o.id)}>${o.label}<//>`)}
    <//>
  <//>`;
}

/** Section 02: one real message through the configured server. */
export function TestSend({ locale }) {
  const [to, setTo] = useState('');
  const [type, setType] = useState('notification');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  async function send() {
    if (!to) return;
    setSending(true);
    setResult(null);
    const started = Date.now();
    try {
      const r = await sendTestEmail(to, type, locale);
      setResult({
        ok: !!r.data?.sent,
        at: fmtTime(new Date()),
        seconds: Math.max(1, Math.round((Date.now() - started) / 1000)),
        type,
        message: r.data?.sent ? null : E('test.refused'),
      });
    } catch (e) {
      setResult({ ok: false, at: fmtTime(new Date()), type, message: e.message });
    }
    setSending(false);
  }

  return html`
    <${Section} title=${E('test.title')} count="02" description=${E('test.lead')}>
      <${Columns} layout="equal" collapse=${640}>
        <${Stack}>
          <${Field} type="email" label=${E('test.to')} value=${to} placeholder=${E('test.toPlaceholder')}
            onInput=${e => setTo(e.target.value)} />
          <${Choice} label=${E('test.type')} value=${type} onChange=${setType}
            options=${TEST_TYPES.map(id => ({ id, label: E('kind.' + id) }))} />
          <${Stack} direction="wrap" align="center">
            <${Action} onClick=${send} disabled=${sending || !to}>${sending ? E('test.sending') : E('test.send')}<//>
            <${Text} kind="caption" tone="muted">${E('test.note')}<//>
          <//>
        <//>
        <${Stack} density="compact">
          <${Text} kind="label">${E('test.lastTitle')}<//>
          ${result
    ? html`<${Surface} kind="box">
            <${KeyValue} label=${result.at} value=${result.ok ? '250 OK' : E('test.failed')} mono=${true} />
            <${KeyValue} label=${result.ok ? E('test.accepted') : E('test.notAccepted')} value=${E('test.byServer')} />
            <${KeyValue} label=${E('test.took')} value=${E('test.seconds', { n: result.seconds ?? 0 })} />
            <${KeyValue} label=${E('test.typeRow')} value=${result.type} mono=${true} />
          <//>
          <${Text} kind="caption" tone=${result.ok ? 'muted' : 'danger'}>${result.ok ? E('test.hintOk') : E('test.hintBad')}<//>`
    : html`<${Surface} kind="box"><${KeyValue} label=${E('test.none')} value="—" /><//>
          <${Text} kind="caption" tone="muted">${E('test.hintIdle')}<//>`}
        <//>
      <//>
    <//>`;
}

/** Section 04: one message to everyone in the group who has an address. */
export function GroupSend({ recipients }) {
  const [group, setGroup] = useState('operators');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const r = recipients || {};
  const reach = group === 'operators' ? (r.operators_with_address ?? 0) : (r.with_address ?? 0);

  async function send() {
    if (!subject || !body) return;
    setSending(true);
    setResult(null);
    try {
      const res = await sendGroupEmail(group, subject, body);
      setResult({ ok: true, text: E('group.done', { sent: num(res.data.sent), total: num(res.data.total) }) });
      setSubject('');
      setBody('');
    } catch (e) {
      setResult({ ok: false, text: e.message });
    }
    setSending(false);
  }

  return html`
    <${Section} title=${E('group.title')} count="04" description=${E('group.lead')}>
      <${Columns} layout="equal" collapse=${640}>
        <${Stack}>
          <${Choice} label=${E('group.group')} value=${group} onChange=${setGroup}
            options=${[{ id: 'operators', label: E('group.operators') }, { id: 'all', label: E('group.everyone') }]} />
          <${Field} label=${E('group.subject')} value=${subject} placeholder=${E('group.subjectPlaceholder')}
            onInput=${e => setSubject(e.target.value)} />
          <${Field} type="textarea" rows=${4} label=${E('group.body')} value=${body} placeholder=${E('group.bodyPlaceholder')}
            onInput=${e => setBody(e.target.value)} />
          <${Stack} direction="wrap" align="center">
            <${Action} onClick=${send} disabled=${sending || !subject || !body || !reach}>
              ${sending ? E('group.sending') : reach ? E('group.send', { n: num(reach) }) : E('group.nobody')}
            <//>
            <${Text} kind="caption" tone="muted">${E('group.note')}<//>
          <//>
          ${result && html`<${Text} tone=${result.ok ? 'success' : 'danger'}>${result.text}<//>`}
        <//>
        <${Stack} density="compact">
          <${Text} kind="label">${E('group.whoTitle')}<//>
          <${Surface} kind="box">
            <${KeyValue} label=${E('group.operators')} value=${E('group.ofN', { n: num(r.operators_with_address ?? 0), total: num(r.operators ?? 0) })} />
            <${KeyValue} label=${E('group.everyone')} value=${E('group.ofN', { n: num(r.with_address ?? 0), total: num(r.accounts ?? 0) })} />
          <//>
          <${Text} kind="caption" tone="muted">${E('group.whoHint')}<//>
        <//>
      <//>
    <//>`;
}
