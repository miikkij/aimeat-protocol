/**
 * @file public/views/profile/receivers/dialogs.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Receivers page's dialogs (design canvas "Vastaanottimet", artboards Create and
 *   Chat): the new-receiver form (name, where it writes as one of three, the shape it checks against,
 *   the verbs and the limits); the decision on a receiver an agent proposed (?approve=<name>); the
 *   key shown once after a create, an approval or a key change, with the curl example, the sentence
 *   for one's own AI and a test that stores nothing (?dry_run=true with the key just shown); and the
 *   new end date. Every part is a library component (Modal, the Field family, Box, Facts, Action);
 *   the file writes no class.
 * @structure renderDialogs · createDialog · targetFields · shapeFields · limitFields · decideDialog ·
 *   keyDialog · keyOnce · dryRunBlock · extendDialog
 * @usage ${renderDialogs(ctx)} after the page
 * @version-history
 *   v1.1.1 — 2026-11-08 — The English sentence for one's AI says API key; it stays English, as the
 *     key.aiHint line tells the reader (secaudit2026nov08b round 15b).
 *   v1.1.0 — 2026-11-08 — The form's "What it takes" choice has the question mark that explains a
 *     data description (concept.data_description).
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { date, dateTime } from '/js/format.js';
import { Modal } from '/components/Modal.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Facts } from '/components/Facts.js';
import { Label, Code } from '/components/Mark.js';
import { Fields, Field } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Choice } from '/components/Choice.js';
import { Check } from '/components/Check.js';
import { Select } from '/components/Select.js';
import { Stack } from '/components/Layout.js';
import {
  x, LIMITS, validName, validKey, targetWords, shapeWords, limitsWords, verbsWords, byWords, curlFor,
} from './frame.js';

const html = htm.bind(h);

export function renderDialogs(ctx) {
  const d = ctx.dialog;
  if (!d) return null;
  if (d.kind === 'create') return createDialog(ctx, d);
  if (d.kind === 'decide') return decideDialog(ctx, d);
  if (d.kind === 'key') return keyDialog(ctx, d);
  if (d.kind === 'extend') return extendDialog(ctx, d);
  return null;
}

/* ── The new-receiver form ──────────────────────────────────────────────────────────────────── */

const inRange = (v, max) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= max; };

/** What is wrong with the form, as a map field → words; empty when it can be sent. */
export function formErrors(f) {
  const e = {};
  if (!validName(f.name)) e.name = x('form.nameBad');
  if (f.kind === 'key' && !validKey(f.key)) e.key = x('form.keyBad');
  if (f.kind === 'prefix' && !validKey(f.prefix.replace(/\.\*?$/, ''))) e.prefix = x('form.prefixBad');
  if (f.kind === 'prefix' && !inRange(f.maxKeys, LIMITS.maxKeys.max)) e.maxKeys = x('form.rangeBad', { max: LIMITS.maxKeys.max });
  if (f.kind === 'space' && !(f.org && f.ws && f.space)) e.space = x('form.spaceBad');
  if (f.shape === 'csm' && !f.csm) e.csm = x('form.csmBad');
  if (!inRange(f.perMinute, LIMITS.perMinute.max)) e.perMinute = x('form.rangeBad', { max: LIMITS.perMinute.max });
  if (!inRange(f.maxKb, LIMITS.maxKb.max)) e.maxKb = x('form.rangeBad', { max: LIMITS.maxKb.max });
  if (!inRange(f.days, LIMITS.expiresDays.max)) e.days = x('form.rangeBad', { max: LIMITS.expiresDays.max });
  return e;
}

/** The request body POST /v1/receivers takes (normalizeReceiverInput in contract.ts). */
export function bodyOf(f) {
  const target = f.kind === 'key' ? { key: f.key }
    : f.kind === 'prefix' ? { prefix: f.prefix.replace(/\.\*?$/, ''), max_keys: Number(f.maxKeys) }
      : { organism_id: f.org, ws: f.ws, space: f.space };
  return {
    name: f.name,
    ...(f.display.trim() ? { display_name: f.display.trim() } : {}),
    target,
    ...(f.shape === 'csm' && f.csm ? { csm: f.csm } : {}),
    verbs: ['write', ...['merge', 'read', 'delete'].filter((v) => f.verbs[v])],
    limits: { per_minute: Number(f.perMinute), max_bytes: Number(f.maxKb) * 1024 },
    expires_days: Number(f.days),
  };
}

