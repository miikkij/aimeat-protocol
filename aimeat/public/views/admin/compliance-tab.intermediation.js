/**
 * @file compliance-tab.intermediation.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 12 of the admin Compliance page, data intermediation (design canvas "Data
 *   ulos", board Admin-Compliance; plan doc-mvwxcas3dom3, D7): whether this installation passes data
 *   on behalf of others under the Data Governance Act (2022/868), what the node found, and which
 *   Article 12 conditions it has evidence for. The facts are `data_intermediation` of GET
 *   /v1/admin/compliance/report (services/data-intermediation/report.ts), the same answer
 *   aimeat_compliance_report gives an AI.
 *
 *   In the board's order: the mode in words with the raw setting and the way to change it, the four
 *   figures, the proposals (each finding the node matched, in the page's language from its `code`,
 *   with its regulation references and Accept / Not applicable), the Article 12 table, the
 *   notification record with its form, and the note that this is a reading, not a legal opinion.
 *
 *   A DECISION IS A REVIEW ITEM. Accept and Not applicable write `{ id: <finding id>, type: 'review',
 *   decision }` into the compliance document `intermediation` (GET and PUT
 *   /v1/compliance/docs/intermediation, the document aimeat_compliance_register_write writes), and the
 *   notification form writes its `type: 'notification'` item the same way; the report is read again
 *   afterwards. A sentence the page has no words for falls back to the node's English.
 *
 *   IntermediationPrint is the same facts as document text for the printout (compliance-tab.print.js).
 *   Made of the component kit: it passes data and never a class.
 * @structure figuresOf · findingText · art12Text · stateMark · writeItem · NotificationForm ·
 *   IntermediationSection (default) · IntermediationPrint
 * @usage html`<${IntermediationSection} di=${report.data_intermediation} switchPage=${switchPage} onChanged=${reload} onMessage=${msg} />`
 * @version-history
 *   v1.0.1 — 2026-11-01 — The three parts open with SubHeading rule (the board's coral labels), and the
 *     notification record stands in a Box with its door (lead's browser review).
 *   v1.0.0 — 2026-11-01 — Initial (WP9b, board Admin-Compliance; plan doc-mvwxcas3dom3, D7).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t, tOr } from '/js/i18n.js';
import { apiGet, apiPut } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { date as fmtDate } from '/js/format.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row, Name, Desc, Cell, Doors } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Mark, Marks, Code } from '/components/Mark.js';
import { Facts } from '/components/Facts.js';
import { Modal } from '/components/Modal.js';
import { Fields } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Row as Line } from '/components/Layout.js';
import { SubHeading } from '/components/SubHeading.js';
import { Box } from '/components/Box.js';
import { PrintTable, PrintList } from '/components/PrintPage.js';

const html = htm.bind(h);
/** The section's words: admin.compliance.di.<key>. */
const D = (key, vars) => t('admin.compliance.di.' + key, vars);
const DOr = (key, fallback, vars) => tOr('admin.compliance.di.' + key, fallback, vars);
const DOC = '/v1/compliance/docs/intermediation';
const day = (iso) => (iso ? fmtDate(iso) : D('notYet'));

/** The four figures of the board: data offerings, outside buyers, open organisms, open apps that sell. */
export function figuresOf(di) {
  const fs = di?.findings || [];
  const count = (id) => fs.find((f) => f.id === id)?.count ?? 0;
  const orgs = fs.filter((f) => f.kind === 'open_organism_with_data' && f.count > 0);
  return {
    offerings: count('data_offering_public'),
    buyers: count('contract_outside_buyer'),
    organisms: orgs.length,
    organismPackages: orgs.reduce((n, f) => n + f.count, 0),
    apps: count('app_open_registration_commerce'),
  };
}

/** The names a finding's sentence carries: its count, and the organism or the account it is about. */
function varsOf(f) {
  const first = (f.items || [])[0] || {};
  return { n: String(f.count ?? 0), name: first.organism || '', owner: f.owner || first.owner || '' };
}

/** A finding as the page says it: the bold line and why it is a finding; the node's English otherwise. */
export function findingText(f, mode) {
  const v = varsOf(f);
  const why = f.code === 'di-notification-missing' ? (mode === 'owners' ? 'whyOwners' : 'whyNode') : 'why';
  return {
    title: DOr(`finding.${f.code}.title`, f.reason, v),
    why: tOr(`admin.compliance.di.finding.${f.code}.${why}`, '', v),
    proposal: f.proposal ? DOr(`proposal.${f.proposal.action}`, f.proposal.text, v) : '',
  };
}

