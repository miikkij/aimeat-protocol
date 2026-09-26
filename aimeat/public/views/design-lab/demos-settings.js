/**
 * @file public/views/design-lab/demos-settings.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Live demos of the parts of Settings & Controls (UI consolidation phase 5), each drawn
 *   by the real component inside the page's scope root (.pf), as the page draws it.
 * @structure SETTINGS_DEMOS
 * @usage import { SETTINGS_DEMOS } from './demos-settings.js';
 * @version-history
 *   v1.82.0 — 2026-09-26 — Rating stars shows its row cut (.op-stars--row) in a 7rem cell beside a status.
 *   v1.81.0 — 2026-09-26 — The Offer hits are the Listing (cut hit-doors).
 *   v1.80.0 — 2026-09-26 — The Package preview's entries are the Listing (cut tag-name).
 *   v1.79.0 — 2026-09-26 — The Listing's meta line outside a row (.listing-meta).
 *   v1.78.0 — 2026-09-26 — The Check line's demo.
 *   v1.77.0 — 2026-09-26 — The Check line's demo.
 *   v1.76.0 — 2026-09-26 — The Rating stars' shown tone (Jouni's decision "Rating stars", a unification).
 *   v1.75.0 — 2026-09-26 — The Sub-heading's demo.
 *   v1.74.0 — 2026-09-26 — The Job prompt's demo; the opened row's panel is the Object box's raised tone.
 *   v1.73.0 — 2026-09-26 — A workspace's app launch cards are the library's App cards (css/components/app-cards.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.72.0 — 2026-09-26 — The People panel's list is the library's People list (css/components/people-list.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.71.0 — 2026-09-26 — A record's row (.pj-rec) is the library's Record row (css/components/record-row.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.70.0 — 2026-09-26 — The Key (css/components/key-name.css), a unification: the look most tabs gave a key.
 *   v1.69.0 — 2026-09-26 — The comments on a workspace record or document (.pj-comment*) are the library's Comments (css/components/comments.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.68.0 — 2026-09-26 — The organism row (.pj-org-row and its parts) is the library's Organism row (css/components/org-row.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.67.0 — 2026-09-26 — The Document tree's demo shows a folded series with its arrow (.pj-ov-chevron, moved into doc-tree.css unchanged; a move).
 *   v1.66.0 — 2026-09-26 — The steps of a note's sorting (.pf-nb-steps, .pf-nb-step) are the library's Progress steps (css/components/progress-steps.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.65.0 — 2026-09-26 — An organism's development timeline (.pj-timeline-*) is the library's Organism timeline (css/components/org-timeline.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.64.0 — 2026-09-26 — The password's requirements (.pf-pw-rules) are the library's Requirement list (css/components/requirement-list.css), moved unchanged (UI consolidation phase 5, a move).
 *   v1.63.0 — 2026-09-26 — The figures that open their tab (.pf-usage-chip*) are the library's Figure door (css/components/figure-door.css), moved unchanged (UI consolidation phase 5, a move).
 *   v1.62.0 — 2026-09-26 — The Drag grip, moved out of the agent page's sheet (a move).
 *   v1.61.0 — 2026-09-26 — The Facts value's warn tone (.facts-v--warn).
 *   v1.60.0 — 2026-09-26 — The Figure strip's of cut (.og-strip-of).
 *   v1.59.0 — 2026-09-26 — PageSection's split (.og-split).
 *   v1.58.0 — 2026-09-26 — The map of offers' demo draws an agent as the Tag, as the page now does.
 *   v1.57.0 — 2026-09-26 — The map of offers' demo draws the agent's presence with the status dot, as the page now does.
 *   v1.56.0 — 2026-09-26 — The fold row's done tone (.og-fold--done).
 *   v1.55.0 — 2026-09-26 — The Form fields' code cut (.og-input--code).
 *   v1.54.0 — 2026-09-25 — The signed-out door (.pf-door-*), its sheet moved unchanged from views/profile-door.css to css/components/signed-out-door.css (UI consolidation phase 5, a move).
 *   v1.53.0 — 2026-09-25 — The ecosystem automation (its flow, status timeline and run log: .pf-eco-auto-*, .pf-eco-recipe-head), moved unchanged out of views/profile.css into css/components/eco-automation.css (UI consolidation phase 5, a move).
 *   v1.52.0 — 2026-09-25 — The schedule calendar (the scheduler's month, week and day, .sch-cal-*), moved unchanged out of views/scheduler.css into css/components/schedule-calendar.css (UI consolidation phase 5, a move).
 *   v1.51.0 — 2026-09-25 — An organism search hit is the library's Search hits (css/components/search-hits.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.50.0 — 2026-09-25 — The People panel's agent chip is the library's Agent chip (css/components/agent-chip.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.49.0 — 2026-09-25 — A notice's category is the Tag (.poster-chip, plain), a unification: Jouni's decision "Tag".
 *   v1.48.0 — 2026-09-25 — The devices signed in are the library's Device list (css/components/device-list.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.47.0 — 2026-09-25 — Discover's question desk is the library's Question desk (css/components/question-desk.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.46.0 — 2026-09-25 — The ways to do one thing are the library's How roads (css/components/how-roads.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.45.0 — 2026-09-25 — The inbox rows are the library's Notification feed (css/components/notification-feed.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.44.0 — 2026-09-25 — The morsel flow is the library's Morsel flow (css/components/morsel-flow.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.43.0 — 2026-09-25 — A field and its button in a dashed row are the library's Field row (css/components/field-row.css), moved unchanged under one name (UI consolidation phase 5, a move).
 *   v1.42.0 — 2026-09-25 — The preview of a pasted package is the library's Package preview (css/components/package-preview.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.41.0 — 2026-09-25 — A package's entries are the library's Knowledge entry (css/components/knowledge-entry.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.40.0 — 2026-09-25 — A board's notices are the library's Board notices (css/components/board-notices.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.39.0 — 2026-09-25 — A workflow's steps are the library's Workflow steps (css/components/workflow-steps.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.38.0 — 2026-09-25 — The jobs that run all the time are the library's Job chips (css/components/job-chips.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.37.0 — 2026-09-25 — The week's rhythm is the library's Week rhythm (css/components/week-rhythm.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.36.0 — 2026-09-25 — What the AI found for a need is the library's Offer hits (css/components/offer-hits.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.35.0 — 2026-09-25 — Rating a delivery is the library's Rating stars (css/components/rating-stars.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.34.0 — 2026-09-25 — The request on an offer's page is the library's Offer request (css/components/offer-request.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.33.0 — 2026-09-25 — The map of offers is the library's Offer map (css/components/offer-map.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.32.0 — 2026-09-25 — The production lines are the library's Offer lines (css/components/offer-lines.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.31.0 — 2026-09-25 — The score chart is the library's Score chart (css/components/score-chart.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.30.0 — 2026-09-25 — A prompt's versions and its two editors are the library's Prompt versions (css/components/prompt-versions.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.29.0 — 2026-09-25 — The opened run's parts are the library's Calibration run (css/components/calibration-run.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.28.0 — 2026-09-25 — The model picker is the library's Model picker (css/components/model-picker.css), moved unchanged out of ai-poster.css and calibrator-poster.css (UI consolidation phase 5, a move).
 *   v1.27.0 — 2026-09-25 — The loading line's blinking mark is the library's Loading mark (css/components/loading-mark.css), moved unchanged out of five sheets (UI consolidation phase 5, a move).
 *   v1.26.0 — 2026-09-25 — The demo of the GAII control (GaiiChip, a move out of the agent page's sheet).
 *   v1.25.0 — 2026-09-25 — The demo of the task-order picture (TaskDag, a move out of the agent Crew tab's sheet).
 *   v1.24.0 — 2026-09-25 — The demo of the to-do list (a move out of the agent Tasks tab's sheet).
 *   v1.23.0 — 2026-09-25 — The demo of the tag input.
 *   v1.22.0 — 2026-09-25 — The demo of the file drop.
 *   v1.21.0 — 2026-09-25 — The demo of the file preview.
 *   v1.20.0 — 2026-09-25 — The demo of the document tree.
 *   v1.19.0 — 2026-09-25 — The demo of the colour tag.
 *   v1.18.0 — 2026-09-25 — The demo of the heatmap.
 *   v1.17.0 — 2026-09-25 — The demo of the more line.
 *   v1.16.0 — 2026-09-25 — The demo of the loading mark.
 *   v1.15.0 — 2026-09-25 — The demo of the address preview.
 *   v1.14.0 — 2026-09-25 — The demo of the access log.
 *   v1.13.0 — 2026-09-25 — The demo of the item grid.
 *   v1.12.0 — 2026-09-25 — The demo of the app picker.
 *   v1.11.0 — 2026-09-25 — The demo of the delegation lines.
 *   v1.10.0 — 2026-09-25 — The demo of the sent log.
 *   v1.9.0 — 2026-09-25 — The demo of the uses list.
 *   v1.8.0 — 2026-09-25 — The demo of the tier list.
 *   v1.7.0 — 2026-09-25 — The demo of the changelog.
 *   v1.6.0 — 2026-09-25 — The demo of the proof ledger.
 *   v1.5.0 — 2026-09-25 — The demo of the page row.
 *   v1.4.0 — 2026-09-25 — The demo of the select field.
 *   v1.3.0 — 2026-09-25 — The Switch's demo: on and off, locked, without a word.
 *   v1.2.0 — 2026-09-25 — The demos of facts, listing, search line, code block and form message.
 *   v1.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.0.0 — 2026-09-25 — Initial: the frame and the side menu.
 */
