/**
 * @file public/views/profile/vault/dialogs.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Vault page's dialogs (design canvas "Holvi"): Share a secret (its name, the content in
 *   one of three formats, who may pick it up, how long it lasts and how it is protected), Ask for a
 *   secret (a request: a note for the person asked, who is asked, the same terms, and how many days
 *   the request stays open), and the dialog that shows a new share's pickup code and link, or a
 *   request's deposit link, once. The maker sets every term; the person who fills a request sets none
 *   (services/secret-shares/rules.ts). Every part is a library component; the file writes no class.
 * @structure renderDialogs · emptyForm · formErrors · bodyOf · shareDialog · askDialog · peopleField ·
 *   termsFields · protectionField · onceDialog
 * @usage ${renderDialogs(ctx)} after the page
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import { h } from 'preact';
import htm from 'htm';
import { Modal } from '/components/Modal.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Mark, Marks, Label, Code } from '/components/Mark.js';
import { Fields, Field } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Choice } from '/components/Choice.js';
import { Check } from '/components/Check.js';
import { Select } from '/components/Select.js';
import { Stack } from '/components/Layout.js';
import { x, LIMITS, validName, accountOf } from './frame.js';
import { emptyContent, contentFields, contentReady } from './content.js';

const html = htm.bind(h);
const DAY = 86_400_000;

export function renderDialogs(ctx) {
  const d = ctx.dialog;
  if (!d) return null;
  if (d.kind === 'share') return shareDialog(ctx, d);
  if (d.kind === 'ask') return askDialog(ctx, d);
  if (d.kind === 'once') return onceDialog(ctx, d);
  return null;
}

/** A form before anything is typed. A request goes to its maker and the maker's agents by default. */
export function emptyForm(kind, ownerGhii) {
  return {
    kind, name: '', note: '', content: emptyContent(),
    people: kind === 'ask' && ownerGhii ? [ownerGhii] : [], personDraft: '',
    depositors: [], depositorDraft: '',
    agents: kind === 'ask', organism: false, organismId: '', code: false, codeLogin: false,
    retention: 'once', maxPickups: '3', until: '', protection: 'sealed', days: String(LIMITS.requestDaysDefault),
  };
}

const inRange = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi; };
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
/** The end of the chosen day in the reader's own time, as the server's ISO 8601. */
const untilIso = (day) => (day ? new Date(`${day}T23:59:59`).toISOString() : '');

/** What is wrong with the form, as a map field → words; empty when it can be sent. */
export function formErrors(f) {
  const e = {};
  if (!validName(f.name)) e.name = x('form.nameBad');
  if (f.kind === 'share' && !contentReady(f.content)) e.content = x('form.contentBad');
  if (!f.people.length && !f.organism && !f.code) e.who = x('form.whoBad');
  if (f.organism && !f.organismId) e.organism = x('form.organismBad');
  if (f.retention === 'count' && !inRange(f.maxPickups, 1, LIMITS.maxPickups)) e.maxPickups = x('form.rangeBad', { min: 1, max: LIMITS.maxPickups });
  if (f.retention === 'until') {
    const at = Date.parse(untilIso(f.until));
    if (!Number.isFinite(at) || at <= Date.now() || at > Date.now() + LIMITS.untilDays * DAY) e.until = x('form.untilBad', { days: LIMITS.untilDays });
  }
  if (f.kind === 'ask') {
    if (!inRange(f.days, 1, LIMITS.requestDays)) e.days = x('form.rangeBad', { min: 1, max: LIMITS.requestDays });
    if (f.note.length > LIMITS.noteMax) e.note = x('form.noteBad', { max: LIMITS.noteMax });
  }
  return e;
}

