/**
 * @file public/views/profile/data-wallet/content-classes.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Data Wallet's section "What is known about your content" (wish
 *   wish-sis-ll-n-purku-luokittelu-ja-owl). When content arrives (a stored file, a long memory record,
 *   a published workspace document) the node reads what it says about itself without any AI model,
 *   and, only for the steps the person turns on, a model describes it, sorts it into content classes,
 *   picks out the class's fields and proposes new classes. This section shows how far that has got
 *   (the figures of GET /v1/content: items read, described, with content classes, proposals
 *   waiting), the person's settings (PUT /v1/content/settings, one change at a time, each saved as it
 *   is made), the button that reads the items that have no facts yet (POST /v1/content/scans) with
 *   the running scan's progress, the proposals waiting with Approve and Reject, the newest items, and
 *   the content classes as an OWL ontology to download.
 *
 *   LIVE. The node sends the change domain `contentclass` when facts change or a scan moves on, and
 *   `memory` when the settings or the proposals record is written; the section reads again on either
 *   (onLiveUpdate, the window event aimeat-live-update). Nothing here runs on a timer.
 *
 *   OFF. When the operator has turned content classes off, GET /v1/content answers 404 and the
 *   section says so in one line and shows nothing else.
 *
 *   TERMS. The node's sensitivity labels are section 05, "Classification"; nothing here uses that
 *   word, and the MIME type is never called a content type. The words and the item row are shared
 *   with the Memory page's file preview (content-facts.js).
 * @structure useContentClasses() → content · contentCount(content) · secContentClasses(ctx, num)
 * @usage const content = useContentClasses({ federated, confirm, toast }); … secContentClasses({ ...ctx, content }, '06')
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (wish-sis-ll-n-purku-luokittelu-ja-owl).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { Section } from '/components/Section.js';
import { Space, Row as Line } from '/components/Layout.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row, Name, Desc, Doors } from '/components/List.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Field, Fields } from '/components/Field.js';
import { Check } from '/components/Check.js';
import { Choice } from '/components/Choice.js';
import { Select } from '/components/Select.js';
import { openTab } from '/components/Rail.js';
import { n } from './frame.js';
import {
  cc, classLabel, itemRow, readOverview, readLatest, readClasses, readProposals, decideProposal, startScan, readScan,
  saveSettings, readRules, downloadOntology,
} from './content-facts.js';

const html = htm.bind(h);
const LATEST = 10;
const AI_STAGES = ['describe', 'classify', 'extract', 'propose'];
const errText = (e, fallback) => e?.error?.message || e?.response?.error?.message || e?.message || fallback || t('profile.error');

/**
 * The section's reads and handlers: the overview, the newest items, the content classes, the waiting
 * proposals, the decision rules (read when the approval choice needs them), the person's scan.
 * @param {{ federated: boolean, confirm: Function, toast: (m: string, err?: boolean) => void }} deps
 */