function createDialog(ctx, d) {
  const f = d.form;
  const errs = formErrors(f);
  const shown = (k) => (d.tried || f.touched?.[k]) && errs[k] ? { text: errs[k], error: true } : undefined;
  const ok = Object.keys(errs).length === 0;
  const footer = html`
    <${Action} onClick=${() => ctx.closeDialog()}>${x('cancel')}<//>
    <${Loud} control disabled=${ctx.busy} onClick=${() => ctx.submitCreate()}>${x('form.create')}<//>`;
  return html`
    <${Modal} open onClose=${() => ctx.closeDialog()} title=${x('form.title')} size="lg" footer=${footer}>
      <${Stack} gap="large">
        ${ctx.mode === 'operator' ? html`<${Note} kind="aside" size="small" tone="waiting">${x('form.operatorNote')}<//>` : null}
        <${Fields} cols=${2}>
          <${TextField} label=${x('form.display')} value=${f.display} maxLength=${120} placeholder=${x('form.displayPlaceholder')}
            onInput=${(v) => ctx.setForm({ display: v })} autoFocus />
          <${TextField} label=${x('form.name')} code value=${f.name} maxLength=${40}
            hint=${x('form.nameHint', { who: f.name ? `receiver:${ctx.owner}/${f.name}` : `receiver:${ctx.owner}/…` })}
            message=${shown('name')} invalid=${!!shown('name')}
            onInput=${(v) => ctx.setForm({ name: v, nameTouched: true })} onBlur=${() => ctx.touch('name')} />
        <//>
        ${targetFields(ctx, f, shown)}
        ${shapeFields(ctx, f, shown)}
        ${limitFields(ctx, f, shown)}
        ${d.error ? html`<${Note} kind="message" error>${d.error}<//>` : null}
        ${d.tried && !ok ? html`<${Note} kind="message" error>${x('form.fixFirst')}<//>` : null}
      <//>
    <//>`;
}

