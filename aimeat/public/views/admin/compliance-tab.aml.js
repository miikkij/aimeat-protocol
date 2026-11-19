/**
 * @file compliance-tab.aml.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 13 of the admin Compliance page, anti-money-laundering (Regulation (EU)
 *   2024/1624; decision decision-aml-velvoitteet-ovat-operaattorin-aktivoima-tila; design canvas
 *   "AIMEAT KYC/AML", board 9): whether this installation or its organisms do the work the regulation
 *   gives an obliged entity, what the node found, and what it can show for each obligation. The facts
 *   are `aml` of GET /v1/admin/compliance/report (services/aml/report.ts), the same answer
 *   aimeat_compliance_report gives an AI.
 *
 *   In order: the mode in words with the raw setting and the way to change it, four figures, the
 *   obliged entities' declarations, the proposals (each finding the node matched, in the page's
 *   language from its `code`, with its regulation references and Accept / Not applicable), the
 *   obligations with their state, the node's own declaration with its form, and the note that this is
 *   a reading, not a legal opinion. The section's question mark opens the concept explanation
 *   `concept.aml`, which carries the official sources.
 *
 *   A DECISION IS A REVIEW ITEM. Accept and Not applicable write `{ id: <finding id>, type: 'review',
 *   decision }` into the compliance document `aml` (GET and PUT /v1/compliance/docs/aml, the document
 *   aimeat_compliance_register_write writes), and the declaration form writes its `type: 'declaration'`
 *   item the same way; the report is read again afterwards.
 *
 *   AmlPrint is the same facts as document text for the printout (compliance-tab.print.js).
 *   Made of the component kit: it passes data and never a class.
 * @structure figuresOf · findingText · obligationText · stateMark · writeItem · DeclarationForm ·
 *   AmlSection (default) · AmlPrint
 * @usage html`<${AmlSection} aml=${report.aml} switchPage=${switchPage} onChanged=${reload} onMessage=${msg} />`
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design, stage A).
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
import { Select } from '/components/Select.js';
import { Row as Line } from '/components/Layout.js';
import { SubHeading } from '/components/SubHeading.js';
import { Box } from '/components/Box.js';
import { HelpTip } from '/components/HelpTip.js';
import { PrintTable, PrintList } from '/components/PrintPage.js';

const html = htm.bind(h);
/** The section's words: admin.compliance.aml.<key>. */
const A = (key, vars) => t('admin.compliance.aml.' + key, vars);
const AOr = (key, fallback, vars) => tOr('admin.compliance.aml.' + key, fallback, vars);
const DOC = '/v1/compliance/docs/aml';
const SECTORS = ['credit-institution', 'payment-or-emoney', 'crypto-assets', 'investment', 'insurance', 'accounting', 'audit',
  'tax-advice', 'legal', 'trust-or-company-service', 'real-estate', 'high-value-goods', 'gambling', 'crowdfunding', 'other'];
const day = (iso) => (iso ? fmtDate(iso) : A('notYet'));
const refWords = (r) => `${r?.act || ''} ${r?.ref || ''}`.trim();

/** The four figures: declared obliged entities, proposals waiting, sellers nobody screened, agents that may spend money. */
export function figuresOf(s) {
  const count = (id) => (s?.findings || []).find((f) => f.id === id)?.count ?? 0;
  return {
    declared: (s?.declarations || []).length,
    proposals: s?.totals?.proposed ?? 0,
    sellers: count('payers_not_screened'),
    agents: count('agent_spends_money'),
  };
}

/** A finding as the page says it: the bold line and why it is a finding; the node's English otherwise. */
export function findingText(f) {
  const first = (f.items || [])[0] || {};
  const v = { n: String(f.count ?? 0), name: first.organism || first.legal_name || '' };
  return {
    title: AOr(`finding.${f.code}.title`, f.reason, v),
    why: tOr(`admin.compliance.aml.finding.${f.code}.why`, '', v),
    proposal: f.proposal ? AOr(`proposal.${f.proposal.action}`, f.proposal.text, v) : '',
  };
}

/** One obligation row's sentence in the page's language; the node's English otherwise. */
export function obligationText(row) {
  if (row.status === 'not_applicable' && row.code !== 'aml-ob-sanctions') return A('ob.notApplicable');
  const e = row.evidence || {};
  const variant = row.code === 'aml-ob-sanctions' ? (row.status === 'missing' ? 'textMissing' : 'textNone')
    : row.code === 'aml-ob-cdd' ? (e.bank_identification ? 'textOn' : 'textOff') : 'text';
  return AOr(`ob.${row.code}.${variant}`, row.text, { n: String(e.sellers ?? e.declarations ?? 0) });
}

