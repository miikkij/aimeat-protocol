/**
 * @file living-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile "Living Documents" tab (Phase 0). Two areas: a personal TEMPLATE collection
 *   (create/edit/delete reusable charter+template skeletons) and the DEPLOYED instances (a template
 *   deployed into a workspace, rendered as living markdown). Phase 0 has no background pulse — content
 *   per slot is added/derived manually so the assemble→render model is exercised end to end. Surfaced
 *   as a top-level tab because instances generate cost once the pulse lands.
 *   See docs/plans/2026-06-21-living-documents-plan.md.
 * @structure LivingTab (default export) — templates list/editor + deploy + instances list/viewer
 * @usage html`<${LivingTab} session=${session} showToast=${showToast} />`
 * @version-history
 *   2026-09-22 -- The set's newer props: the document preview, a picked earlier version and a pending
 *     body scroll inside a capped height; slot-id and number fields are narrow; Approve is in the
 *     success tone, Reject, Delete and a section's ✗ in the danger tone.
 *   2026-09-22 -- Composed from the shared set (Page, Rail, Section, ListRow, Field, Toolbar, Surface,
 *     Chip, Action, Text, Stack, Columns) so the tab follows the one theme; living.css is gone. Each
 *     view has one loud action (author, save, deploy or pulse); the ✨ ↻ ⏳ ＋ glyphs are dropped and
 *     ✕ is ✗. The data-point and source entry rows keep their typed text in state, because the
 *     shared Field is controlled and a live-update re-render would otherwise empty them.
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v1.1.0 — 2026-07-16 — Mount folds templates + instances + organisms into GET /v1/living-docs
 *     (getLivingOverview); individual reads (two full memory scans) kept as fallback.
 *   v1.0.0 — 2026-06-21 — Phase 0: template management + deploy + manual derive + render.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Spinner } from './shared.js';
import { Markdown } from '/components/Markdown.js';
import { useConfirm } from '/components/Modal.js';
import * as living from '/js/services/living.js';
import { listOrganisms, listWorkspaces } from '/js/services/organisms.js';
import * as offersService from '/js/services/offers.js';
import { buildCatalogue } from '/js/services/notebook-plan.js';
import { swallowed } from '/js/swallowed.js';
import { dateTime as fmtDateTime } from '/js/format.js';
import { Page, Rail, Section, Stack, Columns, Toolbar, Field, ListRow, Chip, Action, Surface, Text } from '/components/poster-parts.js';

export default function LivingTab({ session, showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [templates, setTemplates] = useState(null);
  const [instances, setInstances] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [editing, setEditing] = useState(null);     // template being edited (object) | null
  const [deploying, setDeploying] = useState(null);  // { template, orgId, wsId, workspaces[] } | null
  const [opened, setOpened] = useState(null);        // readInstance result | null
  const [busy, setBusy] = useState(false);
  const [need, setNeed] = useState('');              // AI-author input
  const [authoring, setAuthoring] = useState(false);
  const [charterView, setCharterView] = useState(null); // null | 'readable' | 'yaml'
  const [pulsing, setPulsing] = useState(false);
  const [pulseStatus, setPulseStatus] = useState({}); // slotId → phase
  const [ledger, setLedger] = useState([]);
  const [picked, setPicked] = useState({});           // slotId → chosen history version (timeline)
  const [drafts, setDrafts] = useState({});           // entry-row id → typed text (data points, sources)

  // loadAll is re-created each render and closes over session; this effect intentionally loads only
  // when the session changes. Including it would re-run every render (loop).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (session) loadAll(); }, [session]);

  // Re-fetch on the live stream, like every sibling tab. Review item 7.6.
  useEffect(() => {
    // NO FILTER HERE, and that is the measured answer rather than laziness: routes/living.ts emits
    // no change domain at all, so there is no name to listen for. A filter would be a guess that
    // makes this tab MISS updates, which is worse than fetching once too often. The day living docs
    // announce themselves, this gains the domain they announce.
    const handler = () => { if (session) loadAll(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function loadAll() {
    try {
      // Mount fold: ONE composite (templates + instances partitioned server-side from a single owner-memory
      // scan + organisms). On failure, fall back to the individual reads (two full scans + listOrganisms).
      const ov = await living.getLivingOverview();
      if (ov) {
        setTemplates(ov.templates);
        setInstances(ov.instances);
        setOrgs(ov.organisms);
        return;
      }
      const [tpls, insts, orgResp] = await Promise.all([
        living.listTemplates(), living.listInstances(), listOrganisms({ member: session.owner }),
      ]);
      setTemplates(tpls);
      setInstances(insts);
      setOrgs(orgResp?.data?.organisms || []);
    } catch (err) { swallowed('living-tab', err); setTemplates([]); setInstances([]); }
  }

  // ── Templates ──

  function newTemplate() { setCharterView(null); setEditing(living.blankTemplate()); }

  function activityThreshold(e) { return (e?.charter?.triggers || []).find(tr => tr.kind === 'activity')?.changed_gte || ''; }
  function setActivityTrigger(v) {
    const n = parseInt(v, 10);
    setEditing(e => {
      const triggers = [{ kind: 'cadence' }];
      if (Number.isFinite(n) && n > 0) triggers.push({ kind: 'activity', changed_gte: n });
      return { ...e, charter: { ...e.charter, triggers } };
    });
  }
  function setTrust(derive) { setEditing(e => ({ ...e, charter: { ...e.charter, trust: { ...(e.charter?.trust || {}), derive } } })); }

  async function handleAuthor() {
    if (!need.trim() || authoring) return;
    setAuthoring(true);
    try {
      let catalogue = [];
      try { catalogue = buildCatalogue(await offersService.listOffers()); } catch (err) { swallowed('living-tab: handleAuthor', err); }
      const data = await living.authorTemplate(need.trim(), catalogue);
      const tpl = data?.template;
      if (!tpl) throw new Error(t('profile.error'));
      const base = living.blankTemplate();
      setCharterView('readable');
      setEditing({
        ...base,
        title: tpl.title || '',
        description: tpl.description || '',
        charter: tpl.charter || base.charter,
        charterReadable: tpl.charterReadable || '',
        template: Array.isArray(tpl.template) && tpl.template.length ? tpl.template : base.template,
      });
      setNeed('');
    } catch (e) {
      showToast(e.code === 'NO_OPENROUTER_KEY' ? t('profile.notebook.needKey') : (e.message || t('profile.error')), true);
    } finally { setAuthoring(false); }
  }
  const patchEditing = (patch) => setEditing(e => ({ ...e, ...patch }));
  const patchSlot = (i, patch) => setEditing(e => ({ ...e, template: e.template.map((s, idx) => idx === i ? { ...s, ...patch } : s) }));
  const addSlot = () => setEditing(e => ({ ...e, template: [...e.template, { section: '', desc: '', slot: 'slot' + (e.template.length + 1), kind: 'derived', rules: {} }] }));
  const removeSlot = (i) => setEditing(e => ({ ...e, template: e.template.filter((_, idx) => idx !== i) }));

  async function saveEditing() {
    if (!editing.title.trim()) { showToast(t('profile.living.titleRequired'), true); return; }
    setBusy(true);
    try { await living.saveTemplate(editing); showToast(t('profile.living.templateSaved')); setEditing(null); await loadAll(); }
    catch (e) { showToast(e.message || t('profile.error'), true); }
    finally { setBusy(false); }
  }

  function deleteTpl(tpl) {
    confirm(t('profile.living.deleteTemplateConfirm'), async () => {
      try { await living.deleteTemplate(tpl.id); showToast(t('profile.living.deleted')); await loadAll(); }
      catch (e) { showToast(e.message || t('profile.error'), true); }
    }, { danger: true });
  }

  // ── Deploy ──

  async function startDeploy(tpl) {
    const firstOrg = orgs[0]?.id || '';
    const workspaces = firstOrg ? await listWorkspaces(firstOrg) : [];
    setDeploying({ template: tpl, orgId: firstOrg, wsId: workspaces[0]?.id || '', workspaces });
  }
  async function pickDeployOrg(orgId) {
    const workspaces = orgId ? await listWorkspaces(orgId) : [];
    setDeploying(d => ({ ...d, orgId, wsId: workspaces[0]?.id || '', workspaces }));
  }
  async function confirmDeploy() {
    const { template, orgId, wsId } = deploying;
    if (!orgId || !wsId) { showToast(t('profile.living.pickWorkspace'), true); return; }
    setBusy(true);
    try {
      const loc = await living.deployTemplate(template, orgId, wsId);
      showToast(t('profile.living.deployed'));
      setDeploying(null);
      await loadAll();
      openInstance(loc);
    } catch (e) { showToast(e.message || t('profile.error'), true); }
    finally { setBusy(false); }
  }

  // ── Instances ──

  async function openInstance(loc) {
    setOpened(null);
    setPulseStatus({});
    try {
      setOpened(await living.readInstance(loc.orgId, loc.wsId, loc.docId));
      living.listLedger(loc.orgId, loc.wsId, loc.docId).then(setLedger).catch(() => setLedger([]));
    } catch (e) { showToast(e.message || t('profile.error'), true); }
  }

  async function reopen() { if (opened) await openInstance(opened.loc); }

  async function togglePause() {
    if (!opened) return;
    try { await living.setPaused(opened.loc, opened.config, !(opened.config.status?.paused)); await reopen(); }
    catch (e) { showToast(e.message || t('profile.error'), true); }
  }
  async function changeCadence(cadence) {
    if (!opened) return;
    try { await living.setCadence(opened.loc, opened.config, cadence); await reopen(); }
    catch (e) { showToast(e.message || t('profile.error'), true); }
  }

  async function handlePulse() {
    if (!opened || pulsing) return;
    setPulsing(true);
    setPulseStatus({});
    try {
      const r = await living.pulseInstance(opened.loc.orgId, opened.loc.wsId, opened.loc.docId, {
        onStatus: (slotId, phase) => setPulseStatus(s => ({ ...s, [slotId]: phase })),
      });
      showToast(t('profile.living.pulseDone').replace('{n}', String(r.results.length)));
      await reopen();
    } catch (e) {
      showToast(e.code === 'NO_OPENROUTER_KEY' ? t('profile.notebook.needKey') : (e.message || t('profile.error')), true);
    } finally { setPulsing(false); }
  }

  async function saveSlot(slotId, markdown) {
    try { await living.setSlotContent(opened.loc, slotId, markdown, []); showToast(t('profile.living.sectionSaved')); await reopen(); }
    catch (e) { showToast(e.message || t('profile.error'), true); }
  }
  async function addSourceTo(slotId, text) {
    if (!text.trim()) return;
    try { await living.addSource(opened.loc, slotId, { text }); await reopen(); }
    catch (e) { showToast(e.message || t('profile.error'), true); }
  }
  async function composeSlot(slotId) {
    try { await living.deriveSlotFromSources(opened.loc, slotId, opened.sources); showToast(t('profile.living.composed')); await reopen(); }
    catch (e) { showToast(e.message || t('profile.error'), true); }
  }
  async function approveSlot(slotId) {
    try { await living.approvePending(opened.loc, slotId, opened.pending?.[slotId]); showToast(t('profile.living.approved')); await reopen(); }
    catch (e) { showToast(e.message || t('profile.error'), true); }
  }
  async function rejectSlot(slotId) {
    try { await living.rejectPending(opened.loc, slotId); showToast(t('profile.living.rejected')); await reopen(); }
    catch (e) { showToast(e.message || t('profile.error'), true); }
  }
  async function handleSaveSnapshot() {
    try { await living.saveSnapshot(opened.loc, opened.config, picked); showToast(t('profile.living.snapshotSaved')); }
    catch (e) { showToast(e.message || t('profile.error'), true); }
  }
  async function addDataPoint(slotId, label, value) {
    const v = parseFloat(value);
    if (!Number.isFinite(v)) return;
    try { await living.addSource(opened.loc, slotId, { text: `${label || ''}: ${value}`, data: { label: label || '', value: v } }); await reopen(); }
    catch (e) { showToast(e.message || t('profile.error'), true); }
  }
  // The per-section entry rows (a data point's label and value, a new source) keep what is typed in
  // `drafts`, keyed as the old element ids were: the shared Field is a controlled input, so a re-render
  // (a live update) would otherwise empty a half-typed entry.
  const draftOf = (id) => drafts[id] || '';
  const setDraft = (id, v) => setDrafts(d => ({ ...d, [id]: v }));
  async function submitDp(slot) {
    const l = draftOf('dp-l-' + slot), val = draftOf('dp-v-' + slot);
    if (!val) return;
    await addDataPoint(slot, l, val);
    setDrafts(d => ({ ...d, ['dp-l-' + slot]: '', ['dp-v-' + slot]: '' }));
  }
  const pickVersion = (slotId, idx) => setPicked(p => {
    const next = { ...p };
    if (idx === '') delete next[slotId]; else next[slotId] = opened.history?.[slotId]?.[Number(idx)];
    return next;
  });

  /** Tiny dependency-free inline bar chart for an aggregate slot's numeric series. The bars take the
   *  surface's coral tone through currentColor; the box around them is the shared Surface. */
  const renderChart = (series) => {
    if (!series.length) return null;
    const W = 280, Hh = 56, n = series.length;
    const max = Math.max(...series.map(d => d.value), 1), min = Math.min(...series.map(d => d.value), 0);
    const range = (max - min) || 1, bw = W / n;
    return html`<${Surface} kind="box" density="flush" tone="coral"><svg viewBox="0 0 ${W} ${Hh}" width="100%" height=${Hh} preserveAspectRatio="none" fill="currentColor">
      ${series.map((d, i) => { const h = ((d.value - min) / range) * (Hh - 8) + 4; return html`<rect key=${i} x=${i * bw + 1} y=${Hh - h} width=${Math.max(1, bw - 2)} height=${h}><title>${escHtml(d.label)}: ${d.value}</title></rect>`; })}
    </svg><//>`;
  };

  function orgName(id) { return orgs.find(o => o.id === id)?.name || id; }

  // ── Render: template editor ──

  const renderEditor = () => html`
    <${Section} title=${editing.id && templates?.some(x => x.id === editing.id) ? t('profile.living.editTemplate') : t('profile.living.newTemplate')}>
      <${Stack}>
        <${Field} label=${t('profile.living.fieldTitle')} value=${editing.title} onInput=${e => patchEditing({ title: e.target.value })} />
        <${Field} label=${t('profile.living.fieldDescription')} value=${editing.description} onInput=${e => patchEditing({ description: e.target.value })} />
        <${Field} type="textarea" rows=${2} label=${t('profile.living.fieldScope')} value=${editing.charter?.scope || ''}
          onInput=${e => patchEditing({ charter: { ...editing.charter, scope: e.target.value } })} />

        <${Stack} direction="wrap" align="center">
          <${Text} kind="label">${t('profile.living.charter')}<//>
          <${Action} kind="tab" selected=${charterView === 'readable'} onClick=${() => setCharterView(v => v === 'readable' ? null : 'readable')}>${t('profile.living.charterReadable')}<//>
          <${Action} kind="tab" selected=${charterView === 'yaml'} onClick=${() => setCharterView(v => v === 'yaml' ? null : 'yaml')}>${t('profile.living.charterYaml')}<//>
        <//>
        ${charterView === 'readable' && html`<${Surface} kind="box"><${Markdown} text=${editing.charterReadable || editing.charter?.scope || t('profile.living.charterEmpty')} /><//>`}
        ${charterView === 'yaml' && html`<${Surface} kind="code">${escHtml(living.charterToYaml(editing.charter || {}))}<//>`}

        <${Text} kind="label">${t('profile.living.automation')}<//>
        <${Columns} collapse=${560}>
          <${Field} type="select" label=${t('profile.living.trust')} value=${editing.charter?.trust?.derive || 'auto'} onChange=${e => setTrust(e.target.value)}
            options=${[{ value: 'auto', label: t('profile.living.trustAuto') }, { value: 'gated', label: t('profile.living.trustGated') }]} />
          <${Field} type="number" min="0" width="narrow" label=${t('profile.living.activityTrigger')} value=${activityThreshold(editing)} onInput=${e => setActivityTrigger(e.target.value)} />
        <//>

        <${Text} kind="label">${t('profile.living.sections')}<//>
        ${editing.template.map((s, i) => html`
          <${Columns} key=${i} layout="quarters" density="compact">
            <${Field} placeholder=${t('profile.living.sectionName')} value=${s.section} onInput=${e => patchSlot(i, { section: e.target.value })} />
            <${Field} placeholder=${t('profile.living.sectionDesc')} value=${s.desc} onInput=${e => patchSlot(i, { desc: e.target.value })} />
            <${Field} placeholder="slot-id" width="narrow" value=${s.slot} onInput=${e => patchSlot(i, { slot: e.target.value })} />
            <${Stack} direction="horizontal"><${Action} kind="text" tone="danger" onClick=${() => removeSlot(i)}>✗<//><//>
          <//>`)}
        <${Stack} direction="horizontal"><${Action} onClick=${addSlot}>${t('profile.living.addSection')}<//><//>
        <${Stack} direction="wrap" align="center">
          <${Action} kind="primary" disabled=${busy} onClick=${saveEditing}>${t('profile.living.saveTemplate')}<//>
          <${Action} onClick=${() => setEditing(null)}>${t('profile.notebook.cancelBtn')}<//>
        <//>
      <//>
    <//>`;

  // ── Render: deploy panel ──

  const renderDeploy = () => html`
    <${Section} title=${t('profile.living.deployTitle').replace('{title}', deploying.template.title)}>
      <${Stack}>
      ${orgs.length === 0
        ? html`<${Text} tone="muted">${t('profile.living.noOrgs')}<//>`
        : html`<${Stack}>
          <${Field} type="select" label=${t('profile.living.organism')} value=${deploying.orgId} onChange=${e => pickDeployOrg(e.target.value)}
            options=${orgs.map(o => ({ value: o.id, label: escHtml(o.name) }))} />
          ${deploying.workspaces.length === 0
            ? html`<${Stack} density="compact"><${Text} kind="label">${t('profile.living.workspace')}<//><${Text} tone="muted">${t('profile.living.noWorkspaces')}<//><//>`
            : html`<${Field} type="select" label=${t('profile.living.workspace')} value=${deploying.wsId} onChange=${e => setDeploying(d => ({ ...d, wsId: e.target.value }))}
                options=${deploying.workspaces.map(w => ({ value: w.id, label: escHtml(w.name || w.id) }))} />`}
        <//>`}
      <${Stack} direction="wrap" align="center">
        <${Action} kind="primary" disabled=${busy || !deploying.orgId || !deploying.wsId} onClick=${confirmDeploy}>${t('profile.living.deployBtn')}<//>
        <${Action} onClick=${() => setDeploying(null)}>${t('profile.notebook.cancelBtn')}<//>
      <//>
      <//>
    <//>`;

  // ── Render: instance viewer ──

  const renderOpened = () => {
    const md = living.renderInstanceMarkdown(opened);
    const st = opened.config.status || {};
    const lastPulse = st.last_pulse ? fmtDateTime(st.last_pulse) : t('profile.living.never');
    return html`
      <${Section} title=${escHtml(opened.config.title)}
        actions=${html`<${Action} kind="primary" disabled=${pulsing} onClick=${handlePulse}>${pulsing ? t('profile.living.pulsing') : t('profile.living.pulseNow')}<//>
          <${Action} onClick=${togglePause}>${st.paused ? t('profile.living.resume') : t('profile.living.pause')}<//>
          <${Action} onClick=${handleSaveSnapshot}>${t('profile.living.saveSnapshot')}<//>
          <${Action} onClick=${() => setOpened(null)}>${t('profile.living.backToList')}<//>`}>
        <${Stack}>
          <${Stack} direction="wrap" align="center" density="compact">
            <${Text} kind="mono" tone="muted">
              ${orgName(opened.loc.orgId)} · ${escHtml(opened.loc.wsId)} · v${st.version || 1}
              · ${t('profile.living.lastPulse')}: ${lastPulse}
              · ${t('profile.living.cost')}: $${(st.cost || 0).toFixed(4)}
            <//>
            ${st.paused && html`<${Chip} tone="sun">${t('profile.living.paused')}<//>`}
            ${st.health === 'retired' && html`<${Chip}>${t('profile.living.retired')}: ${escHtml(st.retired_reason || '')}<//>`}
          <//>
          <${Columns} layout="trailing" collapse=${560}>
            <${Field} type="select" label=${t('profile.living.cadence')} value=${opened.config.charter?.cadence || 'daily'} onChange=${e => changeCadence(e.target.value)}
              options=${[
                { value: 'hourly', label: t('profile.living.cadenceHourly') },
                { value: 'daily', label: t('profile.living.cadenceDaily') },
                { value: 'weekly', label: t('profile.living.cadenceWeekly') },
              ]} />
          <//>

          <${Surface} kind="box" height="scroll"><${Markdown} text=${md} /><//>

          <${Text} kind="label">${t('profile.living.sections')}<//>
          <${Stack} density="compact">
          ${(opened.config.template || []).map(sec => {
            const der = opened.slots[sec.slot];
            const slotSources = opened.sources.filter(s => s.slot === sec.slot);
            const phase = pulseStatus[sec.slot];
            const versions = opened.history?.[sec.slot] || [];
            const pickedVer = picked[sec.slot];
            const series = sec.kind === 'aggregate' ? living.aggregateData(opened.sources, sec.slot) : [];
            return html`
              <${ListRow} key=${sec.slot} name=${escHtml(sec.section || sec.slot)} detailKind="text" detail=${escHtml(sec.desc || '')}
                value=${phase && html`<${Text} kind="mono" tone="coral">${escHtml(phase)}<//>`}
                actions=${sec.agent && html`<${Chip}>→ ${escHtml(String(sec.agent).split('/')[0])}<//>`}>
                <${Stack}>
                  ${versions.length > 1 && html`
                    <${Field} type="select" label=${t('profile.living.timeline')} value=${pickedVer ? String(versions.indexOf(pickedVer)) : ''} onChange=${e => pickVersion(sec.slot, e.target.value)}
                      options=${[{ value: '', label: t('profile.living.versionCurrent') },
                        ...versions.map((v, i) => ({ value: String(i), label: `${fmtDateTime(v.producedAt)} · ${escHtml(v.producedBy || '')}` }))]} />
                    ${pickedVer && html`<${Surface} kind="box" height="scroll"><${Markdown} text=${pickedVer.markdown} /><//>`}`}
                  ${sec.kind === 'aggregate' && html`
                    ${series.length ? renderChart(series) : html`<${Text} kind="caption" tone="muted">${t('profile.living.noData')}<//>`}
                    <${Toolbar} label=${t('profile.living.addPoint')} actions=${html`<${Action} onClick=${() => submitDp(sec.slot)}>${t('profile.living.addPoint')}<//>`}>
                      <${Field} placeholder=${t('profile.living.dpLabel')} id=${'dp-l-' + sec.slot}
                        value=${draftOf('dp-l-' + sec.slot)} onInput=${e => setDraft('dp-l-' + sec.slot, e.target.value)} />
                      <${Field} type="number" width="narrow" placeholder=${t('profile.living.dpValue')} id=${'dp-v-' + sec.slot}
                        value=${draftOf('dp-v-' + sec.slot)} onInput=${e => setDraft('dp-v-' + sec.slot, e.target.value)}
                        onKeyDown=${e => { if (e.key === 'Enter') submitDp(sec.slot); }} />
                    <//>`}
                  <${Field} type="textarea" rows=${3} placeholder=${t('profile.living.sectionContentPh')}
                    value=${der?.markdown || ''} onChange=${e => saveSlot(sec.slot, e.target.value)} />
                  ${opened.pending?.[sec.slot] && html`
                    <${Surface} kind="aside">
                      <${Stack} density="compact">
                        <${Text} kind="caption" tone="muted">${t('profile.living.pendingTitle')}<//>
                        <${Surface} kind="plain" height="scroll"><${Markdown} text=${opened.pending[sec.slot].markdown} /><//>
                        <${Stack} direction="wrap">
                          <${Action} tone="success" onClick=${() => approveSlot(sec.slot)}>${t('profile.living.approve')}<//>
                          <${Action} tone="danger" onClick=${() => rejectSlot(sec.slot)}>${t('profile.living.reject')}<//>
                        <//>
                      <//>
                    <//>`}
                  <${Toolbar} label=${t('profile.living.compose')}
                    count=${slotSources.length > 0 ? `${slotSources.length} ${t('profile.living.sources')}` : undefined}
                    actions=${html`<${Action} onClick=${() => composeSlot(sec.slot)}>${t('profile.living.compose')}<//>`}>
                    <${Field} placeholder=${t('profile.living.addSourcePh')}
                      value=${draftOf('src-' + sec.slot)} onInput=${e => setDraft('src-' + sec.slot, e.target.value)}
                      onKeyDown=${e => { if (e.key === 'Enter') { addSourceTo(sec.slot, e.target.value); setDraft('src-' + sec.slot, ''); } }} />
                  <//>
                <//>
              <//>`;
          })}
          <//>

          ${ledger.length > 0 && html`
            <${Text} kind="label">${t('profile.living.ledgerTitle')}<//>
            <${Stack} density="compact">
              ${ledger.slice(0, 10).map((ev, i) => html`<${ListRow} key=${i} density="compact" time=${fmtDateTime(ev.at)}
                name=${`${escHtml(ev.event)}${ev.slot ? ` · ${escHtml(ev.slot)}` : ''}${typeof ev.costUsd === 'number' ? ` · $${ev.costUsd.toFixed(4)}` : ''}`} />`)}
            <//>`}
        <//>
      <//>`;
  };

  // ── Render: main ──

  const listing = !opened && !editing && !deploying;
  return html`
    <${Page} title=${t('profile.living.title')}
      crumbs=${[{ label: t('nav.profile') }, { label: t('profile.landing.menuInformation') }, { label: t('profile.tabs.living') }]}
      rail=${listing && html`<${Rail} kind="index" title=${t('profile.living.title')} entries=${[
        { href: '#ld-templates', label: t('profile.living.templatesTitle'), count: templates ? templates.length : undefined },
        { href: '#ld-instances', label: t('profile.living.instancesTitle'), count: instances ? instances.length : undefined },
      ]} />`}>
      ${ConfirmUI}
      <${Text} kind="lead" tone="muted">${t('profile.living.desc')}<//>

      ${opened ? renderOpened() : html`
        ${deploying && renderDeploy()}
        ${editing && renderEditor()}

        ${!editing && !deploying && html`
          <${Section} id="ld-templates" title=${t('profile.living.templatesTitle')} description=${t('profile.living.templatesDesc')}
            actions=${html`<${Action} onClick=${newTemplate}>${t('profile.living.newTemplate')}<//>`}>
            <${Stack}>
              <${Field} type="textarea" rows=${2} placeholder=${t('profile.living.authorPh')}
                value=${need} onInput=${e => setNeed(e.target.value)} />
              <${Stack} direction="horizontal">
                <${Action} kind="primary" disabled=${!need.trim() || authoring} onClick=${handleAuthor}>
                  ${authoring ? t('profile.living.authoring') : t('profile.living.authorBtn')}
                <//>
              <//>
              ${templates === null && html`<${Spinner} text=${t('profile.living.loading')} />`}
              ${templates?.length === 0 && html`<${Text} tone="muted">${t('profile.living.noTemplates')}<//>`}
            <//>
            ${templates?.length > 0 && templates.map(tpl => html`
              <${ListRow} key=${tpl.id} name=${escHtml(tpl.title || t('profile.living.untitled'))}
                detailKind="text" detail=${tpl.description && escHtml(tpl.description)}
                value=${`${(tpl.template || []).length} ${t('profile.living.sectionsShort')}`}
                actions=${html`<${Action} onClick=${() => startDeploy(tpl)}>${t('profile.living.deploy')}<//>
                  <${Action} onClick=${() => setEditing({ ...tpl })}>${t('profile.living.edit')}<//>
                  <${Action} tone="danger" onClick=${() => deleteTpl(tpl)}>${t('profile.notebook.deleteBtn')}<//>`} />`)}
          <//>

          <${Section} id="ld-instances" title=${t('profile.living.instancesTitle')} description=${t('profile.living.instancesDesc')}>
            ${instances === null
              ? html`<${Spinner} text=${t('profile.living.loading')} />`
              : instances.length === 0
                ? html`<${Text} tone="muted">${t('profile.living.noInstances')}<//>`
                : instances.map(inst => html`
                    <${ListRow} key=${inst.loc.docId} name=${escHtml(inst.config.title)}
                      detail=${`v${inst.config.status?.version || 1} · ${t('profile.living.lastPulse')}: ${inst.config.status?.last_pulse ? fmtDateTime(inst.config.status.last_pulse) : t('profile.living.never')} · ${t('profile.living.cost')}: $${(inst.config.status?.cost || 0).toFixed(4)}`}
                      value=${html`<${Stack} direction="wrap" align="end" density="compact">
                        <${Chip}>${escHtml(orgName(inst.loc.orgId))}<//>
                        ${inst.config.status?.paused && html`<${Chip} tone="sun">${t('profile.living.paused')}<//>`}
                      <//>`}
                      actions=${html`<${Action} onClick=${() => openInstance(inst.loc)}>${t('profile.living.open')}<//>`} />`)}
          <//>
        `}
      `}
    <//>
  `;
}