import { h } from 'preact';
import htm from 'htm';
import { SettingsFrame, SettingsFrameHead, SettingsFrameBody } from '/components/SettingsFrame.js';
import { SideMenuHome, SideMenuItem, SideMenuGroup, SideMenuMore } from '/components/SideMenu.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { Switch } from '/components/Switch.js';
import { GaiiChip } from '/views/profile/agents/gaii-chip.js';
import { TaskDag } from '/views/profile/agents/crew-dag.js';
import { ColorPicker } from '/views/profile/organisms/workspace/color-picker.js';
import { TagInput } from '/views/profile/shared.js';
import { ScoreChart } from '/views/profile/calibrator/chart.js';

const html = htm.bind(h);
const noop = () => {};
const pin = (on) => ({ on, title: on ? 'Unpin' : 'Pin', onToggle: noop });

const menu = (collapsed) => html`
  <${SideMenuHome} href="#">← Home<//>
  <${SideMenuItem} active=${false} onClick=${noop}>Overview<//>
  <${SideMenuItem} active=${false} onClick=${noop} count=${7}>Messages<//>
  <${SideMenuGroup} title="Pinned">
    <${SideMenuItem} onClick=${noop} pin=${pin(true)}>Organisms<//>
  <//>
  <${SideMenuGroup} title="Information" collapsed=${false} onToggle=${noop}>
    <${SideMenuItem} onClick=${noop} pin=${pin(false)}>Discover<//>
    <${SideMenuItem} active=${true} onClick=${noop} pin=${pin(false)}>Memory<//>
    <${SideMenuItem} onClick=${noop} pin=${pin(false)}>A name long enough to be cut at the end of the row<//>
  <//>
  <${SideMenuGroup} title="Automation" collapsed=${collapsed} onToggle=${noop}>
    <${SideMenuItem} onClick=${noop} count=${12} pin=${pin(false)}>Agents<//>
  <//>
  <${SideMenuMore} onClick=${noop}>Show all tools<//>`;