/** A row's state: evidence (fine), check (attention), missing (danger), not applicable (off). */
const STATE_TONE = { evidence: 'fine', check: 'attention', missing: 'danger', not_applicable: 'off' };
function stateMark(status) {
  return html`<${Mark} kind="status" tone=${STATE_TONE[status] || 'off'}>${A('state.' + status)}<//>`;
}

/** Replace (or add) one item of the node's `aml` document, by its id. */
async function writeItem(item) {
  const cur = await apiGet(DOC);
  const items = (cur?.data?.items || []).filter((i) => i.id !== item.id);
  await apiPut(DOC, { items: [...items, item] });
}

/** The form behind "Record the declaration": the operator's own declaration (mode node). */
function DeclarationForm({ open, onClose, current, onSaved, onMessage }) {
  const blank = { legalName: '', businessId: '', sector: 'other', complianceOfficer: '', complianceManager: '', deputy: '',
    supervisorRegisteredAt: '', supervisorRef: '', fiuRegisteredAt: '', riskAssessmentAt: '', riskAssessmentRef: '', scope: '' };
  const [v, setV] = useState(() => ({ ...blank, ...(current || {}) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (val) => setV((x) => ({ ...x, [k]: val }));
  const dayOf = (iso) => (iso ? String(iso).slice(0, 10) : '');
  const ready = v.legalName.trim() && v.businessId.trim() && v.complianceOfficer.trim();
  const save = async () => {
    setBusy(true); setError('');
    try {
      const opt = (k) => (String(v[k] || '').trim() ? { [k]: String(v[k]).trim() } : {});
      await writeItem({
        id: current?.id || 'node-declaration', type: 'declaration',
        legalName: v.legalName.trim(), businessId: v.businessId.trim(), sector: v.sector, complianceOfficer: v.complianceOfficer.trim(),
        scope: String(v.scope || '').trim(),
        ...opt('complianceManager'), ...opt('deputy'), ...opt('supervisorRegisteredAt'), ...opt('supervisorRef'),
        ...opt('fiuRegisteredAt'), ...opt('riskAssessmentAt'), ...opt('riskAssessmentRef'),
      });
      onMessage?.('success', A('decl.saved'));
      onSaved?.();
      onClose();
    } catch (err) {
      swallowed('compliance aml: declaration', err);
      setError(err?.message || A('decl.failed'));
    }
    setBusy(false);
  };
  const footer = html`<${Action} onClick=${onClose}>${A('decl.cancel')}<//>
    <${Loud} control disabled=${!ready || busy} onClick=${save}>${A('decl.save')}<//>`;
  return html`<${Modal} open=${open} onClose=${onClose} size="md" title=${A('decl.formTitle')} footer=${footer}>
    <${Note} kind="lead">${A('decl.formLead')}<//>
    <${Fields}>
      <${TextField} label=${A('decl.legalName')} value=${v.legalName} onInput=${set('legalName')} />
      <${TextField} label=${A('decl.businessId')} value=${v.businessId} onInput=${set('businessId')} />
      <${Select} label=${A('decl.sector')} value=${v.sector} onChange=${set('sector')} options=${SECTORS.map((s) => [s, A('sector.' + s)])} />
      <${TextField} label=${A('decl.officer')} value=${v.complianceOfficer} onInput=${set('complianceOfficer')} />
      <${TextField} label=${A('decl.manager')} value=${v.complianceManager || ''} onInput=${set('complianceManager')} />
      <${TextField} label=${A('decl.deputy')} value=${v.deputy || ''} onInput=${set('deputy')} />
      <${TextField} label=${A('decl.supervisorAt')} type="date" value=${dayOf(v.supervisorRegisteredAt)} onInput=${set('supervisorRegisteredAt')} />
      <${TextField} label=${A('decl.supervisorRef')} value=${v.supervisorRef || ''} onInput=${set('supervisorRef')} />
      <${TextField} label=${A('decl.fiuAt')} type="date" value=${dayOf(v.fiuRegisteredAt)} onInput=${set('fiuRegisteredAt')} />
      <${TextField} label=${A('decl.riskAt')} type="date" value=${dayOf(v.riskAssessmentAt)} onInput=${set('riskAssessmentAt')} />
      <${TextField} label=${A('decl.riskRef')} value=${v.riskAssessmentRef || ''} onInput=${set('riskAssessmentRef')} placeholder="https://" />
      <${TextArea} label=${A('decl.scope')} rows=${3} value=${v.scope || ''} onInput=${set('scope')} placeholder=${A('decl.scopePlaceholder')} />
    <//>
    ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
  <//>`;
}

/** The declarations as rows: who, the three roles, the registrations. */
function declarationRows(s) {
  return (s.declarations || []).map((d) => {
    const where = d.scope === 'node' ? A('decl.thisServer') : (d.organism || d.organism_id);
    const roles = A('decl.roles', { officer: d.compliance_officer, manager: d.compliance_manager || '–', deputy: d.deputy || '–' });
    const registered = d.supervisor_registered_at && d.fiu_registered_at;
    return html`<${Row} key=${`${d.scope}:${d.organism_id || 'node'}`}>
      <${Name} desc=${`${where} · ${A('sector.' + d.sector)}`}>${d.legal_name}<//>
      <${Desc} sub=${A('decl.assessment', { date: day(d.risk_assessment_at) })}>${roles}<//>
      <${Cell}>${html`<${Mark} kind="status" tone=${registered ? 'fine' : 'attention'}>${A(registered ? 'decl.registered' : 'decl.notRegistered')}<//>`}<//>
    <//>`;
  });
}

/** Section 13 on the Compliance page. */
export default function AmlSection({ aml, switchPage, onChanged, onMessage }) {
  const [busy, setBusy] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formCurrent, setFormCurrent] = useState(null);
  if (!aml) return null;
  const mode = aml.mode || 'report';
  const fig = figuresOf(aml);
  const shown = (aml.findings || []).filter((f) => f.count > 0);
  const nodeDecl = (aml.declarations || []).find((d) => d.scope === 'node');

  // The Config page opens searched on the setting (config-tab.js reads ?q=).
  const toSetting = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('q', 'compliance.aml_mode');
    history.replaceState(null, '', url);
    switchPage?.('config');
  };
  const decide = async (f, decision) => {
    setBusy(f.id);
    try {
      await writeItem({ id: f.id, type: 'review', decision, reviewedAt: new Date().toISOString() });
      onMessage?.('success', A(decision === 'accepted' ? 'reviewAccepted' : 'reviewDismissed'));
      onChanged?.();
    } catch (err) {
      swallowed('compliance aml: review', err);
      onMessage?.('error', err?.message || A('reviewFailed'));
    }
    setBusy('');
  };
  const openForm = async () => {
    // The form edits the stored item, with fields the report does not carry (the references).
    try {
      const cur = await apiGet(DOC);
      setFormCurrent((cur?.data?.items || []).find((i) => i.type === 'declaration') || null);
    } catch (err) { swallowed('compliance aml: read declaration', err); }
    setFormOpen(true);
  };

  const title = html`${A('title')} <${HelpTip} term="concept.aml" label=${A('title')} />`;
  const modeDoor = html`<${Action} small soft onClick=${toSetting}>${A('changeSetting')}<//>`;
  return html`
    <${Section} id="adm-cmp-13" num="13" title=${title} doors=${modeDoor}>
      <${Note} kind="lead">${A('lead')}<//>
      <${Line} wrap gap="small" below="small">
        <${Note} inline>${A('modeLine', { mode: A('mode.' + mode) })}<//>
        <${Code}>${mode}<//>
      <//>
      <${Note}>${AOr('modeText.' + (aml.mode_code || `aml-mode-${mode}`), aml.mode_text)}<//>

      <${FigureStrip} wrap items=${[
        { key: 'declared', n: String(fig.declared), label: A('fig.declared'), sub: A('fig.declaredSub'), tone: fig.declared ? 'notice' : undefined },
        { key: 'proposals', n: String(fig.proposals), label: A('fig.proposals'), sub: A('fig.proposalsSub'), tone: fig.proposals ? 'notice' : undefined },
        { key: 'sellers', n: String(fig.sellers), label: A('fig.sellers'), sub: A('fig.sellersSub'), tone: fig.sellers ? 'notice' : undefined },
        { key: 'agents', n: String(fig.agents), label: A('fig.agents'), sub: A('fig.agentsSub') },
      ]} />

      <${SubHeading} rule>${A('declTitle')}<//>
      <${List} cols="name-desc-state" empty=${A('declNone')}>${declarationRows(aml)}<//>

      <${SubHeading} rule>${A('proposalsTitle')}<//>
      <${List} cols="name-desc-state-doors" empty=${A('proposalsNone')}>
        ${shown.map((f) => {
          const words = findingText(f);
          const decided = f.review?.decision;
          return html`<${Row} key=${f.id} rail=${decided ? undefined : 'warn'} fine=${decided === 'accepted'}>
            <${Name} desc=${words.why || undefined}>${words.title}<//>
            <${Desc} sub=${words.proposal || undefined}>
              <${Marks}>${(f.regulation || []).map((r) => html`<${Code} key=${r.act + r.ref}>${refWords(r)}<//>`)}<//>
            <//>
            <${Cell}>${decided
              ? html`<${Mark} kind="status" tone=${decided === 'accepted' ? 'fine' : 'off'}>${A('mark.' + decided)}<//>`
              : html`<${Mark}>${A('mark.proposal')}<//>`}<//>
            <${Doors}>
              <${Loud} control disabled=${busy === f.id || decided === 'accepted'} onClick=${() => decide(f, 'accepted')}>${A('accept')}<//>
              <${Action} small disabled=${busy === f.id || decided === 'dismissed'} onClick=${() => decide(f, 'dismissed')}>${A('dismiss')}<//>
            <//>
          <//>`;
        })}
      <//>

      <${SubHeading} rule>${A('obTitle')}<//>
      <${List} cols="name-desc-state" head=${[A('col.obligation'), A('col.evidence'), A('col.state')]}>
        ${(aml.obligations || []).map((r) => html`<${Row} key=${r.code}>
          <${Name} desc=${refWords(r.ref)}>${AOr(`ob.${r.code}.title`, r.ref?.text || r.code)}<//>
          <${Desc}>${obligationText(r)}<//>
          <${Cell}>${stateMark(r.status)}<//>
        <//>`)}
      <//>

      ${mode === 'node' || nodeDecl ? html`
        <${SubHeading} rule>${A('decl.nodeTitle')}<//>
        <${Box} doors=${html`<${Action} small onClick=${openForm}>${nodeDecl ? A('decl.edit') : A('decl.record')}<//>`}>
        <${Facts} flush rows=${[
          { k: A('decl.legalName'), v: nodeDecl ? `${nodeDecl.legal_name}, ${nodeDecl.business_id}` : A('decl.none'), missing: !nodeDecl },
          { k: A('decl.officer'), v: nodeDecl?.compliance_officer || '–' },
          { k: A('decl.supervisorAt'), v: day(nodeDecl?.supervisor_registered_at) },
          { k: A('decl.fiuAt'), v: day(nodeDecl?.fiu_registered_at) },
        ]} />
        <//>` : null}
      <${Note} kind="aside" size="small">${A('aside')}<//>
      ${formOpen ? html`<${DeclarationForm} open=${formOpen} onClose=${() => setFormOpen(false)} current=${formCurrent}
        onSaved=${onChanged} onMessage=${onMessage} />` : null}
    <//>`;
}

