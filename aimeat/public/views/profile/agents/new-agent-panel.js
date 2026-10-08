/**
 * @file public/views/profile/agents/new-agent-panel.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Make an agent of your own, from this page, in one press: a name, what it is for,
 *   what it may reach, and a starting shape. Beside it, the proposals the owner's own agents have
 *   put in front of them.
 *
 *   WHY A NAME AND A SHAPE AND NOTHING ELSE. An agent needs a crew definition before its first
 *   start — its runtime refuses to start one that has nothing to be, and publishing a definition
 *   asks that same runtime to validate it, so the definition has to exist first. The three starting
 *   shapes here are the ones the Crew tab already offers, complete and valid as written, so the
 *   person changes words rather than structure afterwards. Choosing none is allowed and says what
 *   it costs: the agent exists and waits for a definition.
 *
 *   WHY THE PRESS IS BOTH STEPS. The proposal road exists because an AGENT may ask for an agent and
 *   only a person may create one. Here the person IS the one asking, so the panel proposes and
 *   approves in the same press: a consent screen after that would ask them to confirm what they
 *   just did. The two calls stay two calls because the second one is the gate.
 *
 *   THE CONNECTOR IS STATED, NOT DISCOVERED. Approving mints the agent's credentials on the owner's
 *   running connector. With none running the agent is still made and still defined, and the panel
 *   says it is waiting for the connector, which gives it its key when it connects. Attach stays for
 *   a connector that is running and did not take it on.
 *
 * @structure NewAgentPanel({ session, showToast, onCreated, agents, open, setOpen, onWaiting })
 * @usage <${NewAgentPanel} session=${session} showToast=${showToast} onCreated=${loadData} />
 * @version-history
 *   v2.15.0 -- 2026-10-08 -- An agent approved with no connector connected is "waiting for your connector": it gets its key when the connector connects, without a press.
 *   v2.14.0 -- 2026-10-02 -- The question marks that explain what the agent reaches and how it runs: access.scopes, agent.run_mode (components/HelpTip.js).
 *   v2.13.0 --2026-10-01 -- A `draft` from the page's examples fills the form; the section is 03, under
 *     the new "What should an agent do?" (guided journey P4).
 *   v2.12.0 -- 2026-09-26 -- Every part is a component that takes data (page group G1a): the fields
 *     are TextField and TextArea with their label and hint (the label stands over the field, as on
 *     every other form), the shape is the boxed Choice, what it reaches and how it runs are the
 *     Choice's tabs with their hint, the foot is FormActions, the agents to attach and the proposals
 *     are the List (the proposal's typewriter line is the words' line under them), the proposals
 *     under the heavy rule (Split heavy).
 *   v2.11.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v2.10.0 -- 2026-09-26 -- An agent waiting to be attached is the Listing's who cell; the list's own size and weight go (a unification: the look most tabs use).
 *   v2.9.0 -- 2026-09-25 -- The one line a folded section shows is its lead (.og-lead); it keeps only its margin (a unification: the look most tabs use).
 *   v2.8.0 -- 2026-09-25 -- A grey line that explains is the Hint (poster-hint, css/components/hint.css); a place keeps only its margin (a unification: the look most tabs use).
 *   v2.7.0 -- 2026-09-25 -- The agents waiting to be attached and the proposals waiting for you are the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v2.6.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v2.5.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v2.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v2.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v2.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v2.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v2.0.0 — 2026-09-14 — The poster face (design canvas "Your Agents"): a B1 section whose form is a
 *     label column with underlined fields, the starting shape as four tiles, reach and run as
 *     choice groups, one slab. The open state comes from the page, so its NEW AGENT slab can open
 *     this; `onWaiting` tells the page how many proposals wait, for the strip.
 *   2026-09-13 -- V2y: compose the section headline with the shared B1 class.
 *   v1.0.0 — 2026-09-08 — Initial. The proposal routes shipped 2026-09-02 with no surface at all.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { areaLine } from '/js/consent-vocab.js';
import { Section } from '/components/Section.js';
import { CREW_TEMPLATES, buildTemplate } from './crew-templates.js';
import { SCOPE_TEMPLATES } from './scope-model.js';
import { Note } from '/components/Note.js';
import { Action, Loud } from '/components/Action.js';
import { Label } from '/components/Mark.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Choice } from '/components/Choice.js';
import { List, Row, Name, Desc, Who, Doors } from '/components/List.js';
import { Split } from '/components/Layout.js';

const p = (key, vars) => t('profile.agents.page.' + key, vars);

/** The name shape the node enforces, checked here so the person is told before they press. */
const NAME_SHAPE = /^[a-z][a-z0-9-]{2,39}$/;

const BLANK = {
  name: '', displayName: '', purpose: '',
  template: 'researcher', scopes: 'standard', runMode: 'spawn',
};