/** The terms POST /v1/secret-shares takes (normalizeTerms in rules.ts); content is added by the tab. */
export function bodyOf(f) {
  const e2e = f.protection === 'e2e';
  return {
    name: f.name.trim(),
    protection: f.protection,
    recipients: {
      people: f.people, agents: !e2e && f.agents, organism: !e2e && f.organism,
      code: f.code && !(e2e && f.kind === 'ask'), code_login: f.code && f.codeLogin,
    },
    ...(f.organism && f.organismId && !e2e ? { organism: f.organismId } : {}),
    retention: f.retention,
    ...(f.retention === 'count' ? { max_pickups: Number(f.maxPickups) } : {}),
    ...(f.retention === 'until' ? { expires_at: untilIso(f.until) } : {}),
    ...(f.kind === 'ask' ? { kind: 'request', note: f.note.trim(), depositors: f.depositors, request_days: Number(f.days) } : {}),
  };
}

/* ── Share a secret ───────────────────────────────────────────────────────────────────────────── */

function shareDialog(ctx, d) {
  const f = d.form;
  const errs = formErrors(f);
  const shown = (k) => (d.tried && errs[k] ? { text: errs[k], error: true } : undefined);
  const footer = html`
    <${Action} onClick=${() => ctx.closeDialog()}>${x('cancel')}<//>
    <${Loud} control disabled=${ctx.busy} onClick=${() => ctx.submit()}>${ctx.busy ? x('form.working') : x('form.share')}<//>`;
  return html`
    <${Modal} open onClose=${() => ctx.closeDialog()} title=${x('form.shareTitle')} size="lg" footer=${footer}>
      <${Stack} gap="large">
        <${Fields}>
          <${TextField} label=${x('form.name')} hint=${x('form.nameHint')} value=${f.name} maxLength=${LIMITS.nameMax} code autoFocus
            placeholder="ELEVENLABS_API_KEY" message=${shown('name')} invalid=${!!shown('name')} onInput=${(v) => ctx.setForm({ name: v })} />
        <//>
        ${contentFields(f.content, (patch) => ctx.setForm({ content: { ...f.content, ...patch } }), { prefix: 'vs-share' })}
        ${shown('content') ? html`<${Note} kind="message" error>${errs.content}<//>` : null}
        ${termsFields(ctx, d, errs)}
        ${d.error ? html`<${Note} kind="message" error>${d.error}<//>` : null}
        ${d.tried && Object.keys(errs).length ? html`<${Note} kind="message" error>${x('form.fixFirst')}<//>` : null}
      <//>
    <//>`;
}

/* ── Ask for a secret ─────────────────────────────────────────────────────────────────────────── */

function askDialog(ctx, d) {
  const f = d.form;
  const errs = formErrors(f);
  const shown = (k) => (d.tried && errs[k] ? { text: errs[k], error: true } : undefined);
  const footer = html`
    <${Action} onClick=${() => ctx.closeDialog()}>${x('cancel')}<//>
    <${Loud} control disabled=${ctx.busy} onClick=${() => ctx.submit()}>${ctx.busy ? x('form.working') : x('form.ask')}<//>`;
  return html`
    <${Modal} open onClose=${() => ctx.closeDialog()} title=${x('form.askTitle')} size="lg" footer=${footer}>
      <${Stack} gap="large">
        <${Note} kind="lead">${x('form.askLead')}<//>
        <${Fields}>
          <${TextField} label=${x('form.name')} hint=${x('form.nameHintAsk')} value=${f.name} maxLength=${LIMITS.nameMax} code autoFocus
            placeholder="ELEVENLABS_API_KEY" message=${shown('name')} invalid=${!!shown('name')} onInput=${(v) => ctx.setForm({ name: v })} />
          <${TextArea} rows=${3} label=${x('form.note')} hint=${x('form.noteHint')} value=${f.note} maxLength=${LIMITS.noteMax}
            placeholder=${x('form.notePlaceholder')} message=${shown('note')} invalid=${!!shown('note')} onInput=${(v) => ctx.setForm({ note: v })} />
        <//>
        ${peopleField(ctx, { label: x('form.depositors'), hint: x('form.depositorsHint'), list: f.depositors, draft: f.depositorDraft, field: 'depositors', draftField: 'depositorDraft' })}
        ${termsFields(ctx, d, errs)}
        <${Fields}>
          <${TextField} type="number" size="short" min=${1} max=${LIMITS.requestDays} label=${x('form.days')} help="secretShares.requestDays"
            hint=${x('form.daysHint')} value=${f.days} message=${shown('days')} invalid=${!!shown('days')} onInput=${(v) => ctx.setForm({ days: v })} />
        <//>
        ${d.error ? html`<${Note} kind="message" error>${d.error}<//>` : null}
        ${d.tried && Object.keys(errs).length ? html`<${Note} kind="message" error>${x('form.fixFirst')}<//>` : null}
      <//>
    <//>`;
}

