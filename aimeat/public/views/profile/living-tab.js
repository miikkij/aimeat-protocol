/**
 * @file living-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile "Document templates" tab (living documents). Two areas: a personal TEMPLATE
 *   collection (create/edit/delete reusable charter+template skeletons) and the DEPLOYED instances (a
 *   template deployed into a workspace, rendered as living markdown). "Pulse now" refreshes an open
 *   document here; the server's living-pulse core job (services/living-pulse.ts) refreshes the
 *   sections no agent fills on each document's cadence with nobody present. How the page explains
 *   itself (.claude/rules/page-guidance.md): PageStart "living" under the head and the title's
 *   question mark concept.living_document. See docs/plans/2026-06-21-living-documents-plan.md.
 * @structure LivingTab (default export) — templates list/editor + deploy + instances list/viewer
 * @usage html`<${LivingTab} session=${session} showToast=${showToast} />`
 * @version-history
 *   v1.28.0 -- 2026-11-27 -- Why a document stopped is a sentence in the person's language
 *     (stopSentence); the server's English reason stays in the mark's title and one line under the
 *     opened document's facts. The documents and the templates lists have a head row.
 *   v1.27.1 -- 2026-11-27 -- A template section's remove draws the close Glyph instead of the ✕ letter;
 *     Pulse now draws the refresh Glyph instead of ↻.
 *   v1.27.0 -- 2026-11-27 -- The list view leads with where things stand: a figure strip (living documents, documents that stopped updating in the notice tone, templates) from the overview it already reads, not drawn while all three are zero (FigureStrip hideZeros). The deployed documents are section 01 (lv-docs) once one exists, a stopped document first in it with its reason on the row; the templates are 01 or 02 (lv-templates), their list before the Author with AI field, and the contents rail is drawn when both sections are. One loud action at a time: Open on a document; Deploy on a template while no document exists; Author with AI while the page holds nothing (Loud quiet otherwise). The empty templates line says what fills the page and the one way to fill it. The emoji before Author with AI and before a pending proposal's title are gone (no emoji in the interface). No control was removed.
 *   v1.26.0 -- 2026-11-08 -- The settings a label cannot explain carry their question mark: an open
 *     document's cadence (living.cadence, on its word) and a template section's slot id (living.slotId,
 *     beside the field, which has no label of its own) (.claude/rules/page-guidance.md).
 *   v1.25.0 -- 2026-11-08 -- The page explains itself the designed way (.claude/rules/page-guidance.md):
 *     PageStart under the head (folded once a template or a document exists, its button New template)
 *     and the title's question mark concept.living_document. The head's paragraph is two sentences and
 *     no longer says the background refresh is to come: the server pulse runs (the description said
 *     "Phase 0 has no background pulse", which stopped being true with services/living-pulse.ts).
 *   v1.24.0 -- 2026-10-25 -- The open document reads again on the live event, so a pending section
 *     decided elsewhere stops showing Approve and Reject; the two buttons wait while an answer is on its way.
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
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Markdown } from '/components/Markdown.js';
import { useConfirm } from '/components/Modal.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { PageStart } from '/components/PageStart.js';
import { Section } from '/components/Section.js';
import { Action, Actions, Loud, Icon, Glyph } from '/components/Action.js';
import { Mark, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { List, Row, Name, Desc, Who, Doors } from '/components/List.js';
import { Row as Line, Stack, Split } from '/components/Layout.js';
import { Field, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Tab } from '/components/Tabs.js';
import { HelpTip, HelpLabel } from '/components/HelpTip.js';
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

/** Why the pulse stopped a document, in the person's language. The server writes its reason in
 *  English (services/living/pulse.ts evaluateStop: max pulses, end date, a met condition); a reason
 *  it wrote some other way gets the general sentence, and the server's own text stays in the
 *  details (the mark's title, and the line under the opened document's facts). */
function stopSentence(reason) {
  const r = String(reason || '');
  let m = /^reached max pulses \((\d+)\)/i.exec(r);
  if (m) return t('profile.living.stopMax', { n: m[1] });
  m = /^reached end date \((.+)\)/i.exec(r);
  if (m) { const d = new Date(m[1]); return t('profile.living.stopUntil', { date: Number.isNaN(d.getTime()) ? m[1] : fmtDateTime(m[1]) }); }
  m = /^condition met: ([\s\S]*)/i.exec(r);
  if (m) return t('profile.living.stopCondition', { text: m[1].trim() });
  return t('profile.living.stopOther');
}

/** A document that stopped updating (the pulse retired it) waits for its owner, so it comes first. */
const stopped = (inst) => inst.config?.status?.health === 'retired';
const stoppedFirst = (list) => list.map((x, i) => [x, i]).sort(([a, i], [b, j]) => (Number(stopped(b)) - Number(stopped(a))) || i - j).map(([x]) => x);