export default function NewAgentPanel({ session, showToast, onCreated, agents, open, setOpen, onWaiting, draft }) {
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState([]);

  // An example picked on the page (agents/agent-guide.js NoAgentsYet) fills the name and the purpose;
  // the person still reads and presses Create.
  useEffect(() => { if (draft) setForm(f => ({ ...f, ...draft })); }, [draft]);

  // The fields and the choices hand over the value itself (components/TextField.js, Choice.js).
  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v }));
  const pick = (k) => (v) => setForm(f => ({ ...f, [k]: v }));

  async function load() {
    try {
      const resp = await apiGet('/v1/agents/v2/agent-proposals');
      const list = (resp?.data?.proposals ?? []).filter(x => x.state === 'proposed');
      setWaiting(list);
      onWaiting?.(list.length);
    } catch (err) { swallowed('new-agent-panel: load', err); setWaiting([]); onWaiting?.(0); }
  }

  // Loaded once per session; load() reads only stable setters and the parent's callback, and the
  // live-update listener below carries every later refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (session) load(); }, [session]);

  // An agent appearing, or another session approving a proposal, is an `agents` change.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const handler = (e) => {
      const d = e.detail?.domains;
      if (d && !d.has('agents') && !d.has('open-items')) return;
      loadRef.current();
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  /** What came back from an approval, said once, in the words of what is true now. */
  function announce(data, displayName) {
    const key = data?.attached ? 'done' : data?.waiting_for_connector ? 'madeWaiting' : 'madeNotRunning';
    showToast(t('profile.agents.new.' + key).replaceAll('{name}', displayName));
  }

  async function create() {
    const name = form.name.trim();
    if (!NAME_SHAPE.test(name)) { showToast(t('profile.agents.new.badName'), true); return; }
    if (form.purpose.trim().length < 10) { showToast(t('profile.agents.new.badPurpose'), true); return; }

    setBusy(true);
    try {
      // Two calls, because the second one is the gate: proposing creates nothing, and the owner's
      // own press is what creates. Here the same person does both in one action.
      const proposed = await apiPost('/v1/agents/v2/agent-proposals', {
        name,
        display_name: form.displayName.trim() || name,
        purpose: form.purpose.trim(),
        scopes: SCOPE_TEMPLATES[form.scopes] ?? SCOPE_TEMPLATES.standard,
        run_mode: form.runMode,
        crew_def: form.template === 'none' ? null : buildTemplate(form.template, name),
      });
      const id = proposed?.data?.proposal?.id;
      if (!id) throw new Error(t('profile.agents.new.failed'));
      const approved = await apiPost(`/v1/agents/v2/agent-proposals/${encodeURIComponent(id)}/approve`, {});
      announce(approved?.data, form.displayName.trim() || name);
      setForm(BLANK);
      setOpen(false);
      await load();
      onCreated?.();
    } catch (err) {
      showToast(err?.message || t('profile.agents.new.failed'), true);
    } finally {
      setBusy(false);
    }
  }

  async function settle(proposal, decision) {
    setBusy(true);
    try {
      const resp = await apiPost(
        `/v1/agents/v2/agent-proposals/${encodeURIComponent(proposal.id)}/${decision}`, {},
      );
      if (decision === 'approve') announce(resp?.data, proposal.display_name || proposal.name);
      else showToast(t('profile.agents.new.declined').replace('{name}', proposal.display_name || proposal.name));
      await load();
      onCreated?.();
    } catch (err) {
      showToast(err?.message || t('profile.agents.new.failed'), true);
    } finally {
      setBusy(false);
    }
  }

  async function attach(agent) {
    const label = agent.display_name || agent.name;
    setBusy(true);
    try {
      await apiPost(`/v1/agents/v2/agents/${encodeURIComponent(agent.name)}/attach`, {});
      showToast(t('profile.agents.new.attached').replace('{name}', label));
      onCreated?.();
    } catch (err) {
      showToast(err?.message || t('profile.agents.new.attachFailed'), true);
    } finally {
      setBusy(false);
    }
  }

  const scopeList = SCOPE_TEMPLATES[form.scopes] ?? SCOPE_TEMPLATES.standard;

  // AGENTS THIS ACCOUNT OWNS THAT NOTHING IS RUNNING: created and defined, with no key, because the
  // connector was down when they were approved. Each one is waiting for the connector: the node
  // offers its key when the connector connects (services/agent-pending-enrolment.ts), and Attach
  // stays for a connector that is already running and did not take it on. Read from the fleet listing rather than remembered
  // from this session's own press — the person who approves on their phone and comes back tomorrow
  // is the ordinary case, and a repair only the creating tab knows about is no repair at all.
  const unattached = (agents ?? []).filter(a => a.identity_version === 2 && a.card_enrolled === false);

  const door = html`<${Action} small soft onClick=${() => setOpen(!open)}>${open ? p('close') : p('open')}<//>`;
  const shapes = [...CREW_TEMPLATES.map(tpl => ({ id: tpl.id, name: t(tpl.nameKey), desc: t(tpl.descKey) })),
    { id: 'none', name: t('profile.agents.new.shapeNone'), desc: t('profile.agents.new.shapeNoneHint') }];

  return html`
    <${Section} id="agp-new" num="03" title=${t('profile.agents.new.title')}
      count=${waiting.length > 0 ? p('waitingCount', { n: waiting.length }) : null} doors=${door}>
      ${!open && waiting.length === 0 && unattached.length === 0
        ? html`<${Note} kind="lead">${t('profile.agents.new.desc')}<//>`
        : null}

      ${open && html`
        <${Note} kind="lead">${t('profile.agents.new.desc')}<//>
        <${Fields}>
          <${TextField} label=${t('profile.agents.new.name')} hint=${t('profile.agents.new.nameHint')}
            value=${form.name} onInput=${set('name')} placeholder="news-watcher" />
          <${TextField} label=${t('profile.agents.new.displayName')}
            value=${form.displayName} onInput=${set('displayName')} placeholder=${form.name ? form.name : ''} />
          <${TextArea} label=${t('profile.agents.new.purpose')} rows=${2}
            value=${form.purpose} onInput=${set('purpose')} placeholder=${t('profile.agents.new.purposePlaceholder')} />
          <${Choice} boxed cols=${4} label=${t('profile.agents.new.shape')} hint=${p('shapeHint')}
            value=${form.template} onChange=${pick('template')}
            options=${shapes.map(s => ({ value: s.id, label: s.name, hint: s.desc }))} />
          ${/* The wildcard has no areas to name — areaLine renders it as a bare asterisk, which
                tells the reader nothing about what they are handing over. */''}
          <${Choice} label=${t('profile.agents.new.reaches')} help="access.scopes"
            hint=${form.scopes === 'full' ? t('profile.agents.new.scopesFullHint') : areaLine(scopeList, t)}
            value=${form.scopes} onChange=${pick('scopes')}
            options=${[['readonly', 'scopesReadonly'], ['standard', 'scopesStandard'], ['full', 'scopesFull']].map(([v, key]) => ({ value: v, label: t('profile.agents.new.' + key) }))} />
          <${Choice} label=${t('profile.agents.new.runModeLabel')} help="agent.run_mode"
            hint=${form.runMode === 'spawn' ? t('profile.agents.new.runModeSpawnHint') : t('profile.agents.new.runModeResidentHint')}
            value=${form.runMode} onChange=${pick('runMode')}
            options=${['spawn', 'resident'].map(v => ({ value: v, label: t('profile.agents.runMode.' + v) }))} />
          <${FormActions}>
            <${Loud} control disabled=${busy} onClick=${create}>
              ${busy ? t('profile.agents.new.working') : t('profile.agents.new.create')}
            <//>
            <${Action} small onClick=${() => setOpen(false)}>${t('profile.agents.detail.zone2.cancel')}<//>
          <//>
        <//>`}

      ${unattached.length > 0 && html`
        <${List} cols="name-state">
          ${unattached.map(a => html`
            <${Row} key=${a.gaii || a.name}>
              <${Who}>${t('profile.agents.new.attachHint').replace('{name}', a.display_name || a.name)}<//>
              <${Doors}>
                <${Action} small row disabled=${busy} onClick=${() => attach(a)}>
                  ${t('profile.agents.new.attach')}
                <//>
              <//>
            <//>`)}
        <//>`}

      ${waiting.length > 0 && html`
        <${Split} heavy above="large">
          <${Label} block>${t('profile.agents.new.waitingTitle')}<//>
          <${List} cols="name-desc-doors">
            ${waiting.map(pr => html`
              <${Row} key=${pr.id}>
                <${Name}>${pr.display_name || pr.name}<//>
                <${Desc} sub=${html`
                    ${t('profile.agents.new.proposedBy').replace('{who}', pr.proposed_by)}
                    ${(pr.scopes ?? []).length > 0 && html` · ${areaLine(pr.scopes, t)}`}
                    ${!pr.crew_def && html` · ${t('profile.agents.new.noDefinition')}`}`}>${pr.purpose}<//>
                <${Doors}>
                  <${Loud} control disabled=${busy} onClick=${() => settle(pr, 'approve')}>
                    ${t('profile.agents.new.approve')}
                  <//>
                  <${Action} small row disabled=${busy} onClick=${() => settle(pr, 'decline')}>
                    ${t('profile.agents.new.decline')}
                  <//>
                <//>
              <//>`)}
          <//>
        <//>`}
    <//>
  `;
}