/** One Article 12 row's evidence as a sentence: the row's own facts, in the page's language. */
export function art12Text(row) {
  const e = row.evidence || {};
  const p = row.point;
  let key = `art12.${p}.text`;
  const vars = {};
  if (p === 'a') {
    if ((e.node_side_readers_of_exchanged_data || []).length) return row.text;
    key = row.status === 'missing' ? 'art12.a.textMissing' : 'art12.a.text';
  } else if (p === 'i') {
    key = `art12.i.${e.dcat_feed ? 'textOpen' : 'textClosed'}${e.dataspace_protocol ? 'Dsp' : ''}`;
  } else if (p === 'k') {
    vars.n = String(e.breaches_recorded ?? 0);
  } else if (p === 'n') {
    key = e.consent_enabled ? 'art12.n.text' : 'art12.n.textOff';
    vars.consents = String(e.active_consents ?? 0);
    vars.shares = String(e.live_named_shares ?? 0);
  } else if (p === 'o') {
    vars.days = String(e.consent_audit_retention_days ?? 0);
  } else if (p === 'd') {
    vars.n = String(e.packages ?? 0);
  }
  return DOr(key, row.text, vars);
}

/** A row's state as the board says it: evidence (fine), check (attention), missing (danger). */
const STATE_TONE = { evidence: 'fine', check: 'attention', missing: 'danger' };
function stateMark(status) {
  return html`<${Mark} kind="status" tone=${STATE_TONE[status] || 'off'}>${D('state.' + status)}<//>`;
}

/** Replace (or add) one item of the `intermediation` document, by its id. */
async function writeItem(item) {
  const cur = await apiGet(DOC);
  const items = (cur?.data?.items || []).filter((i) => i.id !== item.id);
  await apiPut(DOC, { items: [...items, item] });
}

