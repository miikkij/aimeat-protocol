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

  // loadAll is re-created each render and closes over session; this effect intentionally loads only
  // when the session changes. Including it would re-run every render (loop).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (session) loadAll(); }, [session]);

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
  /** @param {string} id @returns {HTMLInputElement|null} */
  const dpEl = (id) => /** @type {HTMLInputElement|null} */ (document.getElementById(id));
  async function submitDp(slot) {
    const l = dpEl('dp-l-' + slot), val = dpEl('dp-v-' + slot);
    if (!val || !val.value) return;
    await addDataPoint(slot, l?.value || '', val.value);
    if (l) l.value = ''; if (val) val.value = '';
  }
  const pickVersion = (slotId, idx) => setPicked(p => {
    const next = { ...p };
    if (idx === '') delete next[slotId]; else next[slotId] = opened.history?.[slotId]?.[Number(idx)];
    return next;
  });

  /** Tiny dependency-free inline bar chart for an aggregate slot's numeric series. */
  const renderChart = (series) => {
    if (!series.length) return null;
    const W = 280, Hh = 56, n = series.length;
    const max = Math.max(...series.map(d => d.value), 1), min = Math.min(...series.map(d => d.value), 0);
    const range = (max - min) || 1, bw = W / n;
    return html`<svg class="pf-ld-chart" viewBox="0 0 ${W} ${Hh}" width="100%" height=${Hh} preserveAspectRatio="none">
      ${series.map((d, i) => { const h = ((d.value - min) / range) * (Hh - 8) + 4; return html`<rect key=${i} x=${i * bw + 1} y=${Hh - h} width=${Math.max(1, bw - 2)} height=${h}><title>${escHtml(d.label)}: ${d.value}</title></rect>`; })}
    </svg>`;
  };

  function orgName(id) { return orgs.find(o => o.id === id)?.name || id; }

  // ── Render: template editor ──

  const renderEditor = () => html`
    <div class="pf-ld-editor">
      <div class="section-title pf-nb-section">${editing.id && templates?.some(x => x.id === editing.id) ? t('profile.living.editTemplate') : t('profile.living.newTemplate')}</div>
      <label class="pf-nb-suggest-label">${t('profile.living.fieldTitle')}</label>
      <input class="input-field" value=${editing.title} onInput=${e => patchEditing({ title: e.target.value })} />
      <label class="pf-nb-suggest-label">${t('profile.living.fieldDescription')}</label>
      <input class="input-field" value=${editing.description} onInput=${e => patchEditing({ description: e.target.value })} />
      <label class="pf-nb-suggest-label">${t('profile.living.fieldScope')}</label>
      <textarea class="input-field" rows="2" value=${editing.charter?.scope || ''}
        onInput=${e => patchEditing({ charter: { ...editing.charter, scope: e.target.value } })}></textarea>

      <div class="pf-ld-charter-views">
        <span class="text-meta-sm">${t('profile.living.charter')}:</span>
        <button class="btn-ghost btn-sm ${charterView === 'readable' ? 'pf-ld-cv-active' : ''}" onClick=${() => setCharterView(v => v === 'readable' ? null : 'readable')}>${t('profile.living.charterReadable')}</button>
        <button class="btn-ghost btn-sm ${charterView === 'yaml' ? 'pf-ld-cv-active' : ''}" onClick=${() => setCharterView(v => v === 'yaml' ? null : 'yaml')}>${t('profile.living.charterYaml')}</button>
      </div>
      ${charterView === 'readable' && html`<div class="pf-ld-charter-box"><${Markdown} text=${editing.charterReadable || editing.charter?.scope || t('profile.living.charterEmpty')} /></div>`}
      ${charterView === 'yaml' && html`<pre class="pf-ld-charter-box pf-ld-yaml">${escHtml(living.charterToYaml(editing.charter || {}))}</pre>`}

      <div class="pf-nb-suggest-label">${t('profile.living.automation')}</div>
      <div class="pf-ld-automation">
        <label class="text-meta-sm">${t('profile.living.trust')}:
          <select class="pf-ld-cadence" value=${editing.charter?.trust?.derive || 'auto'} onChange=${e => setTrust(e.target.value)}>
            <option value="auto">${t('profile.living.trustAuto')}</option>
            <option value="gated">${t('profile.living.trustGated')}</option>
          </select>
        </label>
        <label class="text-meta-sm">${t('profile.living.activityTrigger')}:
          <input type="number" min="0" class="input-field pf-ld-num" value=${activityThreshold(editing)} onInput=${e => setActivityTrigger(e.target.value)} />
        </label>
      </div>

      <div class="pf-nb-suggest-label">${t('profile.living.sections')}</div>
      <div class="pf-ld-slots">
        ${editing.template.map((s, i) => html`
          <div class="pf-ld-slot-row" key=${i}>
            <input class="input-field" placeholder=${t('profile.living.sectionName')} value=${s.section} onInput=${e => patchSlot(i, { section: e.target.value })} />
            <input class="input-field" placeholder=${t('profile.living.sectionDesc')} value=${s.desc} onInput=${e => patchSlot(i, { desc: e.target.value })} />
            <input class="input-field pf-ld-slot-id" placeholder="slot-id" value=${s.slot} onInput=${e => patchSlot(i, { slot: e.target.value })} />
            <button class="btn-ghost btn-sm" onClick=${() => removeSlot(i)}>✕</button>
          </div>`)}
      </div>
      <button class="btn-ghost btn-sm" onClick=${addSlot}>＋ ${t('profile.living.addSection')}</button>

      <div class="pf-nb-suggest-actions">
        <button class="btn-primary" disabled=${busy} onClick=${saveEditing}>${t('profile.living.saveTemplate')}</button>
        <button class="btn-ghost btn-sm" onClick=${() => setEditing(null)}>${t('profile.notebook.cancelBtn')}</button>
      </div>
    </div>`;

  // ── Render: deploy panel ──

  const renderDeploy = () => html`
    <div class="pf-ld-editor">
      <div class="section-title pf-nb-section">${t('profile.living.deployTitle').replace('{title}', deploying.template.title)}</div>
      ${orgs.length === 0
        ? html`<div class="empty">${t('profile.living.noOrgs')}</div>`
        : html`
          <label class="pf-nb-suggest-label">${t('profile.living.organism')}</label>
          <select class="input-field" value=${deploying.orgId} onChange=${e => pickDeployOrg(e.target.value)}>
            ${orgs.map(o => html`<option key=${o.id} value=${o.id}>${escHtml(o.name)}</option>`)}
          </select>
          <label class="pf-nb-suggest-label">${t('profile.living.workspace')}</label>
          ${deploying.workspaces.length === 0
            ? html`<div class="empty">${t('profile.living.noWorkspaces')}</div>`
            : html`<select class="input-field" value=${deploying.wsId} onChange=${e => setDeploying(d => ({ ...d, wsId: e.target.value }))}>
                ${deploying.workspaces.map(w => html`<option key=${w.id} value=${w.id}>${escHtml(w.name || w.id)}</option>`)}
              </select>`}`}
      <div class="pf-nb-suggest-actions">
        <button class="btn-primary" disabled=${busy || !deploying.orgId || !deploying.wsId} onClick=${confirmDeploy}>${t('profile.living.deployBtn')}</button>
        <button class="btn-ghost btn-sm" onClick=${() => setDeploying(null)}>${t('profile.notebook.cancelBtn')}</button>
      </div>
    </div>`;

  // ── Render: instance viewer ──

  const renderOpened = () => {
    const md = living.renderInstanceMarkdown(opened);
    const st = opened.config.status || {};
    const lastPulse = st.last_pulse ? new Date(st.last_pulse).toLocaleString() : t('profile.living.never');
    return html`
      <div class="pf-ld-editor">
        <div class="pf-ld-opened-head">
          <div class="section-title">${escHtml(opened.config.title)}</div>
          <div class="pf-ld-card-btns">
            <button class="btn-primary btn-sm" disabled=${pulsing} onClick=${handlePulse}>${pulsing ? t('profile.living.pulsing') : `↻ ${t('profile.living.pulseNow')}`}</button>
            <button class="btn-outline btn-sm" onClick=${togglePause}>${st.paused ? t('profile.living.resume') : t('profile.living.pause')}</button>
            <button class="btn-outline btn-sm" onClick=${handleSaveSnapshot}>${t('profile.living.saveSnapshot')}</button>
            <button class="btn-ghost btn-sm" onClick=${() => setOpened(null)}>${t('profile.living.backToList')}</button>
          </div>
        </div>
        <div class="text-meta-sm pf-ld-status">
          ${orgName(opened.loc.orgId)} · ${escHtml(opened.loc.wsId)} · v${st.version || 1}
          · ${t('profile.living.lastPulse')}: ${lastPulse}
          · ${t('profile.living.cost')}: $${(st.cost || 0).toFixed(4)}
          ${st.paused && html`· <span class="badge badge-warning">${t('profile.living.paused')}</span>`}
          ${st.health === 'retired' && html`· <span class="badge badge-danger">${t('profile.living.retired')}: ${escHtml(st.retired_reason || '')}</span>`}
          · ${t('profile.living.cadence')}:
          <select class="pf-ld-cadence" value=${opened.config.charter?.cadence || 'daily'} onChange=${e => changeCadence(e.target.value)}>
            <option value="hourly">${t('profile.living.cadenceHourly')}</option>
            <option value="daily">${t('profile.living.cadenceDaily')}</option>
            <option value="weekly">${t('profile.living.cadenceWeekly')}</option>
          </select>
        </div>

        <div class="pf-nb-enrich-preview-body pf-ld-preview"><${Markdown} text=${md} /></div>

        <div class="pf-nb-suggest-label">${t('profile.living.sections')}</div>
        ${(opened.config.template || []).map(sec => {
          const der = opened.slots[sec.slot];
          const slotSources = opened.sources.filter(s => s.slot === sec.slot);
          const phase = pulseStatus[sec.slot];
          const versions = opened.history?.[sec.slot] || [];
          const pickedVer = picked[sec.slot];
          const series = sec.kind === 'aggregate' ? living.aggregateData(opened.sources, sec.slot) : [];
          return html`
            <div class="pf-ld-slot-edit" key=${sec.slot}>
              <div class="pf-ld-slot-edit-head">
                <strong>${escHtml(sec.section || sec.slot)}</strong>
                <span class="text-meta-sm">${escHtml(sec.desc || '')}</span>
                ${sec.agent && html`<span class="badge badge-info">→ ${escHtml(String(sec.agent).split('/')[0])}</span>`}
                ${phase && html`<span class="text-meta-sm pf-ld-phase">${escHtml(phase)}</span>`}
              </div>
              ${versions.length > 1 && html`
                <div class="pf-ld-timeline">
                  <span class="text-meta-sm">${t('profile.living.timeline')}:</span>
                  <select class="pf-ld-cadence" value=${pickedVer ? String(versions.indexOf(pickedVer)) : ''} onChange=${e => pickVersion(sec.slot, e.target.value)}>
                    <option value="">${t('profile.living.versionCurrent')}</option>
                    ${versions.map((v, i) => html`<option key=${i} value=${i}>${new Date(v.producedAt).toLocaleString()} · ${escHtml(v.producedBy || '')}</option>`)}
                  </select>
                </div>
                ${pickedVer && html`<div class="pf-ld-charter-box"><${Markdown} text=${pickedVer.markdown} /></div>`}`}
              ${sec.kind === 'aggregate' && html`
                <div class="pf-ld-aggregate">
                  ${series.length ? renderChart(series) : html`<span class="text-meta-sm">${t('profile.living.noData')}</span>`}
                  <div class="pf-ld-slot-sources">
                    <input class="input-field" placeholder=${t('profile.living.dpLabel')} id=${'dp-l-' + sec.slot} />
                    <input class="input-field pf-ld-num" type="number" placeholder=${t('profile.living.dpValue')} id=${'dp-v-' + sec.slot}
                      onKeyDown=${e => { if (e.key === 'Enter') submitDp(sec.slot); }} />
                    <button class="btn-ghost btn-sm" onClick=${() => submitDp(sec.slot)}>${t('profile.living.addPoint')}</button>
                  </div>
                </div>`}
              <textarea class="input-field" rows="3" placeholder=${t('profile.living.sectionContentPh')}
                value=${der?.markdown || ''} onChange=${e => saveSlot(sec.slot, e.target.value)}></textarea>
              ${opened.pending?.[sec.slot] && html`
                <div class="pf-ld-pending">
                  <div class="text-meta-sm">⏳ ${t('profile.living.pendingTitle')}</div>
                  <div class="pf-nb-enrich-preview-body pf-ld-pending-body"><${Markdown} text=${opened.pending[sec.slot].markdown} /></div>
                  <div class="pf-ld-card-btns">
                    <button class="btn-success btn-sm" onClick=${() => approveSlot(sec.slot)}>${t('profile.living.approve')}</button>
                    <button class="btn-danger btn-sm" onClick=${() => rejectSlot(sec.slot)}>${t('profile.living.reject')}</button>
                  </div>
                </div>`}
              <div class="pf-ld-slot-sources">
                <input class="input-field" placeholder=${t('profile.living.addSourcePh')}
                  onKeyDown=${e => { if (e.key === 'Enter') { addSourceTo(sec.slot, e.target.value); e.target.value = ''; } }} />
                <button class="btn-ghost btn-sm" onClick=${() => composeSlot(sec.slot)}>${t('profile.living.compose')}</button>
                ${slotSources.length > 0 && html`<span class="text-meta-sm">${slotSources.length} ${t('profile.living.sources')}</span>`}
              </div>
            </div>`;
        })}

        ${ledger.length > 0 && html`
          <div class="pf-nb-suggest-label">${t('profile.living.ledgerTitle')}</div>
          <ul class="pf-ld-ledger">
            ${ledger.slice(0, 10).map((ev, i) => html`<li key=${i} class="text-meta-sm">${new Date(ev.at).toLocaleString()} — ${escHtml(ev.event)}${ev.slot ? ` · ${escHtml(ev.slot)}` : ''}${typeof ev.costUsd === 'number' ? ` · $${ev.costUsd.toFixed(4)}` : ''}</li>`)}
          </ul>`}
      </div>`;
  };

  // ── Render: main ──

  return html`
    ${ConfirmUI}
    <div class="section-title">${t('profile.living.title')}</div>
    <div class="section-desc">${t('profile.living.desc')}</div>

    ${opened ? renderOpened() : html`
      ${deploying && renderDeploy()}
      ${editing && renderEditor()}

      ${!editing && !deploying && html`
        <div class="section-title pf-nb-section">${t('profile.living.templatesTitle')}</div>
        <div class="section-desc">${t('profile.living.templatesDesc')}</div>
        <div class="pf-ld-author">
          <textarea class="input-field" rows="2" placeholder=${t('profile.living.authorPh')}
            value=${need} onInput=${e => setNeed(e.target.value)}></textarea>
          <button class="btn-primary btn-sm" disabled=${!need.trim() || authoring} onClick=${handleAuthor}>
            ${authoring ? t('profile.living.authoring') : `✨ ${t('profile.living.authorBtn')}`}
          </button>
        </div>
        <button class="btn-outline btn-sm" onClick=${newTemplate}>＋ ${t('profile.living.newTemplate')}</button>
        ${templates === null
          ? html`<${Spinner} text=${t('profile.living.loading')} />`
          : templates.length === 0
            ? html`<div class="empty">${t('profile.living.noTemplates')}</div>`
            : html`<div class="pf-ld-list">
                ${templates.map(tpl => html`
                  <div class="pf-ld-card" key=${tpl.id}>
                    <div class="pf-ld-card-head">
                      <span class="pf-nb-hit-title">${escHtml(tpl.title || t('profile.living.untitled'))}</span>
                      <span class="text-meta-sm">${(tpl.template || []).length} ${t('profile.living.sectionsShort')}</span>
                    </div>
                    ${tpl.description && html`<div class="text-meta-sm">${escHtml(tpl.description)}</div>`}
                    <div class="pf-ld-card-btns">
                      <button class="btn-primary btn-sm" onClick=${() => startDeploy(tpl)}>${t('profile.living.deploy')}</button>
                      <button class="btn-outline btn-sm" onClick=${() => setEditing({ ...tpl })}>${t('profile.living.edit')}</button>
                      <button class="btn-danger btn-sm" onClick=${() => deleteTpl(tpl)}>${t('profile.notebook.deleteBtn')}</button>
                    </div>
                  </div>`)}
              </div>`}

        <div class="section-title pf-nb-section">${t('profile.living.instancesTitle')}</div>
        <div class="section-desc">${t('profile.living.instancesDesc')}</div>
        ${instances === null
          ? html`<${Spinner} text=${t('profile.living.loading')} />`
          : instances.length === 0
            ? html`<div class="empty">${t('profile.living.noInstances')}</div>`
            : html`<div class="pf-ld-list">
                ${instances.map(inst => html`
                  <div class="pf-ld-card" key=${inst.loc.docId}>
                    <div class="pf-ld-card-head">
                      <span class="pf-nb-hit-title">${escHtml(inst.config.title)}</span>
                      <span class="badge badge-info">${escHtml(orgName(inst.loc.orgId))}</span>
                    </div>
                    <div class="text-meta-sm">
                      v${inst.config.status?.version || 1} ·
                      ${t('profile.living.lastPulse')}: ${inst.config.status?.last_pulse ? new Date(inst.config.status.last_pulse).toLocaleString() : t('profile.living.never')} ·
                      ${t('profile.living.cost')}: $${(inst.config.status?.cost || 0).toFixed(4)}
                      ${inst.config.status?.paused && html` · <span class="badge badge-warning">${t('profile.living.paused')}</span>`}
                    </div>
                    <div class="pf-ld-card-btns">
                      <button class="btn-primary btn-sm" onClick=${() => openInstance(inst.loc)}>${t('profile.living.open')}</button>
                    </div>
                  </div>`)}
              </div>`}
      `}
    `}
  `;
}