/* ── The parts both forms share ───────────────────────────────────────────────────────────────── */

/** Account names as removable tags and a field that adds one (Enter or Add). */
function peopleField(ctx, { label, hint, list, draft, field, draftField }) {
  const add = () => ctx.addPerson(field, draftField);
  return html`
    <${Field} group label=${label} hint=${hint}>
      ${list.length ? html`<${Marks}>${list.map((p) => html`
        <${Mark} key=${p} onRemove=${() => ctx.removePerson(field, p)} removeLabel=${x('form.removePerson', { name: accountOf(p, ctx.nodeId) })}>${accountOf(p, ctx.nodeId)}<//>`)}<//>` : null}
      <${TextField} ariaLabel=${label} value=${draft} placeholder=${x('form.personPlaceholder')} autoComplete="off" spellCheck=${false}
        onInput=${(v) => ctx.setForm({ [draftField]: v })} onEnter=${add}
        actions=${html`<${Action} small control disabled=${!draft.trim()} onClick=${add}>${x('form.addPerson')}<//>`} />
    <//>`;
}

/** Who may pick it up, how long it lasts, and its protection. */
function termsFields(ctx, d, errs) {
  const f = d.form;
  const shown = (k) => (d.tried && errs[k] ? { text: errs[k], error: true } : undefined);
  const e2e = f.protection === 'e2e';
  const orgs = ctx.orgs || [];
  const today = Date.now();
  return html`
    <${Stack} gap="medium">
      <${Label} block>${x('form.whoLabel')}<//>
      ${peopleField(ctx, { label: x('form.people'), hint: x('form.peopleHint'), list: f.people, draft: f.personDraft, field: 'people', draftField: 'personDraft' })}
      <${Check} checked=${f.agents && !e2e} disabled=${e2e} onChange=${(on) => ctx.setForm({ agents: on })}
        hint=${e2e ? x('form.notWithE2e') : x('form.agentsHint')}>${x('form.agents')}<//>
      <${Check} checked=${f.organism && !e2e} disabled=${e2e} onChange=${(on) => ctx.setForm({ organism: on })}
        hint=${e2e ? x('form.notWithE2e') : x('form.organismHint')}>${x('form.organism')}<//>
      ${f.organism && !e2e ? html`<${Fields}>
        <${Select} label=${x('form.organismPick')} value=${f.organismId} placeholder=${ctx.orgs === null ? x('loading') : x('form.choose')}
          message=${shown('organism')} invalid=${!!shown('organism')}
          options=${orgs.map((o) => [o.id, o.name || o.id])} onChange=${(v) => ctx.setForm({ organismId: v })} />
      <//>
      ${ctx.orgs && !orgs.length ? html`<${Note} kind="quiet">${x('form.noOrganisms')}<//>` : null}` : null}
      <${Check} checked=${f.code && !(e2e && f.kind === 'ask')} disabled=${e2e && f.kind === 'ask'} onChange=${(on) => ctx.setForm({ code: on })}
        hint=${e2e && f.kind === 'ask' ? x('form.codeNotOnE2eAsk') : x('form.codeHint')}>${x('form.code')}<//>
      ${f.code && !(e2e && f.kind === 'ask') ? html`
        <${Choice} boxed dot cols=${2} name=${'vs-code-' + f.kind} label=${x('form.codeHowLabel')} value=${f.codeLogin ? 'login' : 'alone'}
          onChange=${(v) => ctx.setForm({ codeLogin: v === 'login' })}
          options=${[
            { value: 'alone', label: x('form.codeAlone'), hint: x('form.codeAloneHint') },
            { value: 'login', label: x('form.codeLogin'), hint: x('form.codeLoginHint') },
          ]} />` : null}
      ${shown('who') ? html`<${Note} kind="message" error>${errs.who}<//>` : null}

      <${Choice} boxed dot cols=${4} name=${'vs-retention-' + f.kind} label=${x('form.howLongLabel')} help="secretShares.retention" value=${f.retention}
        onChange=${(v) => ctx.setForm({ retention: v })}
        options=${[
          { value: 'once', label: x('retention.once') },
          { value: 'count', label: x('retention.count') },
          { value: 'until', label: x('retention.until') },
          { value: 'keep', label: x('retention.keep') },
        ]} />
      ${f.retention === 'count' ? html`<${Fields}>
        <${TextField} type="number" size="short" min=${1} max=${LIMITS.maxPickups} label=${x('form.maxPickups')}
          value=${f.maxPickups} message=${shown('maxPickups')} invalid=${!!shown('maxPickups')} onInput=${(v) => ctx.setForm({ maxPickups: v })} />
      <//>` : null}
      ${f.retention === 'until' ? html`<${Fields}>
        <${TextField} type="date" size="short" min=${isoDay(today + DAY)} max=${isoDay(today + LIMITS.untilDays * DAY)} label=${x('form.until')}
          value=${f.until} message=${shown('until')} invalid=${!!shown('until')} onInput=${(v) => ctx.setForm({ until: v })} />
      <//>` : null}

      ${protectionField(ctx, f)}
    <//>`;
}