export function useContentClasses({ federated, confirm, toast }) {
  const [ov, setOv] = useState(null);
  const [failed, setFailed] = useState(false);
  const [latest, setLatest] = useState(null);
  const [classes, setClasses] = useState([]);
  const [proposals, setProposals] = useState(null);
  const [rules, setRules] = useState(null);
  const [busy, setBusy] = useState(false);
  // The scan this page started: kept after it finishes, so its end ("12 read, 1 failed") can be said.
  const [scan, setScan] = useState(null);
  // 'rule' picked while no rule is chosen yet: nothing is saved until a rule is.
  const [ruleDraft, setRuleDraft] = useState(false);

  const load = useCallback(async () => {
    if (federated) return;
    try {
      const o = await readOverview();
      setOv(o);
      setFailed(!o);
      if (!o || o.off) return;
      const [items, cls, props] = await Promise.all([
        readLatest(LATEST).catch((e) => { swallowed('data-wallet: content facts', e); return []; }),
        readClasses().catch((e) => { swallowed('data-wallet: content classes', e); return []; }),
        readProposals().catch((e) => { swallowed('data-wallet: content proposals', e); return []; }),
      ]);
      setLatest(items);
      setClasses(cls);
      setProposals(props);
    } catch (e) { swallowed('data-wallet: content overview', e); setFailed(true); }
  }, [federated]);

  const loadRules = useCallback(async () => {
    try { setRules(await readRules()); } catch (e) { swallowed('data-wallet: decision rules', e); setRules([]); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!rules && (ruleDraft || ov?.settings?.approval === 'rule')) loadRules(); }, [rules, ruleDraft, ov, loadRules]);

  // A live frame re-reads the overview; when the scan this page started is no longer running there,
  // its end is read once from GET /v1/content/scans/{id}.
  const again = useRef(null);
  again.current = async () => {
    await load();
    if (scan?.status === 'running') {
      try { const s = await readScan(scan.id); if (s) setScan(s); } catch (e) { swallowed('data-wallet: content scan', e); }
    }
  };
  useEffect(() => onLiveUpdate(['contentclass', 'memory'], () => again.current()), []);

  /** Save one change of the settings; the stored settings come back and replace the shown ones. */
  const save = async (patch) => {
    setBusy('settings');
    try {
      const s = await saveSettings(patch);
      if (s) setOv((o) => ({ ...o, settings: s }));
      return true;
    } catch (e) { toast(errText(e, cc('saveFailed')), true); return false; } finally { setBusy(false); }
  };
  const setStage = (stage, on) => save({ stages: { [stage]: on } });
  const setSource = (source, on) => save({ sources: { [source]: on } });
  const setApproval = (v) => {
    if (v === 'rule') { setRuleDraft(true); return; }
    setRuleDraft(false);
    save({ approval: v });
  };
  const setRule = async (id) => { if (id && await save({ approval: 'rule', approvalRule: id })) setRuleDraft(false); };

  /** Read every item that has no facts yet. When a step that calls a model is on, it asks first. */
  const scanMissing = () => {
    const run = async () => {
      setBusy('scan');
      try {
        const s = await startScan();
        if (s) setScan(s);
        await load();
      } catch (e) { toast(errText(e, cc('scanFailed')), true); }
      setBusy(false);
    };
    const st = ov?.settings?.stages || {};
    if (AI_STAGES.some((s) => st[s])) confirm(cc('confirmScanAi'), run); else run();
  };

  const decide = async (p, decision) => {
    setBusy('proposal:' + p.id);
    try {
      await decideProposal(p.id, decision);
      toast(cc(decision === 'approve' ? 'approved' : 'rejected'));
      await load();
    } catch (e) { toast(errText(e, cc('saveFailed')), true); }
    setBusy(false);
  };

  const ontology = async () => {
    setBusy('ontology');
    try { await downloadOntology(); } catch (e) { toast(errText(e, cc('ontologyFailed')), true); }
    setBusy(false);
  };

  return { ov, failed, latest, classes, proposals, rules, busy, scan, ruleDraft, save, setStage, setSource, setApproval, setRule, scanMissing, decide, ontology };
}

/* ── The render ───────────────────────────────────────────────────────────────────────────────── */

/** The word beside the section's title and in the rail: how many items are read, or off. */
export function contentCount(content) {
  const o = content?.ov;
  if (!o) return '';
  if (o.off) return cc('notInUse');
  return cc('readN', { n: n(o.coverage?.total) });
}

