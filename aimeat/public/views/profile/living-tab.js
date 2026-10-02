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
 *   v1.23.0 -- 2026-10-02 -- The question marks that explain the automation fields: living.trust, living.activity_trigger (components/HelpTip.js).
 *   v1.22.2 -- 2026-09-28 -- No escHtml() on text preact renders: preact escapes text and attributes
 *     itself, so a template or instance title, a section name, an organism name or the charter YAML
 *     with a quote or an ampersand showed as &quot; / &amp;.
 *   v1.22.1 -- 2026-09-26 -- The ledger is a list again (Stack list: ul/li, as main's .pf-ld-ledger),
 *     so a screen reader hears a list (fix pass).
 *   v1.22.0 -- 2026-09-26 -- Every part is a component that gets data; the page writes no class (page group G4):
 *     the frame is SettingsPage, the editor, the deploy panel and the opened document are Sections, the
 *     fields are TextField, TextArea and Select (their labels over them), the lists are the List, the
 *     previews are the Box (copy ground, the document option), a proposal that waits for a yes is the
 *     Box's waiting tone, the aggregate's bars are SeriesBars (moved out of renderChart), the rows of
 *     parts are Layout's Row and Stack, and css/views/living.css goes. The loading line is the Note's
 *     loading kind through the List (main's Spinner, the branch's LoadingLine). The typed source and
 *     data point are kept in state, since a component's field is controlled; they empty when a
 *     document opens, as the recreated fields did.
 *   v1.21.0 -- 2026-09-26 -- The charter as YAML is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.20.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.19.0 -- 2026-09-26 -- The templates and the deployed living documents are the Listing (css/components/listing.css; name-desc-doors and name-desc-who-doors), not classic cards (a unification: the look most tabs use).
 *   v1.18.0 -- 2026-09-26 -- A section's pulse phase ("searching", "done") is the Status (.poster-status: attention while it runs, fine when done, danger when it failed), a unification: Jouni's decision "Status".
 *   v1.17.0 -- 2026-09-26 -- The charter's Readable and YAML buttons show a panel and stay pressed while it shows: the Tab's fold tone (.poster-tab--fold, .is-on, aria-pressed), a unification: Jouni's decision "Tabs and filters".
 *   v1.16.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.15.0 -- 2026-09-25 -- The labels over a living document's fields and sections are the row label (.poster-label) (Jouni's decision "Row label", a unification).
 *   v1.14.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.14.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.14.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.13.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.13.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- The crumb is the full trail (Settings & Controls / the menu group / the tab), as in the kit tabs (a unification).
 *   v1.10.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.9.0 -- 2026-09-25 -- A section is the kit's section (PageSection in an .og page) and the line under its title is the lead (.og-lead), the look most tabs use (a unification).
 *   v1.8.0 -- 2026-09-25 -- The page head is the kit's crumb trail and page head (.og-crumb, .og-mast, .og-title, .og-desc), the look most tabs use (a unification).
 *   v1.7.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.6.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.5.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.4.0 — 2026-09-25 — A button that is a mark, not a word (a delete or close mark, a menu's dots,
 *     an arrow), is the library's small icon button, .poster-icon.poster-icon--small (Jouni's decision
 *     "Icon button").
 *   v1.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { Markdown } from '/components/Markdown.js';