export default function LivingTab({ session, showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [templates, setTemplates] = useState(null);
  const [instances, setInstances] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [editing, setEditing] = useState(null);     // template being edited (object) | null
  const [deploying, setDeploying] = useState(null);  // { template, orgId, wsId, workspaces[] } | null
  const [opened, setOpened] = useState(null);        // readInstance result | null
  const [busy, setBusy] = useState(false);
  /** The section whose pending answer is on its way (approve or reject), so its buttons wait. */
  const [deciding, setDeciding] = useState(null);
  /** The latest reopen(), for the live handler registered once. */
  const reopenRef = useRef(async () => {});
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
    // The open document reads again too, so a section decided elsewhere shows its result, not its buttons.
    const handler = () => { if (session) { loadAll(); reopenRef.current(); } };
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
  reopenRef.current = reopen;

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
  // One answer at a time: the buttons are off while it is on its way, so a second press cannot follow.
  async function approveSlot(slotId) {
    setDeciding(slotId);
    try { await living.approvePending(opened.loc, slotId, opened.pending?.[slotId]); showToast(t('profile.living.approved')); await reopen(); }
    catch (e) { showToast(e.message || t('profile.error'), true); }
    finally { setDeciding(null); }
  }
  async function rejectSlot(slotId) {
    setDeciding(slotId);
    try { await living.rejectPending(opened.loc, slotId); showToast(t('profile.living.rejected')); await reopen(); }
    catch (e) { showToast(e.message || t('profile.error'), true); }
    finally { setDeciding(null); }
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
                <${HelpTip} term="living.slotId" label="slot-id" />
                <${Icon} small label=${t('field.remove')} onClick=${() => removeSlot(i)}><${Glyph} name="close" /><//>`} />`)}
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
        <${Loud} control disabled=${pulsing} onClick=${handlePulse}>${pulsing ? t('profile.living.pulsing') : html`<${Glyph} name="refresh" /> ${t('profile.living.pulseNow')}`}<//>
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
          ${st.health === 'retired' && html`<${Note} kind="meta" inline>·<//><${Mark} kind="status" tone="danger" title=${st.retired_reason || undefined}>${t('profile.living.retired')}: ${stopSentence(st.retired_reason)}<//>`}
          <${Note} kind="meta" inline>· <${HelpLabel} term="living.cadence" label=${t('profile.living.cadence')}>${t('profile.living.cadence')}<//>:<//>
          <${Select} fit ariaLabel=${t('profile.living.cadence')} value=${opened.config.charter?.cadence || 'daily'} onChange=${v => changeCadence(v)}
            options=${[['hourly', t('profile.living.cadenceHourly')], ['daily', t('profile.living.cadenceDaily')], ['weekly', t('profile.living.cadenceWeekly')]]} />
        <//>
        ${st.health === 'retired' && st.retired_reason && html`<${Note} kind="meta">${t('profile.living.stopDetail', { reason: st.retired_reason })}<//>`}

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
                  <${Action} small disabled=${deciding === sec.slot} onClick=${() => approveSlot(sec.slot)}>${t('profile.living.approve')}<//>
                  <${Action} small tone="danger" disabled=${deciding === sec.slot} onClick=${() => rejectSlot(sec.slot)}>${t('profile.living.reject')}<//>`}>
                  <${Note} kind="meta">${t('profile.living.pendingTitle')}<//>
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

  // The start (page-guidance.md): folded once a template or a document exists; its button is this
  // page's own "New template". An opened document has the page to itself.
  const start = opened ? null : html`<${PageStart} id="living"
    done=${templates === null || instances === null ? null : (templates.length + instances.length) > 0}
    action=${{ onClick: newTemplate }} />`;

  // Where things stand, from the overview the page already read: the deployed documents (and how
  // many are paused), the ones the pulse stopped (they wait for their owner, so the notice tone),
  // and the templates. With nothing on the page the strip is not drawn (hideZeros). An opened
  // document has the page to itself, so the strip is not drawn over it either.
  const loaded = templates !== null && instances !== null;
  const docs = stoppedFirst(instances || []);
  const tpls = templates || [];
  const stoppedN = docs.filter(stopped).length;
  const pausedN = docs.filter(i => i.config?.status?.paused).length;
  const strip = opened ? null : !loaded ? html`<${FigureStrip} loading=${3} />` : html`<${FigureStrip} wrap hideZeros items=${[
    { key: 'docs', n: docs.length, label: t('profile.living.stripDocs'), sub: pausedN ? t('profile.living.stripDocsSub', { n: pausedN }) : undefined },
    { key: 'stopped', n: stoppedN, tone: stoppedN ? 'notice' : undefined, label: t('profile.living.stripStopped'), sub: stoppedN ? t('profile.living.stripStoppedSub') : undefined },
    { key: 'templates', n: tpls.length, label: t('profile.living.stripTemplates') },
  ]} />`;

  // What is drawn in the list view: the deployed documents once one exists (what a person comes back
  // for: open, approve, pause), then the templates, which are always drawn because making one is the
  // way to begin. Numbered after filtering, so a hidden section leaves no gap; the rail only for two.
  const listView = !opened && !editing && !deploying;
  const shown = [
    docs.length ? { id: 'lv-docs', label: t('profile.living.instancesTitle'), count: docs.length } : null,
    { id: 'lv-templates', label: t('profile.living.templatesTitle'), count: templates === null ? undefined : tpls.length },
  ].filter(Boolean).map((s, i) => ({ ...s, num: String(i + 1).padStart(2, '0') }));
  const numOf = Object.fromEntries(shown.map(s => [s.id, s.num]));
  const railed = listView && shown.length > 1;

  // One loud action at a time: Open on a document while one exists; Deploy on a template while no
  // document exists yet; Author with AI while the page holds nothing. The others are drawn quiet
  // (Loud quiet: the same button, as the action link).
  const deployQuiet = docs.length > 0;
  const authorQuiet = docs.length + tpls.length > 0;

  const docsSection = () => html`
    <${Section} band id="lv-docs" num=${numOf['lv-docs']} first title=${t('profile.living.instancesTitle')} count=${docs.length}>
      <${Note} kind="lead">${t('profile.living.instancesDesc')}<//>
      <${List} cols="name-desc-who-doors" apart empty=${t('profile.living.noInstances')}
        head=${docs.length ? [t('profile.living.colDoc'), t('profile.living.colState'), t('profile.living.colWhere'), ''] : null}>
        ${docs.map(inst => html`
          <${Row} key=${inst.loc.docId}>
            <${Name}>${inst.config.title}<//>
            <${Desc}>
              v${inst.config.status?.version || 1} ·
              ${t('profile.living.lastPulse')}: ${inst.config.status?.last_pulse ? fmtDateTime(inst.config.status.last_pulse) : t('profile.living.never')} ·
              ${t('profile.living.cost')}: $${(inst.config.status?.cost || 0).toFixed(4)}
              ${inst.config.status?.paused && html` · <${Mark} kind="status" tone="attention">${t('profile.living.paused')}<//>`}
              ${stopped(inst) && html` · <${Mark} kind="status" tone="danger" title=${inst.config.status?.retired_reason || undefined}>${t('profile.living.retired')}: ${stopSentence(inst.config.status?.retired_reason)}<//>`}
            <//>
            <${Who}><${Mark}>${orgName(inst.loc.orgId)}<//><//>
            <${Doors}>
              <${Action} small row onClick=${() => openInstance(inst.loc)}>${t('profile.living.open')}<//>
            <//>
          <//>`)}
      <//>
    <//>`;

  // The templates: the list first (what the person has), then the field that makes a new one. The
  // lead about Deploy is said once a template exists; with nothing yet, the empty line is the one
  // line the page says.
  const templatesSection = () => html`
    <${Section} band id="lv-templates" num=${numOf['lv-templates']} first=${!docs.length} title=${t('profile.living.templatesTitle')}
      count=${templates === null ? undefined : tpls.length}>
      ${tpls.length > 0 && html`<${Note} kind="lead">${t('profile.living.templatesDesc')}<//>`}
      <${List} cols="name-desc-doors" apart loading=${templates === null ? t('profile.living.loading') : false}
        empty=${t('profile.living.noTemplates')}
        head=${tpls.length ? [t('profile.living.colTemplate'), t('profile.living.colHolds'), ''] : null}>
        ${tpls.map(tpl => html`
          <${Row} key=${tpl.id}>
            <${Name}>${tpl.title || t('profile.living.untitled')}<//>
            <${Desc}>
              ${tpl.description && html`<div>${tpl.description}</div>`}
              <div>${(tpl.template || []).length} ${t('profile.living.sectionsShort')}</div>
            <//>
            <${Doors}>
              <${Loud} control quiet=${deployQuiet} onClick=${() => startDeploy(tpl)}>${t('profile.living.deploy')}<//>
              <${Action} small row onClick=${() => setEditing({ ...tpl })}>${t('profile.living.edit')}<//>
              <${Action} small row tone="danger" onClick=${() => deleteTpl(tpl)}>${t('profile.notebook.deleteBtn')}<//>
            <//>
          <//>`)}
      <//>
      <${Stack} above="medium" below="medium">
        <${TextArea} rows=${2} placeholder=${t('profile.living.authorPh')} value=${need} onInput=${v => setNeed(v)} />
        <${Line}>
          <${Loud} control quiet=${authorQuiet} disabled=${!need.trim() || authoring} onClick=${handleAuthor}>
            ${authoring ? t('profile.living.authoring') : t('profile.living.authorBtn')}
          <//>
        <//>
      <//>
      <${Actions}><${Action} small onClick=${newTemplate}>＋ ${t('profile.living.newTemplate')}<//><//>
    <//>`;

  return html`
    <${SettingsPage} crumb=${[t('nav.profile'), t('profile.landing.menuInformation'), t('profile.tabs.living')]}
      title=${t('profile.living.title')} help="concept.living_document" desc=${t('profile.living.desc')} strip=${strip} start=${start} after=${ConfirmUI}
      railTitle=${railed ? t('profile.landing.railTitle') : undefined} sections=${railed ? shown : undefined}>
    ${opened ? renderOpened() : html`
      ${deploying && renderDeploy()}
      ${editing && renderEditor()}

      ${listView && html`
        ${numOf['lv-docs'] && docsSection()}
        ${templatesSection()}
      `}
    `}
    <//>
  `;
}