function strip(o) {
  const cov = o.coverage || {};
  const k = cov.byKind || {};
  const kinds = ['pdf', 'image', 'video', 'text'].filter((x) => k[x]).map((x) => cc('kindN.' + x, { n: n(k[x]) })).join(' · ');
  const top = Object.entries(cov.byClass || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return html`<${FigureStrip} wrap items=${[
    { n: n(cov.total), label: cc('stripRead'), sub: kinds || cc('stripReadNone') },
    { n: n(cov.withDescription), tone: cov.withDescription ? undefined : 'dim', label: cc('stripDescribed'), sub: cc('stripDescribedSub') },
    { n: n(cov.withClasses), tone: cov.withClasses ? undefined : 'dim', label: cc('stripClasses'),
      sub: top.length ? top.map(([id, k]) => `${classLabel(o.classes, id)} ${n(k)}`).join(' · ') : cc('stripClassesNone') },
    { n: n(o.pending_proposals), tone: o.pending_proposals ? 'notice' : 'dim', label: cc('stripProposals'), sub: cc('stripProposalsSub') },
  ]} />`;
}

/** The button that reads the items without facts, and the scan's progress or how it ended. */
function scanBox(content) {
  const o = content.ov;
  const live = o.scan;
  const mine = content.scan;
  let line = null;
  if (live) line = html`<${Note} kind="loading">${cc('scanProgress', { i: n(live.i), n: n(live.n) })}<//>`;
  else if (mine && mine.status !== 'running') {
    const c = mine.counts || {};
    line = html`<${Note} kind="message" error=${mine.status === 'failed'}>${mine.status === 'failed'
      ? cc('scanFailedAt', { i: n(mine.i), n: n(mine.n) })
      : cc('scanDone', { read: n(c.inspected), skipped: n(c.skipped), failed: n(c.failed) })}<//>`;
  }
  return html`
    <${Box}>
      <${Line} gap="large" wrap>
        <${Loud} control disabled=${!!live || content.busy === 'scan'} onClick=${() => content.scanMissing()}>${cc('scanButton')}<//>
        <span>${cc('scanBody')}</span>
      <//>
      ${line}
    <//>`;
}

/** The person's settings, each saved as it changes. */
function settings(content) {
  const s = content.ov.settings || {};
  const st = s.stages || {};
  const src = s.sources || {};
  const off = content.busy === 'settings';
  const approval = content.ruleDraft ? 'rule' : s.approval;
  const rules = content.rules;
  const langs = [['', cc('lang.own')], ['fi', 'Suomi'], ['en', 'English'], ['es', 'Español']];
  if (s.language && !langs.some(([v]) => v === s.language)) langs.push([s.language, s.language]);
  // The first step runs for every item read, whatever its stored switch says (services/content/
  // pipeline.ts inspectSource: fresh facts always get it), so it is shown ticked and fixed.
  const stage = (id, help) => (id === 'technical'
    ? html`<${Check} checked disabled help=${help} hint=${cc('stage.technicalHint')}>${cc('stage.technical')}<//>`
    : html`<${Check} checked=${!!st[id]} disabled=${off} help=${help} hint=${cc('usesAiKey')}
        onChange=${(on) => content.setStage(id, on)}>${cc('stage.' + id)}<//>`);
  return html`
    <${Fields}>
      <${Check} checked=${!!s.onArrival} disabled=${off} help="content.on_arrival" onChange=${(on) => content.save({ onArrival: on })}>${cc('onArrival')}<//>
      <${Field} label=${cc('stagesLabel')} group>
        ${stage('technical', 'content.technical')}
        ${stage('describe', 'content.describe')}
        ${stage('classify', 'content.classify')}
        ${stage('extract', 'content.extract')}
        ${stage('propose', 'content.propose')}
      <//>
      <${Field} label=${cc('sourcesLabel')} help="content.sources" group>
        ${['files', 'memory', 'workspace'].map((id) => html`
          <${Check} key=${id} inline checked=${!!src[id]} disabled=${off} onChange=${(on) => content.setSource(id, on)}>${cc('source.' + id)}<//>`)}
      <//>
      <${Choice} label=${cc('approvalLabel')} help="content.approval" value=${approval} disabled=${off} onChange=${(v) => content.setApproval(v)}
        options=${[['ask', cc('approval.ask')], ['auto', cc('approval.auto')], ['rule', cc('approval.rule')]]}>
        ${approval === 'rule' ? (rules && !rules.length
          ? html`<${Action} small soft onClick=${() => openTab('ai')}>${cc('noRules')}<//>`
          : html`<${Select} ariaLabel=${cc('ruleLabel')} value=${s.approval === 'rule' ? s.approvalRule || '' : ''} disabled=${off || !rules}
              placeholder=${rules ? cc('pickRule') : t('dwpage.loading')} onChange=${(v) => content.setRule(v)}
              options=${(rules || []).map((r) => [r.id, r.title || r.id])} />`) : null}
      <//>
      <${Choice} label=${cc('languageLabel')} help="content.language" value=${s.language || ''} disabled=${off}
        onChange=${(v) => content.save({ language: v })} options=${langs} />
    <//>`;
}

/** One proposal: the new class, or the new fields of a class, why, and the two answers. */
function proposalRow(content, p) {
  const busy = !!content.busy;
  const isClass = p.kind === 'class';
  const name = isClass ? classLabel(p.class ? [p.class] : [], p.class?.id) : cc('newFields', { cls: classLabel(content.classes, p.classId) });
  const what = isClass ? p.class?.describe : (p.properties || []).map((f) => f.name).join(', ');
  const fields = isClass ? (p.class?.properties || []).map((f) => f.name).join(', ') : (p.properties || []).map((f) => f.describe).filter(Boolean).join(' ');
  return html`
    <${Row} key=${p.id}>
      <${Name} meta=${isClass ? cc('proposal.class') : cc('proposal.fields')} desc=${p.why}>${name}<//>
      <${Desc} sub=${fields || undefined}>${what}<//>
      <${Doors}>
        <${Action} small soft disabled=${busy} onClick=${() => content.decide(p, 'approve')}>${cc('approve')}<//>
        <${Action} small soft disabled=${busy} onClick=${() => content.decide(p, 'reject')}>${cc('reject')}<//>
      <//>
    <//>`;
}

/** The section. `num` is its number on the page. */
export function secContentClasses(ctx, num) {
  const content = ctx.content;
  const o = content.ov;
  return html`
    <${Section} id="dw-content" num=${num} title=${cc('title')} count=${contentCount(content)}>
      <${Note} kind="lead">${cc('lead')}<//>
      ${!o ? (content.failed ? html`<${Note} kind="quiet">${cc('loadFailed')}<//>` : html`<${Note} kind="loading">${t('dwpage.loading')}<//>`)
      : o.off ? html`<${Note} kind="quiet">${cc('off')}<//>`
      : body(content, { ...o, classes: content.classes })}
    <//>`;
}