function targetFields(ctx, f, shown) {
  const opts = ctx.pickers;
  return html`
    <${Stack}>
      <${Choice} boxed dot cols=${3} name="rc-target" label=${x('form.targetLabel')} value=${f.kind}
        onChange=${(v) => ctx.setForm({ kind: v })}
        options=${[
          { value: 'key', label: x('form.kindKey'), hint: x('form.kindKeyHint') },
          { value: 'prefix', label: x('form.kindPrefix'), hint: x('form.kindPrefixHint') },
          { value: 'space', label: x('form.kindSpace'), hint: x('form.kindSpaceHint') },
        ]} />
      ${f.kind === 'key' ? html`<${Fields}>
        <${TextField} label=${x('form.key')} code value=${f.key} placeholder="living.solar.in.spot" hint=${x('form.keyHint')}
          message=${shown('key')} invalid=${!!shown('key')} onInput=${(v) => ctx.setForm({ key: v })} onBlur=${() => ctx.touch('key')} />
      <//>` : null}
      ${f.kind === 'prefix' ? html`<${Fields} cols=${2}>
        <${TextField} label=${x('form.prefix')} code value=${f.prefix} placeholder="ruuvit" hint=${x('form.prefixHint', { prefix: f.prefix || 'ruuvit' })}
          message=${shown('prefix')} invalid=${!!shown('prefix')} onInput=${(v) => ctx.setForm({ prefix: v })} onBlur=${() => ctx.touch('prefix')} />
        <${TextField} type="number" size="short" min=${1} max=${LIMITS.maxKeys.max} label=${x('form.maxKeys')} help="receivers.maxKeys"
          value=${f.maxKeys} message=${shown('maxKeys')} invalid=${!!shown('maxKeys')} onInput=${(v) => ctx.setForm({ maxKeys: v })} onBlur=${() => ctx.touch('maxKeys')} />
      <//>` : null}
      ${f.kind === 'space' ? html`<${Fields} cols=${3}>
        <${Select} label=${x('form.organism')} value=${f.org} placeholder=${opts.orgs === null ? t('common.loading') : x('form.choose')}
          options=${(opts.orgs || []).map((o) => [o.id, o.name || o.id])} onChange=${(v) => ctx.pickOrg(v)} />
        <${Select} label=${x('form.workspace')} value=${f.ws} disabled=${!f.org} placeholder=${x('form.choose')}
          options=${(opts.workspaces || []).map((w) => [w.id, w.name || w.id])} onChange=${(v) => ctx.pickWs(v)} />
        <${Select} label=${x('form.space')} value=${f.space} disabled=${!f.ws} placeholder=${x('form.choose')}
          message=${shown('space')} invalid=${!!shown('space')}
          options=${(opts.spaces || []).map((s) => [s.id, s.label])} onChange=${(v) => ctx.setForm({ space: v })} />
      <//>
      ${opts.orgs && !opts.orgs.length ? html`<${Note} kind="quiet">${x('form.noOrganisms')}<//>` : null}
      ${f.ws && opts.spaces && !opts.spaces.length ? html`<${Note} kind="quiet">${x('form.noRowSpaces')}<//>` : null}` : null}
    <//>`;
}

function shapeFields(ctx, f, shown) {
  const csms = ctx.csms;
  return html`
    <${Stack}>
      <${Choice} boxed dot cols=${2} name="rc-shape" label=${x('form.shapeLabel')} help="concept.data_description" value=${f.shape}
        onChange=${(v) => ctx.setForm({ shape: v })}
        options=${[
          { value: 'csm', label: x('form.shapeCsm'), hint: x('form.shapeCsmHint') },
          { value: 'any', label: x('form.shapeAny'), hint: x('form.shapeAnyHint') },
        ]} />
      ${f.shape === 'csm' ? html`<${Fields}>
        ${csms && csms.length ? html`<${Select} label=${x('form.csm')} value=${f.csm} placeholder=${x('form.choose')}
          message=${shown('csm')} invalid=${!!shown('csm')}
          options=${csms.map((c) => [c.name, x('form.csmOption', { name: c.name, v: c.version || 1 })])}
          onChange=${(v) => ctx.setForm({ csm: v })} />`
          : html`<${Note} kind="quiet">${csms === null ? t('common.loading') : x('form.noCsms')}<//>`}
      <//>` : null}
    <//>`;
}

function limitFields(ctx, f, shown) {
  const verb = (v) => html`<${Check} inline checked=${!!f.verbs[v]} onChange=${(on) => ctx.setForm({ verbs: { ...f.verbs, [v]: on } })}>${x('verb.' + v)}<//>`;
  return html`
    <${Stack}>
      <${Field} group label=${x('form.verbsLabel')} hint=${x('form.verbsHint')}>
        <${Check} inline checked disabled>${x('verb.write')}<//>
        ${verb('merge')}${verb('read')}${verb('delete')}
      <//>
      <${Fields} cols=${3}>
        <${TextField} type="number" size="short" min=${1} max=${LIMITS.perMinute.max} label=${x('form.perMinute')} help="receivers.perMinute"
          value=${f.perMinute} message=${shown('perMinute')} invalid=${!!shown('perMinute')} onInput=${(v) => ctx.setForm({ perMinute: v })} onBlur=${() => ctx.touch('perMinute')} />
        <${TextField} type="number" size="short" min=${1} max=${LIMITS.maxKb.max} label=${x('form.maxKb')} help="receivers.maxSize"
          value=${f.maxKb} message=${shown('maxKb')} invalid=${!!shown('maxKb')} onInput=${(v) => ctx.setForm({ maxKb: v })} onBlur=${() => ctx.touch('maxKb')} />
        <${TextField} type="number" size="short" min=${1} max=${LIMITS.expiresDays.max} label=${x('form.days')} help="receivers.validDays"
          value=${f.days} message=${shown('days')} invalid=${!!shown('days')} onInput=${(v) => ctx.setForm({ days: v })} onBlur=${() => ctx.touch('days')} />
      <//>
    <//>`;
}

/* ── The decision on a proposal ─────────────────────────────────────────────────────────────── */

function decideDialog(ctx, d) {
  const r = d.receiver;
  const footer = r ? html`
    <${Action} tone="danger" disabled=${ctx.busy} onClick=${() => ctx.decide(r, 'refuse')}>${x('refuse')}<//>
    <${Loud} control disabled=${ctx.busy} onClick=${() => ctx.decide(r, 'approve')}>${x('approve')}<//>` : null;
  return html`
    <${Modal} open onClose=${() => ctx.closeDialog()} title=${x('decideTitle')} size="md" footer=${footer}>
      ${!r ? html`<${Note} kind="loading" />` : html`
        <${Stack} gap="medium">
          <${Note} kind="lead"><b>${x('decideLead', { who: byWords(r.created_by, ctx.ownerGhii), name: r.display_name || r.name })}</b> ${x('decideBody')}<//>
          <${Facts} rows=${[
            { key: 'target', k: x('f.target'), v: targetWords(r.target) },
            { key: 'shape', k: x('f.shape'), v: shapeWords(r), warn: !r.schema },
            { key: 'verbs', k: x('f.verbs'), v: verbsWords(r.verbs), mono: true },
            { key: 'limits', k: x('f.limits'), v: limitsWords(r.limits) },
            { key: 'until', k: x('f.until'), v: date(r.expires_at) },
            { key: 'by', k: x('f.proposedBy'), v: byWords(r.created_by, ctx.ownerGhii), sub: dateTime(r.created_at) },
          ]} />
          <${Note} kind="hint">${x('decideKeyNote')}<//>
          ${ctx.mode === 'operator' ? html`<${Note} kind="aside" size="small" tone="waiting">${x('form.operatorNote')}<//>` : null}
        <//>`}
    <//>`;
}

/* ── The key, shown once ────────────────────────────────────────────────────────────────────── */

function keyDialog(ctx, d) {
  const footer = html`<${Loud} control onClick=${() => ctx.closeDialog()}>${x('key.done')}<//>`;
  return html`
    <${Modal} open onClose=${() => ctx.closeDialog()} title=${d.rotated ? x('key.titleRotated') : x('key.title')} size="lg" footer=${footer}>
      ${keyOnce(ctx, d)}
    <//>`;
}

/** The key box, the curl, the sentence for an AI and the test, for the receiver in `d`. */
function keyOnce(ctx, d) {
  const r = d.receiver;
  const curl = curlFor(r);
  const forAi = `${d.say || ''} The API key is in the secret AIMEAT_RECEIVER_KEY.`.trim();
  return html`
    <${Stack} gap="large">
      <${Box} tone="raised" name=${x('key.onceTitle')}>
        <${Note} kind="lead">${x('key.onceBody')}<//>
        <${Code} block>${d.key}<//>
        <${Actions}><${Action} small copy=${d.key} copiedLabel=${x('copied')}>${x('key.copy')}<//><//>
        ${d.rotated ? html`<${Note} kind="hint">${r.previous_key_until
          ? x('key.overlap', { time: dateTime(r.previous_key_until) }) : x('key.noOverlap')}<//>` : null}
        ${r.state === 'awaiting_operator' ? html`<${Note} kind="aside" size="small" tone="waiting">${x('waitingOperator')}<//>` : null}
      <//>
      <${Stack}>
        <${Label} block>${x('key.tryLabel')}<//>
        <${Code} block scroll>${curl}<//>
        <${Actions}><${Action} small copy=${curl} copiedLabel=${x('copied')}>${x('copyCurl')}<//><//>
      <//>
      <${Box} name=${x('key.aiLabel')}>
        <${Note} kind="hint">${x('key.aiHint')}<//>
        <${Code} block>${forAi}<//>
        <${Actions}><${Action} small copy=${forAi} copiedLabel=${x('copied')}>${x('ai.copyShort')}<//><//>
      <//>
      ${dryRunBlock(ctx, d)}
    <//>`;
}

function dryRunBlock(ctx, d) {
  const res = d.test;
  const fields = res?.fields || [];
  return html`
    <${Box} tone="field" name=${x('dry.title')}>
      <${Note} kind="hint">${x('dry.body')}<//>
      <${TextArea} code rows=${3} label=${x('dry.message')} value=${d.testBody} onInput=${(v) => ctx.setTestBody(v)} />
      <${Actions}>
        <${Action} small disabled=${!!d.testing || d.receiver.state !== 'active'} onClick=${() => ctx.runDryRun()}>${x('dry.run')}<//>
      <//>
      ${d.receiver.state !== 'active' ? html`<${Note} kind="quiet">${x('dry.notActive')}<//>` : null}
      ${res ? html`<${Note} kind="message" error=${!res.ok}>${res.ok ? x('dry.ok') : x('dry.refused', { status: res.status, words: res.words })}<//>` : null}
      ${fields.length ? html`<${Facts} rows=${fields.map((fl, i) => ({ key: String(i), k: fl.path || '/', v: fl.message, mono: true }))} />` : null}
    <//>`;
}

/* ── A new end date ─────────────────────────────────────────────────────────────────────────── */

function extendDialog(ctx, d) {
  const ok = inRange(d.days, LIMITS.expiresDays.max);
  const until = ok ? date(new Date(Date.now() + Number(d.days) * 86_400_000).toISOString()) : '';
  const footer = html`
    <${Action} onClick=${() => ctx.closeDialog()}>${x('cancel')}<//>
    <${Loud} control disabled=${!ok || ctx.busy} onClick=${() => ctx.submitExtend()}>${x('extendSave')}<//>`;
  return html`
    <${Modal} open onClose=${() => ctx.closeDialog()} title=${x('extendTitle')} size="sm" footer=${footer}>
      <${Stack} gap="medium">
        <${Note} kind="lead">${x('extendBody', { date: date(d.receiver.expires_at) })}<//>
        <${Fields}>
          <${TextField} type="number" size="short" min=${1} max=${LIMITS.expiresDays.max} label=${x('form.days')} help="receivers.validDays"
            value=${d.days} invalid=${!ok} hint=${ok ? x('extendUntil', { date: until }) : x('form.rangeBad', { max: LIMITS.expiresDays.max })}
            onInput=${(v) => ctx.setDialog({ ...d, days: v })} onEnter=${() => ok && ctx.submitExtend()} />
        <//>
      <//>
    <//>`;
}