export const SETTINGS_DEMOS = {
  'settings-frame': { variants: [
    { name: 'a tab open', render: () => html`<div class="pf">
      <${SettingsFrame} onToggle=${noop} onClose=${noop} menuLabel="Menu" menu=${menu(true)}>
        <${SettingsFrameHead}><span class="poster-crumb">Memory</span><//>
        <${SettingsFrameBody}><p>The open tab is drawn here.</p><//>
      <//></div>` },
    { name: 'the overview', render: () => html`<div class="pf">
      <${SettingsFrame} onToggle=${noop} onClose=${noop} menuLabel="Menu" menu=${menu(true)} overview=${true}>
        <p>The overview is drawn here.</p>
      <//></div>` },
  ] },
  'side-menu': { variants: [
    { name: 'groups open, one folded', render: () => html`<div class="pf"><div class="settings-frame-menu">${menu(true)}</div></div>` },
  ] },
  // The og- page kit, drawn with the markup the tabs write (Access, Agents, Organisms).
  'tab-page': { variants: [
    { name: 'the page beside its rail', render: () => html`<div class="pf"><div class="og"><div class="og-grid">
      <div class="og-main"><${PageSection} id="demo-files" num="01" title="Files" first=${true}><p class="og-lead">The page's sections run down this column.</p><//></div>
      <nav class="og-rail"><span class="og-rail-label">On this page</span>
        <button type="button" class="og-rail-link on"><i>01</i>Files<em>12</em></button>
        <button type="button" class="og-rail-link"><i>02</i>People<em>4</em></button>
        <button type="button" class="og-rail-link"><i>03</i>Settings<em>→</em></button></nav>
    </div></div></div>` },
  ] },
  'crumb-trail': { variants: [
    { name: 'two steps', render: () => html`<div class="pf"><div class="og"><div class="og-crumb"><button type="button" class="og-crumb-link">Organisms</button><span>/</span><span class="og-crumb-here">Harbour Studio</span></div></div></div>` },
  ] },
  'page-head': { variants: [
    { name: 'headline, chips, description, doors', render: () => html`<div class="pf"><div class="og"><div class="og-mast">
      <div class="og-mast-words"><h1 class="og-title poster-page-title">Access<small>who may do what</small></h1>
        <div class="og-chips"><span class="og-chip">3 apps</span><span class="og-chip og-chip--dim">2 sessions</span></div>
        <p class="og-desc">Every app, token and session that can act in your name, and a way to stop each one.</p></div>
      <div class="og-mast-actions"><button type="button" class="og-slab">New token</button>
        <div class="og-doors"><button type="button" class="og-door og-door--quiet">For your AI</button></div></div>
    </div></div></div>` },
  ] },
  'figure-strip': { variants: [
    { name: 'four figures, one a word', render: () => html`<div class="pf"><div class="og"><div class="og-strip">
      <div><b>12</b><span>spaces</span><small>3 shared with you</small></div>
      <div><b>4<span class="og-strip-of">/6</span></b><span>people</span><small>2 admins</small></div>
      <div><b class="og-strip-coral">today</b><span>last change</span><small>by second</small></div>
      <div><b>190</b><span>records</span><small>27 KB</small></div></div></div></div>` },
  ] },
  'page-section': { variants: [
    { name: 'a section with doors, a lead and a hint', render: () => html`<div class="pf"><div class="og">
      <${PageSection} id="demo-sec" num="02" title="People" doors=${html`<button type="button" class="og-door">Invite</button>`}>
        <p class="og-lead">Everyone in this space and what they may do.</p><p class="og-hint">Admins can invite and remove people.</p><//></div></div>` },
    { name: 'split', render: () => html`<div class="pf"><div class="og"><p class="og-lead">The board's rules are saved.</p><div class="og-doors og-split"><button type="button" class="poster-action poster-action--danger">Delete board</button></div></div></div>` },
  ] },
  'fold-row': { variants: [
    { name: 'rows, and a closed section', render: () => html`<div class="pf"><div class="og">
      <div class="og-folds"><div class="og-fold"><i>01</i><span class="og-fold-name">Client briefs</span><span class="og-fold-r">12 documents</span></div>
        <div class="og-fold"><i>02</i><span class="og-fold-name">A name long enough to wrap onto a second line on a narrow screen</span><span class="og-fold-r">today</span></div></div>
      <${FoldSection} id="demo-fold" num="03" title="Map" sub="12 spaces" open=${false} onToggle=${noop}>…<//></div></div>` },
    { name: 'open', render: () => html`<div class="pf"><div class="og"><${FoldSection} id="demo-fold-open" num="03" title="Map" sub="12 spaces" open=${true} onToggle=${noop}><p class="og-lead">The body of an opened section.</p><//></div></div>` },
    { name: 'done', render: () => html`<div class="pf"><div class="og"><button type="button" class="og-fold og-fold--toggle og-fold--done"><i>1</i><span>Generate</span><span class="og-fold-r">done</span><span class="og-fold-arrow">→</span></button><button type="button" class="og-fold og-fold--toggle"><i>2</i><span>Analyze</span><span class="og-fold-r">waiting</span><span class="og-fold-arrow">→</span></button></div></div>` },
  ] },
  'setting-box': { variants: [
    { name: 'a row and its confirmation', render: () => html`<div class="pf"><div class="og"><div class="og-box poster-aside">
      <span class="og-box-label">Leave</span><div class="og-box-row"><p>You can come back when someone invites you.</p><button type="button" class="og-door">Leave</button></div>
      <div class="og-box-confirm"><label class="og-field"><span class="og-label">Type the name</span><input class="og-input" value="Harbour" /></label><button type="button" class="og-slab">Confirm</button></div></div></div></div>` },
  ] },
  'form-fields': { variants: [
    { name: 'two columns and actions', render: () => html`<div class="pf"><div class="og"><div class="og-fields og-fields--2">
      <label class="og-field"><span class="og-label">Name</span><input class="og-input" value="Harbour Studio" /></label>
      <label class="og-field"><span class="og-label">Join</span><input class="og-input" value="By invitation" /></label></div>
      <label class="og-field"><span class="og-label">Description</span><textarea class="og-textarea" rows="3">A small design studio.</textarea></label>
      <div class="og-actions"><button type="button" class="og-slab">Save</button><span class="og-hint">Saved changes show at once.</span></div></div></div>` },
    { name: 'code', render: () => html`<div class="pf"><div class="og"><label class="og-field"><span class="og-label">Runs when</span><input class="og-input og-input--code" value="0 7 * * 1-5" /></label></div></div>` },
  ] },
  'space-table': { variants: [
    { name: 'head and two rows', render: () => html`<div class="pf"><div class="og">
      <div class="og-tbl og-tbl--head"><div></div><div>Space</div><div>Items</div><div>Last change</div><div></div></div>
      <div class="og-tbl"><div class="og-tbl-n">01</div><div class="og-tbl-nm"><button type="button" class="og-tbl-name">Client briefs</button><span class="og-tbl-marks"><span class="og-chip og-chip--xs">shared</span></span></div><div>12</div><div class="og-tbl-last">today · second</div><div class="og-tbl-door"><button type="button" class="og-door">Open</button></div></div>
      <div class="og-tbl"><div class="og-tbl-n">02</div><div class="og-tbl-nm"><button type="button" class="og-tbl-name">Notes</button></div><div>3</div><div class="og-tbl-last">2 days ago</div><div class="og-tbl-door"><button type="button" class="og-door">Open</button></div></div></div></div>` },
  ] },
  facts: { variants: [
    { name: 'default', render: () => html`<div class="pf"><dl class="facts">
      <dt class="facts-k poster-label">Version</dt><dd class="facts-v">1.4.0<small>published today</small></dd>
      <dt class="facts-k poster-label">Used by</dt><dd class="facts-v">claude-code, codex and a name long enough to wrap onto a second line</dd></dl></div>` },
    { name: 'wide', render: () => html`<div class="pf"><dl class="facts facts--wide"><dt class="facts-k poster-label">What your AI reads</dt><dd class="facts-v">The whole file, once a session.</dd></dl></div>` },
    { name: 'warn', render: () => html`<div class="pf"><dl class="facts"><dt class="facts-k poster-label">Policy issues</dt><dd class="facts-v facts-v--warn">2</dd></dl></div>` },
  ] },
  listing: { variants: [
    { name: 'head, rows, one open', render: () => html`<div class="pf"><div class="listing listing--name-desc-doors">
      <div class="listing-row listing-row--head"><div class="poster-label">Skill</div><div class="poster-label">What it teaches</div><div></div></div>
      <div class="listing-row is-open"><div class="listing-name">aimeat-writing<small>v1.4.0</small></div><div class="listing-desc">How prose is written on this project.</div><div class="listing-doors"><button type="button" class="poster-action">Close</button></div>
        <div class="listing-open poster-box poster-box--raised">The panel a row opens, framed, with the raised shadow.</div></div>
      <div class="listing-row"><div class="listing-name">meeting-notes<small>v0.2.0</small></div><div class="listing-desc">Short meeting notes, decisions first.</div><div class="listing-doors"><button type="button" class="poster-action">Open</button></div></div>
    </div></div>` },
    { name: 'meta, outside a row', render: () => html`<div class="pf"><div><b>Harbour Studio</b><small class="listing-meta">an organism's board · 12 notices</small></div></div>` },
  ] },
  'search-line': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="search-line"><input class="og-input" placeholder="Find a skill" /><small>12 of 40</small></div></div>` },
  ] },
  'code-block': { variants: [
    { name: 'block', render: () => html`<div class="pf"><pre class="code-block">aimeat_skill_get aimeat-writing\n# a second line long enough to wrap on a narrow screen, as the pages wrap it</pre></div>` },
    { name: 'inline', render: () => html`<div class="pf"><p>Ask your AI to run <code class="code-inline">aimeat_skill_list</code> first.</p></div>` },
  ] },
  'form-message': { variants: [
    { name: 'done', render: () => html`<div class="pf"><span class="form-message">Saved. Your agents see it at once.</span></div>` },
    { name: 'refused', render: () => html`<div class="pf"><span class="form-message form-message--error">The name is taken.</span></div>` },
  ] },
  switch: { variants: [
    { name: 'on and off', render: () => html`<div class="pf"><${Switch} on=${true} label="push" onToggle=${noop} /> <${Switch} on=${false} label="digest" onToggle=${noop} /></div>` },
    { name: 'locked', render: () => html`<div class="pf"><${Switch} on locked label="always" /></div>` },
    { name: 'without a word', render: () => html`<div class="pf"><${Switch} on=${true} ariaLabel="Suggest while I chat" onToggle=${noop} /></div>` },
  ] },
  'select-field': { variants: [
    { name: 'default', render: () => html`<div class="pf"><select class="select-field" aria-label="Role"><option>Member</option><option>Editor</option><option>Owner</option></select></div>` },
    { name: 'disabled', render: () => html`<div class="pf"><select class="select-field" aria-label="Role" disabled><option>Pick an agent first</option></select></div>` },
  ] },
  'page-row': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="pf-pg"><div class="pf-thumb" aria-hidden="true"><i></i><i></i></div><div class="pf-pg-words"><b>Sandbox</b><small>published 9/25/2026 at 06:07 AM · 1 kB · no sections need a login</small></div><div class="pf-pg-go"><button type="button" class="poster-action">Preview</button></div></div></div>` },
  ] },
  'proof-ledger': { variants: [
    { name: 'passed and failed', render: () => html`<div class="pf"><div class="lb-proof">
      <div>claude-haiku-4-5</div><div class="ok">pass</div><div>12,400 tok</div><div>2026-09-20</div><div>proof-file-storage.json</div>
      <div>gpt-4o-mini</div><div class="no">fail</div><div>9,100 tok</div><div>2026-09-18</div><div>proof-file-storage-2.json · self-reported</div>
    </div></div>` },
  ] },
  changelog: { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="lb-cl">
      <div class="m">1.1.3</div><div class="m">2026-09-20</div><div>The legend wraps on a phone.</div>
      <div class="m">1.1.0</div><div class="m">2026-08-02</div><div>Stacked bars. <b class="is-warn">Breaking: the colours option is a list</b></div>
    </div></div>` },
  ] },
  'tier-list': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="ad-tier"><b>T1</b><span>One HTML file that runs on its own.</span><b>T2</b><span>It keeps its data in the person's memory.</span><b>T3</b><span>It works with agents and the node's libraries.</span></div></div>` },
  ] },
  'uses-list': { variants: [
    { name: 'works now and not', render: () => html`<div class="pf"><div class="em-uses">
      <div><i>✓</i><span><b>Sign in</b><small>A code to this address signs you in.</small></span></div>
      <div><i>✓</i><span><b>Notices</b><small>What your agents did, when you ask for mail.</small></span></div>
      <div><i class="no">·</i><span><b>Never</b><small>Advertising or sharing the address.</small></span></div>
    </div></div>` },
  ] },
  'sent-log': { variants: [
    { name: 'head and rows', render: () => html`<div class="pf">
      <div class="em-log em-log--head"><div class="poster-label">When</div><div class="poster-label">To whom and what</div><div class="poster-label">Where</div><div class="poster-label"></div></div>
      <div class="em-log">
        <div class="em-m poster-time"><b>2 hours ago</b>01:00 PM</div><div class="em-what"><b>Your invoice</b><small>Anna Berg · a message · sent</small></div><div class="em-m">by email</div><div class="og-tbl-door"><button type="button" class="poster-action poster-action--quiet">Open contact</button></div>
        <div class="em-m poster-time"><b>yesterday</b>12:30 PM</div><div class="em-what"><b>Meeting on Friday</b><small>Leo Ahn · personal · delivered</small></div><div class="em-m">into their AIMEAT inbox</div><div class="og-tbl-door"></div>
      </div></div>` },
  ] },
  'delegation-lines': { variants: [
    { name: 'on and stopped', render: () => html`<div class="pf"><div class="em-deleg">
      <div><b>notes.html</b><small>read-mail</small><button type="button" class="poster-action poster-action--quiet">Stop</button></div>
      <div><b>hello.html</b><small>send-mail · stopped</small></div>
    </div></div>` },
  ] },
  'app-picker': { variants: [
    { name: 'one picked', render: () => html`<div class="pf"><div class="pk-compose-list">
      <label class="pk-compose-app"><input type="checkbox" checked /><span class="pk-compose-app-nm">Notes<small>notes.html</small></span><small class="pk-compose-app-needs">nothing to load</small></label>
      <label class="pk-compose-app"><input type="checkbox" /><span class="pk-compose-app-nm">Hello<small>hello.html</small></span><small class="pk-compose-app-needs">cortex: greeter · extension: clock</small></label>
    </div></div>` },
  ] },
  'item-grid': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="item-grid">
      <div><b>Memory</b><small>128 keys</small></div><div><b>Files</b><small>4 files · 1 MB</small></div><div><b>Permissions</b><small>6 grants</small></div>
    </div></div>` },
  ] },
  'access-log': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="dw-grants dw-grants--rows">
      <div class="dw-gh poster-label">When</div><div class="dw-gh poster-label">Key</div><div class="dw-gh poster-label">Outcome</div>
      <div class="poster-time">9/22/2026 10:00 AM</div><div><code class="code-inline">notes/today</code></div><div>refused</div>
      <div class="poster-time">9/22/2026 09:58 AM</div><div><code class="code-inline">notes/plans</code></div><div>refused</div>
    </div></div>` },
  ] },
  'address-preview': { variants: [
    { name: 'free', render: () => html`<div class="pf"><p class="co-preview">Address: <b>acme-widgets</b> · free</p></div>` },
    { name: 'taken', render: () => html`<div class="pf"><p class="co-preview">Address: <b>acme</b> · <span class="taken">already taken</span></p></div>` },
  ] },
  'loading-mark': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="og"><p class="poster-quiet loading-mark">Loading…</p></div></div>` },
    { name: 'contacts', render: () => html`<div class="pf"><div class="og og-ct"><p class="poster-quiet ct-loading">Loading…</p></div></div>` },
  ] },
  'more-line': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="more-line"><button type="button" class="poster-action poster-action--more">Show 20 more</button><small>20 of 55</small></div></div>` },
    { name: 'all shown', render: () => html`<div class="pf"><div class="more-line"><small>5 of 5</small></div></div>` },
  ] },
  heatmap: { variants: [
    { name: 'four weeks and the key', render: () => html`<div class="pf"><div class="pj-hm">
      <div class="pj-hm-monthrow"><span class="pj-hm-month">Sep</span><span class="pj-hm-month"></span><span class="pj-hm-month"></span><span class="pj-hm-month">Oct</span></div>
      <div class="pj-hm-body"><div class="pj-hm-daycol"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div>
        <div class="pj-hm-cols">${[0, 1, 2, 3].map((w) => html`<div class="pj-hm-col" key=${w}>${[0, 1, 2, 3, 4, 5, 6].map((d) => (w === 3 && d > 3)
          ? html`<span class="pj-hm-cell future" key=${d}></span>`
          : html`<span class="pj-hm-cell" key=${d}><i class=${`q lvl${(w + d) % 5}`}></i><i class=${`q lvl${(w * d) % 5}`}></i><i class=${`q lvl${d % 3}`}></i><i class=${`q lvl${w % 4}`}></i></span>`)}</div>`)}</div></div></div>
      <div class="pj-hm-legend"><div class="pj-hm-quadkey"><span class="pj-hm-cell"><i class="q lvl1"></i><i class="q lvl3"></i><i class="q lvl2"></i><i class="q lvl4"></i></span>
        <div class="pj-hm-quadlabels"><span>↖ Docs draft</span><span>↗ Docs published</span><span>↙ Records draft</span><span>↘ Records published</span></div></div>
        <div class="pj-hm-intensity"><span>Less</span><i class="q lvl0"></i><i class="q lvl1"></i><i class="q lvl2"></i><i class="q lvl3"></i><i class="q lvl4"></i><span>More</span></div></div></div>` },
  ] },
  'colour-tag': { variants: [
    { name: 'dots and rails', render: () => html`<div class="pf"><div class="pj-colored pj-tag-blue">A record marked blue <${ColorPicker} value="blue" onPick=${noop} /></div>
      <div class="pj-colored pj-tag-red">A document marked red <${ColorPicker} value="red" onPick=${noop} /></div>
      <div>No colour yet <${ColorPicker} value=${null} onPick=${noop} /></div></div>` },
  ] },
  'doc-tree': { variants: [
    { name: 'sections, one open', render: () => html`<div class="pf"><div class="og og-page"><div class="pj-docspace"><div class="pj-doc-index">
      <div class="pj-sec"><div class="pj-sec-head"><span class="pj-sec-name pj-sec-name-text">Research</span></div>
        <div class="pj-doc-item active"><span class="pj-grip">⠿</span><button type="button" class="pj-doc-link">Seat map study</button></div>
        <div class="pj-sec"><div class="pj-sec-head"><span class="pj-sec-name pj-sec-name-text">Interviews</span></div>
          <div class="pj-doc-item"><span class="pj-grip">⠿</span><button type="button" class="pj-doc-link">Twelve bookings</button></div></div></div>
      <div class="pj-sec"><div class="pj-sec-head"><span class="pj-sec-name pj-muted">Unsorted</span></div>
        <div class="pj-doc-item"><span class="pj-grip">⠿</span><button type="button" class="pj-doc-link">Lumo Bakery: seasonal menu site</button></div>
        <div class="pj-doc-series"><button type="button" class="pj-doc-series-head"><span class="pj-ov-chevron">▸</span><span class="pj-doc-series-name">Style guide</span><span class="poster-count poster-count--tally">2</span></button></div></div>
      </div><div class="pj-doc-main"><p>The open document.</p></div></div></div></div>` },
  ] },
  'file-preview': { variants: [
    { name: 'text', render: () => html`<div class="pf"><div class="pf-file-preview-body"><pre class="pf-file-preview-text">File 1