/** The same facts as document text, for the printout. */
export function AmlPrint({ aml }) {
  if (!aml) return null;
  const mode = aml.mode || 'report';
  const fig = figuresOf(aml);
  const decision = (f) => (f.review?.decision ? A('mark.' + f.review.decision) : A('mark.proposal'));
  const shown = (aml.findings || []).filter((f) => f.count > 0);
  return html`
    <${PrintTable} lead rows=${[
      [A('print.mode'), `${A('mode.' + mode)} (${mode}). ${AOr('modeText.' + (aml.mode_code || `aml-mode-${mode}`), aml.mode_text)}`],
      [A('fig.declared'), String(fig.declared)],
      [A('fig.proposals'), String(fig.proposals)],
      [A('fig.sellers'), String(fig.sellers)],
      [A('fig.agents'), String(fig.agents)],
    ]} />
    <${Note} kind="quiet">${A('declTitle')}<//>
    ${(aml.declarations || []).length === 0 ? html`<${Note} kind="quiet">${A('declNone')}<//>` : html`
      <${PrintTable} head=${[A('decl.legalName'), A('decl.officer'), A('decl.supervisorAt'), A('decl.fiuAt')]} rows=${aml.declarations.map((d) => [
        `${d.legal_name}, ${d.business_id}`, d.compliance_officer, day(d.supervisor_registered_at), day(d.fiu_registered_at)])} />`}
    <${Note} kind="quiet">${A('proposalsTitle')}<//>
    ${shown.length === 0 ? html`<${Note} kind="quiet">${A('proposalsNone')}<//>` : html`
      <${PrintTable} head=${[A('print.finding'), A('print.regulation'), A('print.decision')]} rows=${shown.map((f) => {
        const words = findingText(f);
        return [[words.title, words.why, words.proposal].filter(Boolean).join(' '), (f.regulation || []).map(refWords).join(', '), decision(f)];
      })} />`}
    <${Note} kind="quiet">${A('obTitle')}<//>
    <${PrintTable} head=${[A('col.obligation'), A('col.evidence'), A('col.state')]}
      rows=${(aml.obligations || []).map((r) => [`${AOr(`ob.${r.code}.title`, r.code)} (${refWords(r.ref)})`, obligationText(r), A('state.' + r.status)])} />
    <${PrintList} items=${[{ key: 'aside', text: A('aside') }]} />`;
}
