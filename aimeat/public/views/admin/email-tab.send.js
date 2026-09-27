/**
 * @file public/views/admin/email-tab.send.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 02 and 04 of the Email page (design canvas "AIMEAT Admin Email"): the test
 *   message, and the message to a group. Both go out through the SMTP server the page describes
 *   above them, so both say what the server answered rather than only that a button was pressed.
 *   The group send prints its recipient count before it is pressed, from the numbers the status
 *   route now returns. The sections draw library components and pass them data; they write no class.
 *
 * @structure
 *   - TestSend({ locale }) — section 02, one address, three message types
 *   - GroupSend({ recipients }) — section 04, operators or everyone, subject and message
 *   - Reply({ label, head, rows, hint }) — the box on the right: what the server said, or who a
 *     group send reaches
 *
 * @version-history
 *   v2.0.0 — 2026-09-27 — The sections draw library components (Section, Beside, TextField,
 *     TextArea, Tabs, Loud, Box, Readings, Note) and write no class. The message type and the group
 *     are a chooser of tabs; the server's reply is a box whose head carries the time and the answer
 *     as marks.
 *   v1.1.0 — 2026-09-13 — Compose shared poster send-section headings.
 *   v1.0.0 — 2026-09-12 — Initial, with the Email page in the poster face.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { time as fmtTime } from '/js/format.js';
import { Section } from '/components/Section.js';
import { Beside, Stack } from '/components/Layout.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Field, FormActions } from '/components/Field.js';
import { Tabs } from '/components/Tabs.js';
import { Loud } from '/components/Action.js';
import { Box } from '/components/Box.js';
import { Readings } from '/components/Readings.js';
import { Note } from '/components/Note.js';
import { Mark, Label } from '/components/Mark.js';
import { num } from './shared.js';
import { sendTestEmail, sendGroupEmail } from '/js/services/admin.js';

const E = (key, params) => t('admin.email.' + key, params);

/** The three message types a test can be sent as; the node has a template for each. */
const TEST_TYPES = ['notification', 'verification', 'magic_link'];

/** The box on the right with its row label over it and its hint under it. */
function Reply({ label, marks, end, rows, hint }) {
  return html`
    <${Stack} gap="none">
      <${Label} block>${label}<//>
      <${Box} marks=${marks} end=${end}>
        <${Readings} rows=${rows} />
      <//>
      <${Note}>${hint}<//>
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

  const reply = result
    ? html`<${Reply} label=${E('test.lastTitle')}
        marks=${html`<${Mark} kind="time">${result.at}<//>`}
        end=${html`<${Mark} kind="status" tone=${result.ok ? 'fine' : 'danger'}>${result.ok ? '250 OK' : E('test.failed')}<//>`}
        rows=${[
          { key: 'said', name: result.ok ? E('test.accepted') : E('test.notAccepted'), value: E('test.byServer') },
          { key: 'took', name: E('test.took'), value: E('test.seconds', { n: result.seconds ?? 0 }) },
          { key: 'type', name: E('test.typeRow'), value: result.type, last: true },
        ]}
        hint=${result.ok ? E('test.hintOk') : E('test.hintBad')} />`
    : html`<${Reply} label=${E('test.lastTitle')} rows=${[{ key: 'none', name: E('test.none'), value: '—', last: true }]}
        hint=${E('test.hintIdle')} />`;

  return html`
    <${Section} num="02" title=${E('test.title')}>
      <${Note} kind="lead">${E('test.lead')}<//>
      <${Beside} narrow side=${reply}>
        <${Stack} gap="large">
          <${TextField} type="email" label=${E('test.to')} value=${to} placeholder=${E('test.toPlaceholder')}
            onInput=${setTo} onEnter=${send} />
          <${Field} label=${E('test.type')} group>
            <${Tabs} tone="filter" value=${type} onSelect=${setType}
              items=${TEST_TYPES.map((id) => ({ value: id, label: E('kind.' + id) }))} />
          <//>
          <${FormActions}>
            <${Loud} control onClick=${send} disabled=${sending || !to}>
              ${sending ? E('test.sending') : E('test.send')}
            <//>
            <${Note} slab>${E('test.note')}<//>
          <//>
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

  const who = html`<${Reply} label=${E('group.whoTitle')}
    rows=${[
      { key: 'ops', name: E('group.operators'), value: E('group.ofN', { n: num(r.operators_with_address ?? 0), total: num(r.operators ?? 0) }) },
      { key: 'all', name: E('group.everyone'), value: E('group.ofN', { n: num(r.with_address ?? 0), total: num(r.accounts ?? 0) }), last: true },
    ]}
    hint=${E('group.whoHint')} />`;

  return html`
    <${Section} num="04" title=${E('group.title')}>
      <${Note} kind="lead">${E('group.lead')}<//>
      <${Beside} narrow side=${who}>
        <${Stack} gap="large">
          <${Field} label=${E('group.group')} group>
            <${Tabs} tone="filter" value=${group} onSelect=${setGroup}
              items=${[{ value: 'operators', label: E('group.operators') }, { value: 'all', label: E('group.everyone') }]} />
          <//>
          <${TextField} label=${E('group.subject')} value=${subject} placeholder=${E('group.subjectPlaceholder')}
            onInput=${setSubject} />
          <${TextArea} label=${E('group.body')} rows=${4} value=${body} placeholder=${E('group.bodyPlaceholder')}
            onInput=${setBody} />
          <${FormActions}>
            <${Loud} control onClick=${send} disabled=${sending || !subject || !body || !reach}>
              ${sending ? E('group.sending') : reach ? E('group.send', { n: num(reach) }) : E('group.nobody')}
            <//>
            <${Note} slab>${E('group.note')}<//>
            ${result && html`<${Note} kind="message" error=${!result.ok}>${result.text}<//>`}
          <//>
        <//>
      <//>
    <//>`;
}