function body(content, o) {
  const proposals = content.proposals;
  const latest = content.latest;
  return html`
    ${strip(o)}
    ${scanBox(content)}
    <${Space} above="section">
      <${Label} block>${cc('settingsTitle')}<//>
      ${settings(content)}
    <//>
    <${Space} above="section">
      <${Label} block>${cc('proposalsTitle')}<//>
      <${List} cols="name-desc-doors" labels loading=${!proposals}
        head=${[cc('col.proposal'), cc('col.fields'), '']}
        empty=${cc('proposalsEmpty')} rows=${proposals || []} render=${(p) => proposalRow(content, p)} />
    <//>
    <${Space} above="section">
      <${Label} block>${cc('latestTitle')}<//>
      <${List} cols="name-desc-state-doors" labels loading=${!latest}
        head=${[cc('col.item'), cc('col.description'), cc('col.ai'), '']}
        empty=${cc('latestEmpty')} rows=${latest || []} render=${(f) => itemRow(f, content.classes)} />
    <//>
    <${Space} above="section">
      <${Actions}>
        <${Action} small disabled=${content.busy === 'ontology'} onClick=${() => content.ontology()}>${cc('ontologyButton')}<//>
      <//>
      <${Note} kind="hint">${cc('ontologyHint')}<//>
    <//>`;
}
