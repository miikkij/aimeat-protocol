/**
 * @file secret-panel.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The parts of an opened secret's panel on the Access page that are about where it may
 *   go: its address, set, changed or removed without the value, and the extensions the person allowed
 *   to send it somewhere, each with Withdraw, beside the questions still waiting for an answer.
 *
 *   An address keeps the secret to one host for every extension the person runs. An approval lets one
 *   extension, installed by one account, send it to one host (services/secret-approvals.ts). A
 *   question waits when an extension's call was refused; its Answer opens the allow page.
 * @structure secretWaitingLine · secretAddress · secretApprovals
 * @usage import { secretWaitingLine, secretAddress, secretApprovals } from './secret-panel.js';
 * @version-history
 *   v1.1.1 — 2026-10-21 — The why reads "It says it needs it to …" with a leading "to" dropped, as
 *     on the allow page.
 *   v1.1.0 — 2026-10-21 — Browser check: the lists stack on a phone; waiting questions and allowed
 *     extensions under a heading each; the buttons at the control size (Action `control`).
 *   v1.0.0 — 2026-10-21 — Initial (secaudit 2026-10, v58 and v59 follow-up).
 */
import { h } from 'preact';
import htm from 'htm';
import { x, dateWord } from './frame.js';
import { List, Row, Name, Desc, When, Doors } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { TextField } from '/components/TextField.js';

const html = htm.bind(h);
const listOf = (row) => (Array.isArray(row.approvals) ? row.approvals : []);
/** An extension's `why` as it reads after "to": the rule of purposeText (services/owner-secrets.ts)
 *  and of the allow page, so the panel, the page and the refusal say it alike. */
const purpose = (why) => String(why).trim().replace(/^to\s+/i, '').replace(/[.\s]+$/, '');

/** "2 questions wait for your answer", for the row's line, or null when none wait. */
export function secretWaitingLine(row) {
  const waiting = listOf(row).filter((a) => !a.approvedAt).length;
  return waiting ? x('secrets.waitingCount', { n: waiting }) : null;
}

/** The address field: save writes it, an empty field removes it. Never touches the value. */
export function secretAddress(ctx, row, busy) {
  const current = Array.isArray(row.hosts) && row.hosts.length ? row.hosts[0] : '';
  const draft = (ctx.hostDraft || '').trim();
  return html`
    <${Label} block>${x('secrets.host')}<//>
    <${Note}>${x(current ? 'secrets.hostNow' : 'secrets.hostNone', { host: current })}<//>
    <${TextField} autoComplete="off" spellCheck=${false} maxLength=${253} ariaLabel=${x('secrets.host')}
      placeholder=${x('secrets.hostPlaceholder')} value=${ctx.hostDraft} onInput=${(v) => ctx.setHostDraft(v)}
      actions=${html`
        <${Action} small control disabled=${busy || draft === current} onClick=${() => ctx.saveSecretHost(row.name, draft)}>${draft ? x('secrets.hostSave') : x('secrets.hostClear')}<//>`} />
    <${Note}>${x('secrets.hostHint')}<//>`;
}

/**
 * The questions that wait and the extensions allowed, under a heading each. The list stacks on a
 * phone, as the secrets list above it does (no keepCols).
 */
export function secretApprovals(ctx, row, busy) {
  const list = listOf(row);
  const waiting = list.filter((a) => !a.approvedAt);
  const allowed = list.filter((a) => a.approvedAt);
  const answerUrl = (a) => `/v1/secret-allow?${new URLSearchParams({ secret: row.name, extension: a.extension, host: a.host }).toString()}`;
  const rows = (items) => html`
    <${List} cols="name-desc-when-doors" dense under>
      ${items.map((a) => html`
        <${Row} key=${a.extension + '|' + a.installer + '|' + a.host}>
          <${Name} meta=${x('secrets.approvalBy', { installer: a.installer })}>${a.extension}<//>
          <${Desc}>${x('secrets.approvalTo', { host: a.host })}${a.why ? html`<br />${x('secrets.approvalWhy', { why: purpose(a.why) })}` : null}<//>
          <${When}>${a.approvedAt ? x('secrets.approvedOn', { date: dateWord(a.approvedAt) }) : x('secrets.waiting')}<//>
          <${Doors}>
            ${a.approvedAt ? null : html`<${Action} small row control href=${answerUrl(a)}>${x('secrets.answer')}<//>`}
            <${Action} small row control tone="danger" disabled=${busy} onClick=${() => ctx.withdrawApproval(row.name, a)}>${a.approvedAt ? x('secrets.withdraw') : x('secrets.dismiss')}<//>
          <//>
        <//>`)}
    <//>`;
  return html`
    ${waiting.length ? html`<${Label} block>${x('secrets.waitingTitle')}<//>${rows(waiting)}` : null}
    ${allowed.length ? html`<${Label} block>${x('secrets.approvalsTitle')}<//>${rows(allowed)}` : null}`;
}
