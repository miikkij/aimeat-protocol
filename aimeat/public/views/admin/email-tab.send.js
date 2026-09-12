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
 *
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the Email page in the poster face.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { time as fmtTime } from '/js/format.js';
import { num } from './shared.js';
import { sendTestEmail, sendGroupEmail } from '/js/services/admin.js';

const E = (key, params) => t('admin.email.' + key, params);

/** The three message types a test can be sent as; the node has a template for each. */
const TEST_TYPES = ['notification', 'verification', 'magic_link'];

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
    <section class="og-sec">
      <div class="og-sec-h"><h2>${E('test.title')}<small>02</small></h2></div>
      <p class="adm-em-lead">${E('test.lead')}</p>
      <div class="adm-em-two">
        <div>
          <div class="adm-em-lbl">${E('test.to')}</div>
          <div class="adm-em-fld">
            <input type="email" value=${to} placeholder=${E('test.toPlaceholder')}
              onInput=${e => setTo(e.target.value)} />
          </div>
          <div class="adm-em-lbl">${E('test.type')}</div>
          <div class="adm-em-pick">
            ${TEST_TYPES.map(id => html`
              <button type="button" class=${type === id ? 'on' : ''} onClick=${() => setType(id)}>
                ${E('kind.' + id)}
              </button>`)}
          </div>
          <div class="adm-em-act">
            <button class="adm-btn" onClick=${send} disabled=${sending || !to}>
              ${sending ? E('test.sending') : E('test.send')}
            </button>
            <p>${E('test.note')}</p>
          </div>
        </div>
        <div>
          <div class="adm-em-lbl">${E('test.lastTitle')}</div>
          ${result
    ? html`<div class="adm-em-box">
            <div class="adm-em-box-t"><span>${result.at}</span><span>${result.ok ? '250 OK' : E('test.failed')}</span></div>
            <div class="adm-em-box-row">${result.ok ? E('test.accepted') : E('test.notAccepted')}<span>${E('test.byServer')}</span></div>
            <div class="adm-em-box-row">${E('test.took')}<span>${E('test.seconds', { n: result.seconds ?? 0 })}</span></div>
            <div class="adm-em-box-row">${E('test.typeRow')}<span>${result.type}</span></div>
          </div>
          <p class="adm-em-hint">${result.ok ? E('test.hintOk') : E('test.hintBad')}</p>`
    : html`<div class="adm-em-box"><div class="adm-em-box-row">${E('test.none')}<span>—</span></div></div>
          <p class="adm-em-hint">${E('test.hintIdle')}</p>`}
        </div>
      </div>
    </section>`;
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
    <section class="og-sec">
      <div class="og-sec-h"><h2>${E('group.title')}<small>04</small></h2></div>
      <p class="adm-em-lead">${E('group.lead')}</p>
      <div class="adm-em-two">
        <div>
          <div class="adm-em-lbl">${E('group.group')}</div>
          <div class="adm-em-pick">
            <button type="button" class=${group === 'operators' ? 'on' : ''} onClick=${() => setGroup('operators')}>${E('group.operators')}</button>
            <button type="button" class=${group === 'all' ? 'on' : ''} onClick=${() => setGroup('all')}>${E('group.everyone')}</button>
          </div>
          <div class="adm-em-lbl">${E('group.subject')}</div>
          <div class="adm-em-fld">
            <input type="text" value=${subject} placeholder=${E('group.subjectPlaceholder')}
              onInput=${e => setSubject(e.target.value)} />
          </div>
          <div class="adm-em-lbl">${E('group.body')}</div>
          <div class="adm-em-fld">
            <textarea rows="4" value=${body} placeholder=${E('group.bodyPlaceholder')}
              onInput=${e => setBody(e.target.value)}></textarea>
          </div>
          <div class="adm-em-act">
            <button class="adm-btn" onClick=${send} disabled=${sending || !subject || !body || !reach}>
              ${sending ? E('group.sending') : reach ? E('group.send', { n: num(reach) }) : E('group.nobody')}
            </button>
            <p>${E('group.note')}</p>
            ${result && html`<span class="adm-em-said ${result.ok ? 'is-ok' : 'is-bad'}">${result.text}</span>`}
          </div>
        </div>
        <div>
          <div class="adm-em-lbl">${E('group.whoTitle')}</div>
          <div class="adm-em-box">
            <div class="adm-em-box-row">${E('group.operators')}<span>${E('group.ofN', { n: num(r.operators_with_address ?? 0), total: num(r.operators ?? 0) })}</span></div>
            <div class="adm-em-box-row">${E('group.everyone')}<span>${E('group.ofN', { n: num(r.with_address ?? 0), total: num(r.accounts ?? 0) })}</span></div>
          </div>
          <p class="adm-em-hint">${E('group.whoHint')}</p>
        </div>
      </div>
    </section>`;
}