import { useConfirm } from '/components/Modal.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { Action, Actions, Loud, Icon } from '/components/Action.js';
import { Mark, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { List, Row, Name, Desc, Who, Doors } from '/components/List.js';
import { Row as Line, Stack, Split } from '/components/Layout.js';
import { Field, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Tab } from '/components/Tabs.js';
import { SeriesBars } from '/components/SeriesBars.js';
import * as living from '/js/services/living.js';
import { listOrganisms, listWorkspaces } from '/js/services/organisms.js';
import * as offersService from '/js/services/offers.js';
import { buildCatalogue } from '/js/services/notebook-plan.js';
import { swallowed } from '/js/swallowed.js';
import { dateTime as fmtDateTime } from '/js/format.js';

/** A section's pulse phase says a state, so it is the Status: done is fine, a failure danger, a
 *  step still running needs a look (attention). */
const phaseTone = (phase) => {
  const p = String(phase).toLowerCase();
  if (p === 'done' || p === 'completed') return 'fine';
  if (/fail|error|cancel|reject/.test(p)) return 'danger';
  return 'attention';
};

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
  const [drafts, setDrafts] = useState({});           // 'src:'|'dpl:'|'dpv:' + slotId → typed, not yet added
  const draft = (k) => drafts[k] || '';
  const setDraft = (k, v) => setDrafts(d => ({ ...d, [k]: v }));

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
    setDrafts({});
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
  async function submitDp(slot) {
    const label = draft('dpl:' + slot), value = draft('dpv:' + slot);
    if (!value) return;
    await addDataPoint(slot, label, value);
    setDrafts(d => ({ ...d, ['dpl:' + slot]: '', ['dpv:' + slot]: '' }));
  }
  const pickVersion = (slotId, idx) => setPicked(p => {
    const next = { ...p };
    if (idx === '') delete next[slotId]; else next[slotId] = opened.history?.[slotId]?.[Number(idx)];
    return next;
  });

  function orgName(id) { return orgs.find(o => o.id === id)?.name || id; }

  // ── Render: template editor ──

  const renderEditor = () => html`
    <${Section} band title=${editing.id && templates?.some(x => x.id === editing.id) ? t('profile.living.editTemplate') : t('profile.living.newTemplate')}>
      <${Stack}>
        <${TextField} label=${t('profile.living.fieldTitle')} value=${editing.title} onInput=${v => patchEditing({ title: v })} />
        <${TextField} label=${t('profile.living.fieldDescription')} value=${editing.description} onInput=${v => patchEditing({ description: v })} />
        <${TextArea} label=${t('profile.living.fieldScope')} rows=${2} value=${editing.charter?.scope || ''}
          onInput=${v => patchEditing({ charter: { ...editing.charter, scope: v } })} />

        <${Line}>
          <${Note} kind="meta" inline>${t('profile.living.charter')}:<//>
          <${Tab} tone="fold" on=${charterView === 'readable'} pressed=${charterView === 'readable'} onClick=${() => setCharterView(v => v === 'readable' ? null : 'readable')}>${t('profile.living.charterReadable')}<//>
          <${Tab} tone="fold" on=${charterView === 'yaml'} pressed=${charterView === 'yaml'} onClick=${() => setCharterView(v => v === 'yaml' ? null : 'yaml')}>${t('profile.living.charterYaml')}<//>
        <//>
        ${charterView === 'readable' && html`<${Box} tone="copy" document><${Markdown} text=${editing.charterReadable || editing.charter?.scope || t('profile.living.charterEmpty')} /><//>`}
        ${charterView === 'yaml' && html`<${Code} block>${living.charterToYaml(editing.charter || {})}<//>`}

        <${Label} block>${t('profile.living.automation')}<//>
        <${Line} wrap gap="large" align="end">
          <${Select} label=${t('profile.living.trust')} help="living.trust" fit value=${editing.charter?.trust?.derive || 'auto'} onChange=${v => setTrust(v)}
            options=${[['auto', t('profile.living.trustAuto')], ['gated', t('profile.living.trustGated')]]} />
          <${TextField} label=${t('profile.living.activityTrigger')} help="living.activity_trigger" type="number" min="0" size="short"
            value=${activityThreshold(editing)} onInput=${v => setActivityTrigger(v)} />
        <//>

        <${Label} block>${t('profile.living.sections')}<//>
        <${Stack}>
          ${editing.template.map((s, i) => html`
            <${TextField} key=${i} placeholder=${t('profile.living.sectionName')} value=${s.section} onInput=${v => patchSlot(i, { section: v })}
              actions=${html`
                <${TextField} placeholder=${t('profile.living.sectionDesc')} value=${s.desc} onInput=${v => patchSlot(i, { desc: v })} />
                <${TextField} size="short" placeholder="slot-id" value=${s.slot} onInput=${v => patchSlot(i, { slot: v })} />
                <${Icon} small label=${t('field.remove')} onClick=${() => removeSlot(i)}>✕<//>`} />`)}
        <//>
        <${Line}><${Action} small onClick=${addSlot}>＋ ${t('profile.living.addSection')}<//><//>

        <${FormActions}>
          <${Loud} control disabled=${busy} onClick=${saveEditing}>${t('profile.living.saveTemplate')}<//>
          <${Action} small onClick=${() => setEditing(null)}>${t('profile.notebook.cancelBtn')}<//>
        <//>
      <//>
    <//>`;

  // ── Render: deploy panel ──

  const renderDeploy = () => html`
    <${Section} band title=${t('profile.living.deployTitle').replace('{title}', deploying.template.title)}>
      <${Stack}>
        ${orgs.length === 0
          ? html`<${Note} kind="quiet">${t('profile.living.noOrgs')}<//>`
          : html`
            <${Select} label=${t('profile.living.organism')} value=${deploying.orgId} onChange=${v => pickDeployOrg(v)}
              options=${orgs.map(o => [o.id, o.name])} />
            ${deploying.workspaces.length === 0
              ? html`<${Field} label=${t('profile.living.workspace')}><${Note} kind="quiet">${t('profile.living.noWorkspaces')}<//><//>`
              : html`<${Select} label=${t('profile.living.workspace')} value=${deploying.wsId} onChange=${v => setDeploying(d => ({ ...d, wsId: v }))}
                  options=${deploying.workspaces.map(w => [w.id, w.name || w.id])} />`}`}
        <${FormActions}>
          <${Loud} control disabled=${busy || !deploying.orgId || !deploying.wsId} onClick=${confirmDeploy}>${t('profile.living.deployBtn')}<//>
          <${Action} small onClick=${() => setDeploying(null)}>${t('profile.notebook.cancelBtn')}<//>
        <//>
      <//>
    <//>`;

  // ── Render: instance viewer ──

  const renderOpened = () => {
    const md = living.renderInstanceMarkdown(opened);
    const st = opened.config.status || {};
    const lastPulse = st.last_pulse ? fmtDateTime(st.last_pulse) : t('profile.living.never');
    return html`
      <${Section} band title=${opened.config.title} doors=${html`
        <${Loud} control disabled=${pulsing} onClick=${handlePulse}>${pulsing ? t('profile.living.pulsing') : `↻ ${t('profile.living.pulseNow')}`}<//>
        <${Action} small onClick=${togglePause}>${st.paused ? t('profile.living.resume') : t('profile.living.pause')}<//>
        <${Action} small onClick=${handleSaveSnapshot}>${t('profile.living.saveSnapshot')}<//>
        <${Action} tone="back" onClick=${() => setOpened(null)}>${t('profile.living.backToList')}<//>`}>
      <${Stack}>
        <${Line} wrap>
          <${Note} kind="meta" inline>
            ${orgName(opened.loc.orgId)} · ${opened.loc.wsId} · v${st.version || 1}
            · ${t('profile.living.lastPulse')}: ${lastPulse}
            · ${t('profile.living.cost')}: $${(st.cost || 0).toFixed(4)}
          <//>
          ${st.paused && html`<${Note} kind="meta" inline>·<//><${Mark} kind="status" tone="attention">${t('profile.living.paused')}<//>`}
          ${st.health === 'retired' && html`<${Note} kind="meta" inline>·<//><${Mark} kind="status" tone="danger">${t('profile.living.retired')}: ${st.retired_reason || ''}<//>`}
          <${Note} kind="meta" inline>· ${t('profile.living.cadence')}:<//>
          <${Select} fit ariaLabel=${t('profile.living.cadence')} value=${opened.config.charter?.cadence || 'daily'} onChange=${v => changeCadence(v)}
            options=${[['hourly', t('profile.living.cadenceHourly')], ['daily', t('profile.living.cadenceDaily')], ['weekly', t('profile.living.cadenceWeekly')]]} />
        <//>

        <${Box} tone="copy" scroll document><${Markdown} text=${md} /><//>

        <${Label} block>${t('profile.living.sections')}<//>
        ${(opened.config.template || []).map(sec => {
          const der = opened.slots[sec.slot];
          const slotSources = opened.sources.filter(s => s.slot === sec.slot);
          const phase = pulseStatus[sec.slot];
          const versions = opened.history?.[sec.slot] || [];
          const pickedVer = picked[sec.slot];
          const series = sec.kind === 'aggregate' ? living.aggregateData(opened.sources, sec.slot) : [];
          const dpl = 'dpl:' + sec.slot, dpv = 'dpv:' + sec.slot, src = 'src:' + sec.slot;
          return html`
            <${Split} key=${sec.slot} gap="small">
              <${Line} gap="medium" align="baseline">
                <strong>${sec.section || sec.slot}</strong>
                <${Note} kind="meta" inline>${sec.desc || ''}<//>
                ${sec.agent && html`<${Mark}>→${String(sec.agent).split('/')[0]}<//>`}
                ${phase && html`<${Mark} kind="status" tone=${phaseTone(phase)}>${phase}<//>`}
              <//>
              ${versions.length > 1 && html`
                <${Line}>
                  <${Note} kind="meta" inline>${t('profile.living.timeline')}:<//>
                  <${Select} fit ariaLabel=${t('profile.living.timeline')} value=${pickedVer ? String(versions.indexOf(pickedVer)) : ''}
                    onChange=${v => pickVersion(sec.slot, v)} placeholder=${t('profile.living.versionCurrent')}
                    options=${versions.map((v, i) => [String(i), `${fmtDateTime(v.producedAt)} · ${v.producedBy || ''}`])} />
                <//>
                ${pickedVer && html`<${Box} tone="copy" document><${Markdown} text=${pickedVer.markdown} /><//>`}`}
              ${sec.kind === 'aggregate' && html`
                <${Stack}>
                  ${series.length
                    ? html`<${SeriesBars} series=${series.map(d => ({ label: d.label, value: d.value }))} />`
                    : html`<${Note} kind="quiet">${t('profile.living.noData')}<//>`}
                  <${TextField} placeholder=${t('profile.living.dpLabel')} value=${draft(dpl)} onInput=${v => setDraft(dpl, v)}
                    actions=${html`
                      <${TextField} type="number" size="short" placeholder=${t('profile.living.dpValue')} value=${draft(dpv)}
                        onInput=${v => setDraft(dpv, v)} onEnter=${() => submitDp(sec.slot)} />
                      <${Action} small onClick=${() => submitDp(sec.slot)}>${t('profile.living.addPoint')}<//>`} />
                <//>`}
              <${TextArea} rows=${3} placeholder=${t('profile.living.sectionContentPh')}
                value=${der?.markdown || ''} onChange=${v => saveSlot(sec.slot, v)} />
              ${opened.pending?.[sec.slot] && html`
                <${Box} tone="waiting" doors=${html`
                  <${Action} small onClick=${() => approveSlot(sec.slot)}>${t('profile.living.approve')}<//>
                  <${Action} small tone="danger" onClick=${() => rejectSlot(sec.slot)}>${t('profile.living.reject')}<//>`}>
                  <${Note} kind="meta">⏳ ${t('profile.living.pendingTitle')}<//>
                  <${Box} tone="copy" scroll document><${Markdown} text=${opened.pending[sec.slot].markdown} /><//>
                <//>`}
              <${TextField} placeholder=${t('profile.living.addSourcePh')} value=${draft(src)} onInput=${v => setDraft(src, v)}
                onEnter=${v => { addSourceTo(sec.slot, v); setDraft(src, ''); }}
                actions=${html`
                  <${Action} small onClick=${() => composeSlot(sec.slot)}>${t('profile.living.compose')}<//>
                  ${slotSources.length > 0 && html`<${Note} kind="meta" inline>${slotSources.length} ${t('profile.living.sources')}<//>`}`} />
            <//>`;
        })}

        ${ledger.length > 0 && html`
          <${Label} block>${t('profile.living.ledgerTitle')}<//>
          <${Stack} gap="tight" list>
            ${ledger.slice(0, 10).map((ev, i) => html`<${Note} key=${i} kind="meta">${fmtDateTime(ev.at)} — ${ev.event}${ev.slot ? ` · ${ev.slot}` : ''}${typeof ev.costUsd === 'number' ? ` · $${ev.costUsd.toFixed(4)}` : ''}<//>`)}
          <//>`}
      <//>
      <//>`;
  };

  // ── Render: main ──

  return html`
    <${SettingsPage} crumb=${[t('nav.profile'), t('profile.landing.menuInformation'), t('profile.tabs.living')]}
      title=${t('profile.living.title')} desc=${t('profile.living.desc')} after=${ConfirmUI}>
    ${opened ? renderOpened() : html`
      ${deploying && renderDeploy()}
      ${editing && renderEditor()}

      ${!editing && !deploying && html`
        <${Section} band title=${t('profile.living.templatesTitle')}>
          <${Note} kind="lead">${t('profile.living.templatesDesc')}<//>
          <${Stack} above="medium" below="medium">
            <${TextArea} rows=${2} placeholder=${t('profile.living.authorPh')} value=${need} onInput=${v => setNeed(v)} />
            <${Line}>
              <${Loud} control disabled=${!need.trim() || authoring} onClick=${handleAuthor}>
                ${authoring ? t('profile.living.authoring') : `✨ ${t('profile.living.authorBtn')}`}
              <//>
            <//>
          <//>
          <${Actions}><${Action} small onClick=${newTemplate}>＋ ${t('profile.living.newTemplate')}<//><//>
          <${List} cols="name-desc-doors" apart loading=${templates === null ? t('profile.living.loading') : false}
            empty=${t('profile.living.noTemplates')}>
            ${(templates || []).map(tpl => html`
              <${Row} key=${tpl.id}>
                <${Name}>${tpl.title || t('profile.living.untitled')}<//>
                <${Desc}>
                  ${tpl.description && html`<div>${tpl.description}</div>`}
                  <div>${(tpl.template || []).length} ${t('profile.living.sectionsShort')}</div>
                <//>
                <${Doors}>
                  <${Loud} control onClick=${() => startDeploy(tpl)}>${t('profile.living.deploy')}<//>
                  <${Action} small row onClick=${() => setEditing({ ...tpl })}>${t('profile.living.edit')}<//>
                  <${Action} small row tone="danger" onClick=${() => deleteTpl(tpl)}>${t('profile.notebook.deleteBtn')}<//>
                <//>
              <//>`)}
          <//>
        <//>

        <${Section} band title=${t('profile.living.instancesTitle')}>
          <${Note} kind="lead">${t('profile.living.instancesDesc')}<//>
          <${List} cols="name-desc-who-doors" apart loading=${instances === null ? t('profile.living.loading') : false}
            empty=${t('profile.living.noInstances')}>
            ${(instances || []).map(inst => html`
              <${Row} key=${inst.loc.docId}>
                <${Name}>${inst.config.title}<//>
                <${Desc}>
                  v${inst.config.status?.version || 1} ·
                  ${t('profile.living.lastPulse')}: ${inst.config.status?.last_pulse ? fmtDateTime(inst.config.status.last_pulse) : t('profile.living.never')} ·
                  ${t('profile.living.cost')}: $${(inst.config.status?.cost || 0).toFixed(4)}
                  ${inst.config.status?.paused && html` · <${Mark} kind="status" tone="attention">${t('profile.living.paused')}<//>`}
                <//>
                <${Who}><${Mark}>${orgName(inst.loc.orgId)}<//><//>
                <${Doors}>
                  <${Loud} control onClick=${() => openInstance(inst.loc)}>${t('profile.living.open')}<//>
                <//>
              <//>`)}
          <//>
        <//>
      `}
    `}
    <//>
  `;
}
