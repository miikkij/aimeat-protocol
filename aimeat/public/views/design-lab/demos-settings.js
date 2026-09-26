/**
 * @file public/views/design-lab/demos-settings.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Live demos of the parts of Settings & Controls (UI consolidation phase 5), each drawn
 *   by the real component inside the page's scope root (.pf), as the page draws it.
 * @structure SETTINGS_DEMOS
 * @usage import { SETTINGS_DEMOS } from './demos-settings.js';
 * @version-history
 *   v1.87.1 — 2026-09-27 — The demos of listing, search-line, more-line and key-name move to demos-list.js and
 *     board-notices to demos-conversation.js, drawn by calling List, SearchLine, More, Name asKey and BoardNotice.
 *   v1.87.0 — 2026-09-27 — The demos of schedule-calendar, week-rhythm, job-chips, workflow-steps, eco-automation,
 *     score-chart, morsel-flow, offer-map, offer-request, rating-stars, job-prompt and progress-steps move to
 *     demos-views-work.js, drawn by calling their components (the catalogue pass); the ScoreChart import goes.
 *   v1.86.0 — 2026-09-27 — The demos of tab-page, crumb-trail, page-head, page-section, fold-row and sub-heading
 *     move to demos-page-kit.js, drawn by calling Rail, Crumb, PageHead, PageSection, FoldSection and SubHeading (the catalogue pass).
 *   v1.85.0 — 2026-09-27 — The demos of facts, figure-strip, code-block, form-message, setting-box and loading-mark
 *     move to demos-kit.js, drawn by calling Facts, FigureStrip, Code, Note and SettingBox (the catalogue pass).
 *   v1.84.0 — 2026-09-27 — The demos of select-field, check-line, tag-input, model-picker, file-drop, form-fields and
 *     field-row move to demos-fields.js, drawn by calling their components (the catalogue pass).
 *   v1.83.0 — 2026-09-27 — The demos of the parts no page draws any more go with their entries and sheets (page row,
 *     tier list, uses list, sent log, delegation lines, app picker, item grid, access log, heatmap, to-do list,
 *     crew DAG, drag grip, figure door, requirement list, organism timeline, organism row, comments, record row,
 *     people list, app cards, calibration run, prompt versions, offer lines, offer hits, package preview,
 *     notification feed, how roads, device list, agent chip, search hits): the List, Box, Card, Roads, People,
 *     ActivityCalendar, SnapshotTimeline, TaskGraph, StepStrip, RunView and Message draw them now, each in its own demo.
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
import { Switch } from '/components/Switch.js';

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
  'space-table': { variants: [
    { name: 'head and two rows', render: () => html`<div class="pf"><div class="og">
      <div class="og-tbl og-tbl--head"><div></div><div>Space</div><div>Items</div><div>Last change</div><div></div></div>
      <div class="og-tbl"><div class="og-tbl-n">01</div><div class="og-tbl-nm"><button type="button" class="og-tbl-name">Client briefs</button><span class="og-tbl-marks"><span class="og-chip og-chip--xs">shared</span></span></div><div>12</div><div class="og-tbl-last">today · second</div><div class="og-tbl-door"><button type="button" class="og-door">Open</button></div></div>
      <div class="og-tbl"><div class="og-tbl-n">02</div><div class="og-tbl-nm"><button type="button" class="og-tbl-name">Notes</button></div><div>3</div><div class="og-tbl-last">2 days ago</div><div class="og-tbl-door"><button type="button" class="og-door">Open</button></div></div></div></div>` },
  ] },
  switch: { variants: [
    { name: 'on and off', render: () => html`<div class="pf"><${Switch} on=${true} label="push" onToggle=${noop} /> <${Switch} on=${false} label="digest" onToggle=${noop} /></div>` },
    { name: 'locked', render: () => html`<div class="pf"><${Switch} on locked label="always" /></div>` },
    { name: 'without a word', render: () => html`<div class="pf"><${Switch} on=${true} ariaLabel="Suggest while I chat" onToggle=${noop} /></div>` },
  ] },
  'knowledge-entry': { variants: [
    { name: 'default', render: () => html`<div class="pf"><div class="og og-kp"><div class="kp-entry"><div class="kp-entry-h"><button type="button" class="kp-entry-title">Who may write to shared memory</button><div class="kp-entry-r"><span class="poster-chip poster-chip--sun">public</span></div></div><p class="kp-entry-text">Only agents the owner approved may write.</p><div class="kp-refs"><div class="kp-ref"><i>verified</i><a href="#">The owner's policy page</a></div><div class="kp-ref"><i class="kp-ref--no">unverified</i><a href="#">A blog post</a></div></div><div class="kp-rels"><button type="button" class="kp-rel"><b>extends</b>escalation</button></div></div></div></div>` },
  ] },
};