/** The form behind "Record the notification": the node's notification item. */
function NotificationForm({ open, onClose, current, onSaved, onMessage }) {
  const blank = { legalName: '', businessId: '', notifiedAt: '', authorityRef: '', euRegisterUrl: '', confirmedAt: '', scope: '' };
  const [v, setV] = useState(() => ({ ...blank, ...(current || {}) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (val) => setV((x) => ({ ...x, [k]: val }));
  const dayOf = (iso) => (iso ? String(iso).slice(0, 10) : '');
  const ready = v.legalName.trim() && v.businessId.trim();
  const save = async () => {
    setBusy(true); setError('');
    try {
      const opt = (k) => (String(v[k] || '').trim() ? { [k]: String(v[k]).trim() } : {});
      await writeItem({
        id: current?.id || 'node-notification', type: 'notification',
        legalName: v.legalName.trim(), businessId: v.businessId.trim(), scope: String(v.scope || '').trim(),
        ...opt('notifiedAt'), ...opt('authorityRef'), ...opt('euRegisterUrl'), ...opt('confirmedAt'),
      });
      onMessage?.('success', D('notif.saved'));
      onSaved?.();
      onClose();
    } catch (err) {
      swallowed('compliance intermediation: notification', err);
      setError(err?.message || D('notif.failed'));
    }
    setBusy(false);
  };
  const footer = html`<${Action} onClick=${onClose}>${D('notif.cancel')}<//>
    <${Loud} control disabled=${!ready || busy} onClick=${save}>${D('notif.save')}<//>`;
  return html`<${Modal} open=${open} onClose=${onClose} size="md" title=${D('notif.formTitle')} footer=${footer}>
    <${Note} kind="lead">${D('notif.formLead')}<//>
    <${Fields}>
      <${TextField} label=${D('notif.legalName')} value=${v.legalName} onInput=${set('legalName')} />
      <${TextField} label=${D('notif.businessId')} value=${v.businessId} onInput=${set('businessId')} />
      <${TextField} label=${D('notif.notifiedAt')} type="date" value=${dayOf(v.notifiedAt)} onInput=${set('notifiedAt')} />
      <${TextField} label=${D('notif.authorityRef')} value=${v.authorityRef || ''} onInput=${set('authorityRef')} />
      <${TextField} label=${D('notif.euRegisterUrl')} value=${v.euRegisterUrl || ''} onInput=${set('euRegisterUrl')} placeholder="https://" />
      <${TextField} label=${D('notif.confirmedAt')} type="date" value=${dayOf(v.confirmedAt)} onInput=${set('confirmedAt')} />
      <${TextArea} label=${D('notif.scope')} rows=${3} value=${v.scope || ''} onInput=${set('scope')} placeholder=${D('notif.scopePlaceholder')} />
    <//>
    ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
  <//>`;
}

/** Section 12 on the Compliance page. */
export default function IntermediationSection({ di, switchPage, onChanged, onMessage }) {
  const [busy, setBusy] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  if (!di) return null;
  const mode = di.mode || 'report';
  const fig = figuresOf(di);
  const shown = (di.findings || []).filter((f) => f.count > 0);
  const n = di.notification;

  // The Config page opens searched on the setting (config-tab.js reads ?q=), in its Data out group.
  const toSetting = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('q', 'consent.data_intermediation');
    history.replaceState(null, '', url);
    switchPage?.('config');
  };
  const decide = async (f, decision) => {
    setBusy(f.id);
    try {
      await writeItem({ id: f.id, type: 'review', decision, reviewedAt: new Date().toISOString() });
      onMessage?.('success', D(decision === 'accepted' ? 'reviewAccepted' : 'reviewDismissed'));
      onChanged?.();
    } catch (err) {
      swallowed('compliance intermediation: review', err);
      onMessage?.('error', err?.message || D('reviewFailed'));
    }
    setBusy('');
  };

  const modeDoor = html`<${Action} small soft onClick=${toSetting}>${D('changeSetting')}<//>`;
  return html`
    <${Section} id="adm-cmp-12" num="12" title=${D('title')} doors=${modeDoor}>
      <${Note} kind="lead">${D('lead')}<//>
      <${Line} wrap gap="small" below="small">
        <${Note} inline>${D('modeLine', { mode: D('mode.di-mode-' + mode) })}<//>
        <${Code}>${mode}<//>
      <//>
      <${Note}>${DOr('modeText.' + (di.mode_code || `di-mode-${mode}`), di.mode_text)}<//>

      <${FigureStrip} wrap items=${[
        { key: 'offerings', n: String(fig.offerings), label: D('fig.offerings'), sub: D('fig.offeringsSub'), tone: fig.offerings ? 'notice' : undefined },
        { key: 'buyers', n: String(fig.buyers), label: D('fig.buyers'), sub: D('fig.buyersSub'), tone: fig.buyers ? 'notice' : undefined },
        { key: 'organisms', n: String(fig.organisms), label: D('fig.organisms'), sub: D('fig.organismsSub', { n: String(fig.organismPackages) }), tone: fig.organisms ? 'notice' : undefined },
        { key: 'apps', n: String(fig.apps), label: D('fig.apps'), sub: D('fig.appsSub'), tone: fig.apps ? 'notice' : undefined },
      ]} />

      <${SubHeading} rule>${D('proposalsTitle')}<//>
      <${List} cols="name-desc-state-doors" empty=${D('proposalsNone')}>
        ${shown.map((f) => {
          const words = findingText(f, mode);
          const decided = f.review?.decision;
          return html`<${Row} key=${f.id} rail=${decided ? undefined : 'warn'} fine=${decided === 'accepted'}>
            <${Name} desc=${words.why || undefined}>${words.title}<//>
            <${Desc} sub=${words.proposal || undefined}>
              <${Marks}>${(f.regulation || []).map((r) => html`<${Code} key=${r.ref}>${r.act} ${r.ref}<//>`)}<//>
            <//>
            <${Cell}>${decided
              ? html`<${Mark} kind="status" tone=${decided === 'accepted' ? 'fine' : 'off'}>${D('mark.' + decided)}<//>`
              : html`<${Mark}>${D('mark.proposal')}<//>`}<//>
            <${Doors}>
              <${Loud} control disabled=${busy === f.id || decided === 'accepted'} onClick=${() => decide(f, 'accepted')}>${D('accept')}<//>
              <${Action} small disabled=${busy === f.id || decided === 'dismissed'} onClick=${() => decide(f, 'dismissed')}>${D('dismiss')}<//>
            <//>
          <//>`;
        })}
      <//>

      <${SubHeading} rule>${D('art12Title')}<//>
      <${List} cols="n-name-desc-state" head=${['', D('col.requirement'), D('col.evidence'), D('col.state')]}>
        ${(di.art12 || []).map((r) => html`<${Row} key=${r.point}>
          <${Cell} sign>${r.point}<//>
          <${Name}>${DOr(`art12.${r.point}.title`, r.title)}<//>
          <${Desc}>${art12Text(r)}<//>
          <${Cell}>${stateMark(r.status)}<//>
        <//>`)}
      <//>

      <${SubHeading} rule>${D('notif.title')}<//>
      <${Box} doors=${html`<${Action} small onClick=${() => setFormOpen(true)}>${n ? D('notif.edit') : D('notif.record')}<//>`}>
      <${Facts} flush rows=${[
        { k: D('notif.provider'), v: n ? `${n.legalName}, ${n.businessId}` : D('notif.noProvider'), missing: !n },
        { k: D('notif.notified'), v: day(n?.notifiedAt) },
        { k: D('notif.ref'), v: n?.authorityRef || '–' },
        { k: D('notif.euRegister'), v: n?.euRegisterUrl || '–', mono: !!n?.euRegisterUrl },
        { k: D('notif.confirmed'), v: n?.confirmedAt ? day(n.confirmedAt) : '–' },
        n?.scope && { k: D('notif.scope'), v: n.scope },
        ...(di.providers || []).map((p) => ({ k: D('notif.organismProvider'), v: `${p.legal_name}, ${p.business_id}`, sub: p.notified_at ? D('notif.notifiedOn', { date: fmtDate(p.notified_at) }) : D('notYet') })),
      ]} />
      <//>
      <${Note} kind="aside" size="small">${D('aside')}<//>
      ${formOpen ? html`<${NotificationForm} open=${formOpen} onClose=${() => setFormOpen(false)} current=${n}
        onSaved=${onChanged} onMessage=${onMessage} />` : null}
    <//>`;
}