/** Open, sealed or end-to-end; end-to-end carries the warning in red. */
function protectionField(ctx, f) {
  return html`
    <${Stack}>
      <${Choice} boxed dot cols=${3} name=${'vs-protection-' + f.kind} label=${x('form.protectionLabel')} help="secretShares.protection" value=${f.protection}
        onChange=${(v) => ctx.setForm({ protection: v })}
        options=${[
          { value: 'open', label: x('protection.open'), hint: x('protection.openHint') },
          { value: 'sealed', label: x('protection.sealed'), hint: x('protection.sealedHint') },
          { value: 'e2e', label: x('protection.e2eChoice'), hint: x('protection.e2eHint') },
        ]} />
      ${f.protection === 'e2e' ? html`<${Note} kind="aside" tone="irreversible"><b>${x('protection.e2eWarnTitle')}</b> ${x('protection.e2eWarn')}<//>` : null}
    <//>`;
}

/* ── The code and the link, shown once ────────────────────────────────────────────────────────── */

function onceDialog(ctx, d) {
  const one = (label, value, copyLabel) => html`
    <${Stack} gap="small">
      <${Label} block>${label}<//>
      <${Code} block>${value}<//>
      <${Actions}><${Action} small copy=${value} copiedLabel=${x('copied')}>${copyLabel}<//><//>
    <//>`;
  const footer = html`<${Loud} control onClick=${() => ctx.closeDialog()}>${x('once.done')}<//>`;
  return html`
    <${Modal} open onClose=${() => ctx.closeDialog()} title=${d.request ? x('once.titleAsk') : x('once.titleShare')} size="md" footer=${footer}>
      <${Box} tone="raised">
        <${Stack} gap="medium">
          <${Note} kind="lead">${d.request ? x('once.leadAsk', { name: d.name }) : x('once.leadShare', { name: d.name })}<//>
          ${d.code ? one(x('once.code'), d.code, x('once.copyCode')) : null}
          ${d.depositUrl ? one(x('once.depositLink'), d.depositUrl, x('once.copyLink')) : null}
          ${!d.request && d.pickupUrl ? one(x('once.pickupLink'), d.pickupUrl, x('once.copyLink')) : null}
          <${Note} kind="hint">${d.code || d.depositUrl ? x('once.outside') : x('once.notified')}<//>
        <//>
      <//>
    <//>`;
}
