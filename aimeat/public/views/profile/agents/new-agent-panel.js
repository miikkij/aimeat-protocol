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
 *   says it is not running yet and offers Attach, which is one call away once the connector is up.
 *
 * @structure NewAgentPanel({ session, showToast, onCreated, agents, open, setOpen, onWaiting })
 * @usage <${NewAgentPanel} session=${session} showToast=${showToast} onCreated=${loadData} />
 * @version-history
 *   v3.0.1 -- 2026-09-22 -- The starting shapes are the set's choice tiles (the name in bold, the
 *     description under it, the chosen one on the sun) in four columns; a proposal's Approve and
 *     Decline are words in the success and danger tones instead of a second slab; the bare wrapper
 *     around the proposals is gone.
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared set (components/poster-parts.js): the form is
 *     Fields, the starting shape and the reach and run choices are radio groups of the shared tab
 *     action (a shape's description stands under its name), the proposals are list rows with their
 *     approve and decline actions. No class of its own.
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
import { Section, Stack, Columns, ListRow, Field, Action, Text } from '/components/poster-parts.js';
import { CREW_TEMPLATES, buildTemplate } from './crew-templates.js';
import { SCOPE_TEMPLATES } from './scope-model.js';

const p = (key, vars) => t('profile.agents.page.' + key, vars);

/** The name shape the node enforces, checked here so the person is told before they press. */
const NAME_SHAPE = /^[a-z][a-z0-9-]{2,39}$/;

const BLANK = {
  name: '', displayName: '', purpose: '',
  template: 'researcher', scopes: 'standard', runMode: 'spawn',
};

export default function NewAgentPanel({ session, showToast, onCreated, agents, open, setOpen, onWaiting }) {
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState([]);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const pick = (k, v) => () => setForm(f => ({ ...f, [k]: v }));

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
    showToast(data?.attached
      ? t('profile.agents.new.done').replace('{name}', displayName)
      : t('profile.agents.new.madeNotRunning').replace('{name}', displayName));
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
  // connector was down when they were approved. Read from the fleet listing rather than remembered
  // from this session's own press — the person who approves on their phone and comes back tomorrow
  // is the ordinary case, and a repair only the creating tab knows about is no repair at all.
  const unattached = (agents ?? []).filter(a => a.identity_version === 2 && a.card_enrolled === false);

  const door = html`<${Action} expanded=${open} onClick=${() => setOpen(!open)}>${open ? p('close') : p('open')}<//>`;
  const shapes = [...CREW_TEMPLATES.map(tpl => ({ id: tpl.id, name: t(tpl.nameKey), desc: t(tpl.descKey) })),
    { id: 'none', name: t('profile.agents.new.shapeNone'), desc: t('profile.agents.new.shapeNoneHint') }];

  /** A labelled group of radio choices: the label, an optional note, the choices, an optional hint. */
  const choices = (label, note, items, current, key, hint) => html`
    <${Stack} density="compact">
      <${Text} kind="label">${label}<//>
      ${note && html`<${Text} kind="caption" tone="muted">${note}<//>`}
      <${Stack} direction="wrap" role="radiogroup" label=${label}>
        ${items.map(([v, word]) => html`
          <${Action} kind="tab" semantics="radio" key=${v} selected=${current === v} onClick=${pick(key, v)}>${word}<//>`)}
      <//>
      ${hint && html`<${Text} kind="caption" tone="muted">${hint}<//>`}
    <//>`;

  return html`
    <${Section} id="agp-new" density="compact" title=${t('profile.agents.new.title')}
      count=${waiting.length > 0 ? p('waitingCount', { n: waiting.length }) : '02'} actions=${door}>
      <${Stack}>
      ${!open && waiting.length === 0 && unattached.length === 0
        ? html`<${Text} tone="muted">${t('profile.agents.new.desc')}<//>`
        : null}

      ${open && html`
        <${Text} kind="lead">${t('profile.agents.new.desc')}<//>
        <${Stack}>
          <${Field} label=${t('profile.agents.new.name')} hint=${t('profile.agents.new.nameHint')}
            value=${form.name} onInput=${set('name')} placeholder="news-watcher" />
          <${Field} label=${t('profile.agents.new.displayName')}
            value=${form.displayName} onInput=${set('displayName')} placeholder=${form.name ? form.name : ''} />
          <${Field} type="textarea" rows=${2} label=${t('profile.agents.new.purpose')}
            value=${form.purpose} onInput=${set('purpose')} placeholder=${t('profile.agents.new.purposePlaceholder')} />

          <${Stack} density="compact">
            <${Text} kind="label">${t('profile.agents.new.shape')}<//>
            <${Text} kind="caption" tone="muted">${p('shapeHint')}<//>
            <${Stack} role="radiogroup" label=${t('profile.agents.new.shape')}>
              <${Columns} layout="quarters" collapse="900">
                ${shapes.map(s => html`
                  <${Action} kind="choice" semantics="radio" key=${s.id} title=${s.name}
                    selected=${form.template === s.id} onClick=${pick('template', s.id)}>${s.desc}<//>`)}
              <//>
            <//>
          <//>

          ${/* The wildcard has no areas to name — areaLine renders it as a bare asterisk, which
                tells the reader nothing about what they are handing over. */''}
          ${choices(t('profile.agents.new.reaches'),
            form.scopes === 'full' ? t('profile.agents.new.scopesFullHint') : areaLine(scopeList, t),
            [['readonly', 'scopesReadonly'], ['standard', 'scopesStandard'], ['full', 'scopesFull']].map(([v, key]) => [v, t('profile.agents.new.' + key)]),
            form.scopes, 'scopes', null)}

          ${choices(t('profile.agents.new.runModeLabel'), null,
            ['spawn', 'resident'].map(v => [v, t('profile.agents.runMode.' + v)]),
            form.runMode, 'runMode',
            form.runMode === 'spawn' ? t('profile.agents.new.runModeSpawnHint') : t('profile.agents.new.runModeResidentHint'))}

          <${Stack} direction="wrap" align="center">
            <${Action} kind="primary" disabled=${busy} onClick=${create}>
              ${busy ? t('profile.agents.new.working') : t('profile.agents.new.create')}
            <//>
            <${Action} onClick=${() => setOpen(false)}>${t('profile.agents.detail.zone2.cancel')}<//>
          <//>
        <//>`}

      ${unattached.map(a => html`
        <${ListRow} key=${a.gaii || a.name} detailKind="text"
          name=${a.display_name || a.name}
          detail=${t('profile.agents.new.attachHint').replace('{name}', a.display_name || a.name)}
          actions=${html`<${Action} disabled=${busy} onClick=${() => attach(a)}>${t('profile.agents.new.attach')}<//>`} />`)}

      ${waiting.length > 0 && html`
        <${Stack} density="compact">
          <${Text} kind="label">${t('profile.agents.new.waitingTitle')}<//>
          ${waiting.map(pr => html`
            <${ListRow} key=${pr.id} detailKind="text"
              name=${pr.display_name || pr.name}
              detail=${pr.purpose}
              actions=${html`
                <${Action} tone="success" disabled=${busy} onClick=${() => settle(pr, 'approve')}>
                  ${t('profile.agents.new.approve')}
                <//>
                <${Action} tone="danger" disabled=${busy} onClick=${() => settle(pr, 'decline')}>
                  ${t('profile.agents.new.decline')}
                <//>`}>
              <${Text} kind="mono" tone="muted">
                ${t('profile.agents.new.proposedBy').replace('{who}', pr.proposed_by)}
                ${(pr.scopes ?? []).length > 0 && html` · ${areaLine(pr.scopes, t)}`}
                ${!pr.crew_def && html` · ${t('profile.agents.new.noDefinition')}`}
              <//>
            <//>`)}
        <//>`}
      <//>
    <//>
  `;
}