A second line of the file.</pre></div></div>` },
    { name: 'loading', render: () => html`<div class="pf"><div class="pf-file-preview-body"><div class="pf-file-preview-status">Loading…</div></div></div>` },
  ] },
  'file-drop': { variants: [
    { name: 'empty', render: () => html`<div class="pf"><div class="file-dropzone"><div class="file-dropzone-empty"><span class="pf-upload-icon">⬆️</span><span>Drop files here</span><span class="text-meta">or click to choose</span></div></div></div>` },
    { name: 'two chosen', render: () => html`<div class="pf"><div class="file-dropzone has-file"><div class="file-dropzone-empty"><span class="pf-upload-icon">⬆️</span><span>Drop files here</span></div></div>
      <div class="file-upload-list"><div class="file-upload-item"><span class="pf-file-icon">📄</span><input class="og-input pf-flex-fill" value="docs/notes.txt" readonly /><span class="text-meta">1 KB</span></div>
      <div class="file-upload-item"><span class="pf-file-icon">📄</span><input class="og-input pf-flex-fill" value="docs/plan.md" readonly /><span class="text-meta">2 KB</span></div></div></div>` },
  ] },
  'tag-input': { variants: [
    { name: 'two tags', render: () => html`<div class="pf"><${TagInput} tags=${['design', 'ferries']} onChange=${noop} placeholder="Add…" /></div>` },
    { name: 'empty', render: () => html`<div class="pf"><${TagInput} tags=${[]} onChange=${noop} placeholder="Add…" /></div>` },
  ] },
  // Parts drawn one way only, moved out of a tab's sheet (wave 3, the agent pages).
  'todo-list': { variants: [
    { name: 'a plan under way', render: () => html`<div class="pf"><div class="agt-tab">
      <div class="agt-todo"><span class="agt-tick agt-tick--done">✓</span><div class="agt-todo-b"><b>Read the question</b><span class="poster-chip">Agent</span><div class="agt-sub">The mail of Tuesday.</div></div><div class="agt-todo-r"><span class="poster-time">Sep 25 06:16</span></div></div>
      <div class="agt-todo"><span class="agt-tick agt-tick--failed">✗</span><div class="agt-todo-b"><b>Check the seat map</b><span class="poster-chip">Agent</span></div></div>
      <div class="agt-todo"><span class="agt-tick agt-tick--active">→</span><div class="agt-todo-b"><b>Draft the answer</b><span class="poster-chip">AIMEAT</span></div></div>
      <div class="agt-todo"><span class="agt-tick agt-tick--pending"></span><div class="agt-todo-b"><b>Send it</b></div></div>
      <div class="agt-todo agt-todo--old"><span class="agt-tick"></span><div class="agt-todo-b"><b>A step of an earlier plan</b></div></div>
    </div></div>` },
  ] },
  'crew-dag': { variants: [
    { name: 'three tasks, one with a problem', render: () => html`<div class="pf"><${TaskDag}
      tasks=${[{ id: 'research', agent: 'scout' }, { id: 'write', agent: 'writer', context: ['research'] }, { id: 'edit', agent: 'editor', context: ['write'] }]}
      problemIds=${new Set([2])} /></div>` },
  ] },
  'drag-grip': { variants: [
    { name: 'a row, the grip shown', render: () => html`<div class="pf" style="padding-left: 2rem"><div class="pf-agd-dnd-row" draggable="true" style="padding-top: .8rem; padding-bottom: .8rem; border-bottom: 1px solid var(--border)"><span class="pf-agd-dnd-grip" style="opacity: .7">⠿</span>bot</div></div>` },
    { name: 'dragging', render: () => html`<div class="pf" style="padding-left: 2rem"><div class="pf-agd-dnd-row pf-agd-dnd-dragging" style="padding-top: .8rem; padding-bottom: .8rem; border-bottom: 1px solid var(--border)"><span class="pf-agd-dnd-grip" style="opacity: .7">⠿</span>claude-code</div></div>` },
  ] },
  'gaii-chip': { variants: [
    { name: 'default', render: () => html`<div class="pf"><${GaiiChip} agent=${{ name: 'bot', gaii: 'bot#sandbox@aimeat-local-001-dev' }} /></div>` },
    { name: 'narrow', render: () => html`<div class="pf" style="max-width: 12rem"><${GaiiChip} agent=${{ name: 'research-assistant', gaii: 'research-assistant#sandbox@aimeat-local-001-dev' }} /></div>` },
  ] },
  'model-picker': { variants: [
    { name: 'recommended, one chosen, one taken', render: () => html`<div class="pf"><div class="og"><div class="model-picker">
      <input class="og-input" type="search" placeholder="Search 312 models" aria-label="Search models" />
      <div class="model-picker-group poster-day-title">Recommended</div>
      <ul class="model-picker-list">
        <li class="model-picker-row is-on"><button type="button"><span><b>Claude Sonnet 4.5</b><code>anthropic/claude-sonnet-4.5</code></span><span class="model-picker-trait">reads images</span><span class="model-picker-price">$3 / $15 per M</span><span class="model-picker-ctx">200k</span></button></li>
        <li class="model-picker-row"><button type="button"><span><b>Mistral Small 3.2</b><code>mistralai/mistral-small-3.2</code></span><span class="model-picker-trait">free</span><span class="model-picker-price">$0.1 / $0.3 per M</span><span class="model-picker-ctx">128k</span></button></li>
        <li class="model-picker-row is-taken"><button type="button" disabled><span><b>Gemini 2.5 Flash</b><code>google/gemini-2.5-flash</code></span><span class="model-picker-note">already added</span><span class="model-picker-price">$0.3 / $2.5 per M</span><span class="model-picker-ctx">1M</span></button></li>
      </ul>
      <div class="model-picker-more"><button type="button" class="poster-action poster-action--more">Show all 312</button><span>312 models answer in text</span></div>
    </div></div></div>` },
  ] },
  'calibration-run': { variants: [
    { name: 'a model and its checkpoints, the proposals', render: () => html`<div class="pf"><div class="og og-cal">
      <div class="cal-m"><div class="cal-m-h"><b>Mistral Small 3.2</b><b class="cal-pct poster-stat-number poster-stat-number--small">82 %</b><small>2 of 3 checkpoints passed</small></div>
        <div class="cal-dims"><div class="cal-dh poster-label"></div><div class="cal-dh poster-label">Checkpoint</div><div class="cal-dh poster-label">Expected</div><div class="cal-dh poster-label">Got</div><div class="cal-dh poster-label">Weight</div>
          <div>✓</div><div><b>price first</b><small>Checks the price first</small></div><div>Present and first</div><div>Present</div><div><small>major (2)</small></div>
          <div>✗</div><div><b>plain words</b></div><div>Present</div><div>Missing</div><div><small>minor (1)</small></div></div></div>
      <div class="cal-props">
        <div class="cal-prop"><span class="cal-prop-n is-on">1</span><span class="cal-prop-t">Name the price in the first bullet.<small>Both judges ask for it.</small></span><span class="cal-prop-tag"><em class="poster-chip poster-chip--coral">high</em></span></div>
        <div class="cal-prop"><span class="cal-prop-n">2</span><span class="cal-prop-t">Ask for the currency.</span><span class="cal-prop-tag"><em class="poster-chip">low</em></span></div></div>
    </div></div>` },
  ] },
  'prompt-versions': { variants: [
    { name: 'two versions, one shown', render: () => html`<div class="pf"><div class="og og-cal"><div class="cal-vers">
      <div class="cal-ver is-on"><div class="cal-ver-n poster-stat-number poster-stat-number--small">v2<small>9/25/2026 08:13</small></div><div class="cal-ver-w">The price comes first <span class="poster-chip poster-chip--sun">current</span></div><div class="cal-ver-go"><small>shown</small></div></div>
      <div class="cal-ver"><div class="cal-ver-n poster-stat-number poster-stat-number--small">v1<small>9/24/2026 17:40</small></div><div class="cal-ver-w">First version</div><div class="cal-ver-go"><button type="button" class="poster-action poster-action--quiet">Show</button></div></div></div>
      <div class="cal-editors"><div class="cal-field"><span class="poster-label">Prompt<small>characters: 64</small></span><textarea class="og-textarea" rows="4">Summarise the booking flow.</textarea></div>
        <div class="cal-field"><span class="poster-label">Target output<small>characters: 22</small></span><textarea class="og-textarea" rows="4">- Price</textarea></div></div>
    </div></div>` },
  ] },
  'score-chart': { variants: [
    { name: 'two models over two runs', render: () => html`<div class="pf"><div class="og og-cal"><${ScoreChart} runs=${[
      { batchId: 'a', number: 1, promptVersion: 1, scores: [{ modelId: 'm', modelLabel: 'Mistral Small 3.2', overallScore: 54 }, { modelId: 'g', modelLabel: 'Gemini 2.5 Flash', overallScore: 71 }] },
      { batchId: 'b', number: 2, promptVersion: 2, scores: [{ modelId: 'm', modelLabel: 'Mistral Small 3.2', overallScore: 82 }, { modelId: 'g', modelLabel: 'Gemini 2.5 Flash', overallScore: 77 }] },
    ]} /></div></div>` },
  ] },
  'offer-lines': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="og og-op"><div class="op-line op-line--last"><div class="op-line-h"><b>Invoice run</b><small>3 steps · last run 2 h ago</small></div><div class="op-steps"><button type="button" class="op-step op-step--done">Collect the hours<small>invoice-drafter · done</small></button><span class="op-arrow">→</span><button type="button" class="op-step op-step--fail">Draft the invoice<small>invoice-drafter · failed</small></button><span class="op-arrow">→</span><button type="button" class="op-step">Send it<small>mailer</small></button></div></div></div></div>` },
  ] },
  'offer-map': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="og og-op"><div class="op-cols"><div class="op-col"><div class="op-col-h poster-day-title"><span>Write</span><em>2</em></div><a class="op-tile" href="#"><span class="op-tile-t"><span>Draft an invoice</span></span><span class="poster-chip op-agent">invoice-drafter<i class="status-dot status-dot--online"></i></span></a><a class="op-tile" href="#"><span class="op-tile-t"><span>Summarise a long thread into five bullets</span></span><span class="poster-chip op-agent">codex<i class="status-dot status-dot--idle"></i> <em>away</em></span></a></div><div class="op-col"><div class="op-col-h poster-day-title"><span>Find</span><em>1</em></div><a class="op-tile op-tile--compact" href="#"><span class="op-tile-t"><span>Search the web</span></span></a></div></div></div></div>` },
  ] },
  'offer-request': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="og og-op"><p class="op-ask">Draft an invoice from the hours logged this month, in the client's currency.</p><textarea class="og-textarea op-request" rows="3" placeholder="What exactly do you need?"></textarea><div class="op-ask-row"><button type="button" class="poster-slab poster-slab--control">Ask</button><span class="op-warn">It sends mail outside: external send</span></div><div class="op-result">The request went to invoice-drafter.<small>Provenance: invoice-drafter · task t-123</small></div></div></div>` },
  ] },
  'rating-stars': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="og og-op"><div class="op-rate"><span class="poster-label">Rate it</span><span class="op-stars"><button type="button" class="op-star on">★</button><button type="button" class="op-star on">★</button><button type="button" class="op-star on">★</button><button type="button" class="op-star">☆</button><button type="button" class="op-star">☆</button></span><input type="text" class="og-input op-rate-note" placeholder="A note" /><button type="button" class="poster-action">Send</button></div></div></div>` },
    { name: 'shown', render: () => html`<div class="pf"><p>Creative <span class="op-stars op-stars--shown" role="img" aria-label="4/5">${[1, 2, 3, 4, 5].map((n) => html`<span key=${n} class=${'op-star' + (n <= 4 ? ' on' : '')} aria-hidden="true">★</span>`)}</span> 4.0</p></div>` },
    { name: 'row', render: () => html`<div class="pf"><div class="og og-op"><div class="listing-desc op-st" style="width:7rem"><span class="poster-status poster-status--fine">done</span><span class="op-stars op-stars--shown op-stars--row" role="img" aria-label="4/5">${[1, 2, 3, 4, 5].map((n) => html`<span key=${n} class=${'op-star' + (n <= 4 ? ' on' : '')} aria-hidden="true">★</span>`)}</span></div></div></div>` },
  ] },
  'offer-hits': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="og og-op"><div class="op-ai-head"><span class="poster-label">What the AI found</span><button type="button" class="poster-action poster-action--quiet">Clear</button></div><div class="listing listing--cols listing--hit-doors"><div class="listing-row op-hit"><div class="listing-name"><button type="button" class="og-tbl-name">Draft an invoice</button><p>Makes an invoice from logged hours.</p><div class="op-why">It reads your hours.</div></div><div class="listing-doors"><button type="button" class="poster-action">Ask</button></div></div></div></div></div>` },
  ] },
  'week-rhythm': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="og og-sc"><div class="sc-rhythm"><div class="sc-hd poster-label">Time</div><div class="sc-hd poster-label">Schedule</div><div class="sc-hd sc-hd--day poster-label">Mo<small>22</small></div><div class="sc-hd sc-hd--day poster-label">Tu<small>23</small></div><div class="sc-hd sc-hd--day poster-label">We<small>24</small></div><div class="sc-hd sc-hd--day poster-label">Th<small>25</small></div><div class="sc-hd sc-hd--day sc-today poster-label">Fr<small>26</small></div><div class="sc-hd sc-hd--day poster-label">Sa<small>27</small></div><div class="sc-hd sc-hd--day poster-label">Su<small>28</small></div><div class="sc-hd poster-label">Last</div><div class="sc-t">06:00</div><div class="sc-nm">Morning digest<i>agent task</i></div><div class="sc-d sc-d--agent">●</div><div class="sc-d sc-d--agent">●</div><div class="sc-d sc-d--agent">●</div><div class="sc-d sc-d--agent">●</div><div class="sc-d sc-d--agent sc-today">●</div><div class="sc-d sc-d--no">·</div><div class="sc-d sc-d--no">·</div><div class="sc-last">today 06:00</div></div></div></div>` },
  ] },
  'job-chips': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="og og-sc"><div class="sc-cont"><button type="button" class="sc-job">Check the mailbox<i>every 30 min</i></button><button type="button" class="sc-job sc-job--warn">Watch the feed<i>every 5 min</i></button></div></div></div>` },
  ] },
  'workflow-steps': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="og og-wp"><div class="wp-step"><div class="wp-step-n">01</div><div class="wp-step-body"><b>Collect the hours<small>invoice-drafter</small></b><div class="wp-sig">First. Takes the month. Gives the hours as a table.</div><div class="wp-sig wp-sig--key">writes wf/invoice/hours</div></div><div class="wp-step-st"><b class="poster-status poster-status--fine">produced</b><span>3 rows seen</span></div></div></div></div>` },
  ] },
  'board-notices': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="og og-bp"><div class="bp-notice"><div class="bp-cat"><span class="poster-chip">News</span></div><div class="bp-notice-body"><button type="button" class="bp-notice-title">The ferry timetable changes on Monday</button><p>The morning boat leaves at 07:10 from now on.</p><div class="bp-who"><b>second</b> on <button type="button" class="bp-who-board">Harbour</button></div></div><div class="bp-r"><b>2 replies</b>today 09:12</div></div><div class="bp-notice"><div class="bp-cat bp-cat--q">·</div><div class="bp-notice-body"><button type="button" class="bp-notice-title">Who has the key to the shed?</button></div><div class="bp-r"><b>0 replies</b>yesterday</div></div></div></div>` },
  ] },
  'knowledge-entry': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="og og-kp"><div class="kp-entry"><div class="kp-entry-h"><button type="button" class="kp-entry-title">Who may write to shared memory</button><div class="kp-entry-r"><span class="poster-chip poster-chip--sun">public</span></div></div><p class="kp-entry-text">Only agents the owner approved may write.</p><div class="kp-refs"><div class="kp-ref"><i>verified</i><a href="#">The owner's policy page</a></div><div class="kp-ref"><i class="kp-ref--no">unverified</i><a href="#">A blog post</a></div></div><div class="kp-rels"><button type="button" class="kp-rel"><b>extends</b>escalation</button></div></div></div></div>` },
  ] },
  'package-preview': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="og og-kp"><div class="kp-preview poster-box"><div class="kp-preview-h"><b>Agent governance</b><span class="poster-chip">document</span><span class="poster-chip">2 entries</span></div><div class="listing listing--cols listing--tag-name kp-preview-entries"><div class="listing-row"><div><span class="poster-chip poster-chip--sun">public</span></div><div class="listing-name">Who may write<small class="listing-meta">Only approved agents write.</small></div></div><div class="listing-row"><div><span class="poster-chip">private</span></div><div class="listing-name">Escalation</div></div></div><div class="kp-preview-actions"><button type="button" class="poster-slab poster-slab--control">Import 2</button><button type="button" class="poster-action poster-action--quiet">Discard</button></div></div></div></div>` },
  ] },
  'field-row': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="og "><div class="field-row"><input class="og-input" type="password" placeholder="sk-or-…" aria-label="Key" /><button type="button" class="poster-action">Save the key</button></div></div></div>` },
  ] },
  'sub-heading': { variants: [
    { name: 'default', render: () => html`<div class="pf"><h4 class="sub-heading">Your own TypeSafe key</h4><p class="poster-hint">A key of your own is used before the node's.</p></div>` },
  ] },
  'check-line': { variants: [
    { name: 'check box and radio dot', render: () => html`<div class="pf"><label class="check-line"><input type="checkbox" checked /> Detect on capture</label><br /><label class="check-line"><input type="radio" name="dl-check-line" checked /> Private</label> <label class="check-line"><input type="radio" name="dl-check-line" /> Public</label></div>` },
  ] },
  'job-prompt': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="poster-box job-prompt"><span class="poster-label">What it sends</span><div class="job-prompt-title">Morning digest</div><div class="job-prompt-body">Read every workspace I belong to and list the open questions first.</div></div></div>` },
  ] },
  'morsel-flow': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="og og-wal"><div class="wal-flow"><div class="wal-col poster-box"><div class="wal-col-h"><b>+120</b> Came in<small>12 rows · this month</small></div><div class="wal-src"><span>Daily accrual<small>30 times</small></span><b>+90</b></div><div class="wal-src"><span>A vouch<small>3 times</small></span><b>+30</b></div></div><div class="wal-col poster-box"><div class="wal-col-h"><b>-40</b> Went out<small>4 rows</small></div><div class="wal-src"><span>Memory writes<small>40 times</small></span><b>-40</b></div></div></div></div></div>` },
  ] },
  'notification-feed': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="og og-nt"><div class="nt-rows"><div class="nt-when poster-time"><b>2 h ago</b>09:12</div><div class="nt-src">second<small>person</small></div><div class="nt-what unread"><b>Asked you a question</b><small>Can you check the seat map?</small><em class="ok">Answered</em></div><div class="og-tbl-door nt-doors"><button type="button" class="poster-action">Open</button></div></div></div></div>` },
  ] },
  'how-roads': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="og "><div class="nt-roads"><div class="nt-road poster-box"><span class="nt-road-k">01 · MCP</span><b>Your AI does it</b><p>Ask your AI to mute a sender.</p><code class="code-inline">aimeat_notify</code></div><div class="nt-road poster-box"><span class="nt-road-k">02 · here</span><b>On this page</b><p>Use the switches above.</p><code class="code-inline">Settings › Notifications</code></div></div></div></div>` },
  ] },
  'question-desk': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="og og-dv"><div class="dv-desk"><input class="dv-field" type="search" placeholder="What are you looking for?" aria-label="Question" /><div class="dv-scope"><button type="button" class="poster-tab is-on">Mine<i>120</i></button> <button type="button" class="poster-tab">Shared<i>40</i></button></div><p class="poster-hint">Searches your records, files and apps.</p></div></div></div>` },
  ] },
  'device-list': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="og og-ac"><div class="ac-devices"><div class="ac-dh poster-label">Device</div><div class="ac-dh poster-label">Kind</div><div class="ac-dh ac-dn poster-label">Last seen</div><div><b>Firefox on Windows</b><small>Helsinki</small></div><div>browser</div><div class="ac-dn">today</div><div><b>Claude Code</b><small>agent</small></div><div>agent</div><div class="ac-dn">2 days ago</div></div></div></div>` },
  ] },
  'agent-chip': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="pj-part-agents"><span class="pj-part-agent own">🤖 bot<span class="poster-count poster-count--tally">3</span></span> <span class="pj-part-agent own">🤖 invoice-drafter<span class="poster-count poster-count--tally">1</span></span></div></div>` },
    { name: 'ghost', render: () => html`<div class="pf"><div class="pj-part-agents"><span class="pj-part-agent ghost" title="Another owner's agent">🤖 <span class="poster-count poster-count--tally">2</span></span></div></div>` },
  ] },
  'search-hits': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="pj-search-results"><div class="pj-search-group"><div class="pj-search-group-head poster-day-title">Harbour Studio<span class="poster-count poster-count--tally">2</span></div><button type="button" class="pj-search-hit"><span class="pj-search-hit-title">Nordic Ferries: new booking flow <span class="pj-mini">· brief</span></span><span class="pj-search-hit-snippet">The booking flow loses a third of people at the seat map.</span></button><button type="button" class="pj-search-hit"><span class="pj-search-hit-title">Lumo Bakery: seasonal menu site <span class="pj-mini">· brief</span></span><span class="pj-search-hit-snippet">A one-page site that changes with the season.</span></button></div></div></div>` },
  ] },
  'schedule-calendar': { variants: [
    { name: 'three days of a week', render: () => html`<div class="pf"><div class="sch-cal">
      <div class="sch-cal-freq"><div class="sch-cal-freq-head"><span class="sch-cal-freq-title">Continuously running</span></div>
        <div class="sch-cal-freq-pills"><button type="button" class="sch-cal-freqpill sch-cal-ev--agent"><span class="sch-cal-freqdot"></span><span class="sch-cal-freqname">Check the mailbox</span><span class="sch-cal-freqcad">every 30 min</span></button></div></div>
      <div class="sch-cal-week">${['Mon 21', 'Tue 22', 'Wed 23'].map((d, i) => html`<div class=${`sch-cal-weekcol ${i === 1 ? 'sch-cal-weekcol--today' : ''}`} key=${d}>
        <div class="sch-cal-weekcol-head"><span class="sch-cal-wd">${d.split(' ')[0]}</span><span class="sch-cal-daynum">${d.split(' ')[1]}</span></div>
        <div class="sch-cal-weekcol-evs"><button type="button" class=${`sch-cal-ev sch-cal-ev--agent ${i === 0 ? 'sch-cal-ev--past' : ''}`}><span class="sch-cal-evtime poster-time">06:00</span> Morning digest</button><button type="button" class="sch-cal-ev sch-cal-ev--ai"><span class="sch-cal-evtime poster-time">22:00</span> Nightly librarian</button></div></div>`)}</div>
    </div></div>` },
  ] },
  'eco-automation': { variants: [
    { name: 'two steps and the latest run', render: () => html`<div class="pf"><div class="pf-eco-auto-flow-card">
      <div class="pf-eco-auto-flow-step"><span class="pf-eco-recipe-head"><span class="pf-eco-auto-flow-num">①</span> What this app produces</span><p class="poster-hint">Feedback, as records under the app's key.</p></div>
      <div class="pf-eco-auto-flow-step pf-eco-auto-flow-step-disabled"><span class="pf-eco-recipe-head"><span class="pf-eco-auto-flow-num">②</span> Run on a schedule</span></div>
      <div class="pf-eco-auto-flow-save"><button type="button" class="poster-slab poster-slab--control">Save automation</button></div>
    </div>
    <div class="pf-eco-auto-status-timeline">
      <div class="pf-eco-auto-status-step"><div class="pf-eco-auto-status-head"><span class="pf-eco-auto-status-dot pf-eco-auto-status-dot-ok"></span><strong class="pf-eco-auto-status-label">Published</strong></div><div class="pf-eco-auto-status-body"><p class="poster-hint">Today, 06:00.</p></div></div>
      <div class="pf-eco-auto-status-step"><div class="pf-eco-auto-status-head"><span class="pf-eco-auto-status-dot pf-eco-auto-status-dot-wait"></span><strong class="pf-eco-auto-status-label">Processed</strong></div><div class="pf-eco-auto-status-body"><p class="poster-hint">Waiting for an agent.</p></div></div>
    </div></div>` },
  ] },
  'signed-out-door': { variants: [
    { name: 'with a tab', render: () => html`<div class="pf-door">
      <div class="pf-door-kicker"><span class="pf-door-address">aimeat.io/v1/profile?tab=security</span><span class="pf-door-label">This address leads inside</span></div>
      <h1 class="pf-door-title"><span>You are at the right door.</span><span class="pf-door-title-accent">Sign in, and it opens.</span></h1>
      <div class="pf-door-target"><div class="pf-door-target-path"><span class="pf-door-label">Where this address leads</span><span class="pf-door-crumb"><span class="pf-door-crumb-root">Settings &amp; Controls</span><span class="pf-door-crumb-arrow">→</span><span>Security</span></span></div><span class="poster-chip">owner only</span></div>
      <div class="pf-door-cols"><div class="pf-door-say"><p class="pf-door-lead">The address you opened leads to a page inside your Settings &amp; Controls.</p>
        <div class="pf-door-actions"><button type="button" class="poster-slab pf-door-slab">Sign in</button><button type="button" class="poster-action">Create an account</button></div></div>
        <aside class="pf-door-what poster-aside"><div class="pf-door-what-head"><span class="pf-door-label">What this is</span><span class="pf-door-what-title">New here?</span></div><p class="pf-door-what-text">What you know stays yours.</p></aside></div>
    </div>` },
  ] },
  'figure-door': { variants: [
    { name: 'default', render: () => html`<div class="pf-usage-chips">
      <button type="button" class="pf-usage-chip"><span class="pf-usage-chip-val poster-stat-number poster-stat-number--small">14</span><span class="pf-usage-chip-label">Agents</span></button>
      <button type="button" class="pf-usage-chip"><span class="pf-usage-chip-val poster-stat-number poster-stat-number--small">38/5000</span><span class="pf-usage-chip-label">Apps</span></button>
      <button type="button" class="pf-usage-chip" disabled><span class="pf-usage-chip-val poster-stat-number poster-stat-number--small">0</span><span class="pf-usage-chip-label">Cortexes</span></button>
    </div>` },
  ] },
  'requirement-list': { variants: [
    { name: 'default', render: () => html`<ul class="pf-pw-rules"><li class="ok">✓ At least 12 characters</li><li>○ Upper and lower case</li><li>○ A number</li></ul>` },
  ] },
  'org-timeline': { variants: [
    { name: 'two snapshots, the newest chosen', render: () => html`<div class="pf"><div class="pj-timeline"><div class="pj-timeline-grid">
      <ul class="pj-timeline-list">
        <li class="pj-timeline-item is-active"><button type="button" class="pj-timeline-entry"><span class="pj-timeline-date poster-time">2026-09-25 · now</span><span class="pj-timeline-event">workspace created: +workspace "Client briefs", +2 members</span><span class="pj-timeline-counts section-desc">1 ws · 0d · 0r · 3👤</span></button></li>
        <li class="pj-timeline-item"><button type="button" class="pj-timeline-entry"><span class="pj-timeline-date poster-time">2026-09-25</span><span class="pj-timeline-event">organism created: initial snapshot</span><span class="pj-timeline-counts section-desc">0 ws · 0d · 0r · 1👤</span></button></li>
      </ul>
      <div class="pj-timeline-map"><p class="section-desc">The map of the structure at the chosen point.</p></div>
    </div></div></div>` },
  ] },
  'progress-steps': { variants: [
    { name: 'one step done, one running', render: () => html`<div class="pf"><ol class="pf-nb-steps">
      <li class="pf-nb-step done">✓ Reading the note</li>
      <li class="pf-nb-step active">→ Finding where it belongs</li>
      <li class="pf-nb-step">· Writing the suggestion</li>
    </ol></div>` },
  ] },
  'org-row': { variants: [
    { name: 'a workspace, its people open', render: () => html`<div class="pf"><div class="pj-org-list poster-row--thing">
      <div class="pj-org-row">
        <div class="pj-org-avatar poster-box poster-box--avatar poster-box--small" aria-hidden="true">🗂</div>
        <div class="pj-org-main"><div class="pj-org-titlerow"><span class="pj-org-name">Client briefs</span></div><div class="pj-org-desc">2 records · 4 documents</div></div>
        <div class="pj-org-stats"><button type="button" class="pj-org-stat poster-tab poster-tab--fold is-on" aria-pressed="true">👥 3</button><span class="pj-org-stat pj-org-date poster-time">9/26/2026</span></div>
        <button type="button" class="poster-action pj-org-openbtn">Open</button>
        <div class="pj-org-detail"><div class="pj-ws-person"><span>👤 <strong>sandbox</strong></span><span class="poster-chip">creator</span><span class="pj-ws-person-agents">🤖 2</span></div><div class="pj-ws-person"><span>👤 <strong>second</strong></span></div></div>
      </div>
      <div class="pj-org-row"><div class="pj-org-avatar poster-box poster-box--avatar poster-box--small" aria-hidden="true">🗂</div><div class="pj-org-main"><div class="pj-org-titlerow"><span class="pj-org-name">Old pitches</span><span class="poster-status poster-status--off pj-ws-state">archived</span></div><div class="pj-org-desc">new</div></div><button type="button" class="poster-action pj-org-openbtn">Open</button></div>
    </div></div>` },
  ] },
  comments: { variants: [
    { name: 'a comment and its reply', render: () => html`<div class="pf"><div class="pj-comments">
      <div class="pj-comment"><div class="pj-comment-head"><b>bot#sandbox@aimeat-local-001-dev</b><span class="poster-time"> · 9/26/2026, 2:32 AM</span></div><div class="pj-comment-body">Ferries want the proposal by Friday.</div><div class="pj-comment-actions"><button type="button" class="poster-action">Reply</button></div></div>
      <div class="pj-comment pj-comment-reply"><div class="pj-comment-head"><b>bot#sandbox@aimeat-local-001-dev</b><span class="pj-mini"> · reply</span><span class="poster-time"> · 9/26/2026, 2:32 AM</span></div><div class="pj-comment-body">I will draft it on Wednesday.</div><div class="pj-comment-actions"><button type="button" class="poster-action">Reply</button></div></div>
    </div></div>` },
  ] },
  'key-name': { variants: [
    { name: 'in a listing and as a caption', render: () => html`<div class="pf"><div class="listing listing--key-doors listing--cols"><div class="listing-row"><div class="listing-name"><span class="key-name">studio/clients/nordic-ferries</span></div><div class="listing-doors"><button type="button" class="poster-action poster-action--quiet">Stop sharing</button></div></div></div>
      <div class="text-meta-sm key-name">studio/prices/day-rate</div></div>` },
  ] },
  'record-row': { variants: [
    { name: 'a draft, opened, and a record', render: () => html`<div class="pf"><div class="og og-page">
      <div class="pj-rec"><div class="pj-item pj-item-draft"><span class="poster-status poster-status--attention">draft</span><button type="button" class="pj-rec-title">lead-nordic</button><button type="button" class="poster-action">Edit</button></div>
        <div class="pj-rec-fields"><p class="og-lead">Nordic Ferries · proposal · 42000</p></div></div>
      <div class="pj-rec"><div class="pj-item"><button type="button" class="pj-rec-title">lead-lumo</button><span class="poster-chip">first call</span></div></div>
    </div></div>` },
  ] },
  'people-list': { variants: [
    { name: 'two people, one with agents', render: () => html`<div class="pf"><div class="pj-parts"><div class="pj-parts-list">
      <div class="pj-part-owner"><div class="pj-part-human"><span>👤 <strong>sandbox</strong></span><span class="poster-chip poster-chip--sun">you</span><span class="poster-chip">creator</span><span class="poster-count poster-count--tally">3</span></div>
        <div class="pj-part-agents"><span class="pj-part-agent own">🤖 bot<span class="poster-count poster-count--tally">3</span></span></div></div>
      <div class="pj-part-owner"><div class="pj-part-human"><span>👤 <strong>ana</strong></span><span class="pj-part-node">🌐 studio-node</span></div></div>
    </div></div></div>` },
  ] },
  'app-cards': { variants: [
    { name: 'two pinned apps', render: () => html`<div class="pf"><div class="pj-apps-grid">
      <div class="pj-app-card" role="button" tabindex="0"><div class="pj-app-name">🎸 Band Jam</div><div class="pj-app-desc">Play along with the band, one part each.</div><div class="pj-app-meta">sandbox</div></div>
      <div class="pj-app-card" role="button" tabindex="0"><div class="pj-app-name">Cadence</div><div class="pj-app-desc">The week's rhythm for a small team.</div><div class="pj-app-meta"><span class="poster-status poster-status--attention">Not in the catalog (removed?)</span></div></div>
    </div></div>` },
  ] },
};