/** The same facts as document text, for the printout. */
export function IntermediationPrint({ di }) {
  if (!di) return null;
  const mode = di.mode || 'report';
  const fig = figuresOf(di);
  const n = di.notification;
  const decision = (f) => (f.review?.decision ? D('mark.' + f.review.decision) : D('mark.proposal'));
  const shown = (di.findings || []).filter((f) => f.count > 0);
  return html`
    <${PrintTable} lead rows=${[
      [D('print.mode'), `${D('mode.di-mode-' + mode)} (${mode}). ${DOr('modeText.' + (di.mode_code || `di-mode-${mode}`), di.mode_text)}`],
      [D('fig.offerings'), String(fig.offerings)],
      [D('fig.buyers'), String(fig.buyers)],
      [D('fig.organisms'), `${fig.organisms} · ${D('fig.organismsSub', { n: String(fig.organismPackages) })}`],
      [D('fig.apps'), String(fig.apps)],
    ]} />
    <${Note} kind="quiet">${D('proposalsTitle')}<//>
    ${shown.length === 0 ? html`<${Note} kind="quiet">${D('proposalsNone')}<//>` : html`
      <${PrintTable} head=${[D('print.finding'), D('print.regulation'), D('print.decision')]} rows=${shown.map((f) => {
        const words = findingText(f, mode);
        return [[words.title, words.why, words.proposal].filter(Boolean).join(' '), (f.regulation || []).map((r) => `${r.act} ${r.ref}`).join(', '), decision(f)];
      })} />`}
    <${Note} kind="quiet">${D('art12Title')}<//>
    <${PrintTable} head=${[D('col.point'), D('col.requirement'), D('col.evidence'), D('col.state')]}
      rows=${(di.art12 || []).map((r) => [r.point, DOr(`art12.${r.point}.title`, r.title), art12Text(r), D('state.' + r.status)])} />
    <${Note} kind="quiet">${D('notif.title')}<//>
    <${PrintTable} lead rows=${[
      [D('notif.provider'), n ? `${n.legalName}, ${n.businessId}` : D('notif.noProvider')],
      [D('notif.notified'), day(n?.notifiedAt)],
      [D('notif.ref'), n?.authorityRef || '–'],
      [D('notif.euRegister'), n?.euRegisterUrl || '–'],
      [D('notif.confirmed'), n?.confirmedAt ? day(n.confirmedAt) : '–'],
    ]} />
    <${PrintList} items=${[{ key: 'aside', text: D('aside') }]} />`;
}
