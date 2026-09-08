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
 * @structure NewAgentPanel({ session, showToast, onCreated })
 * @usage <${NewAgentPanel} session=${session} showToast=${showToast} onCreated=${loadData} />
 * @version-history
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
import { CREW_TEMPLATES, buildTemplate } from './crew-templates.js';
import { SCOPE_TEMPLATES } from './scope-model.js';

/** The name shape the node enforces, checked here so the person is told before they press. */
const NAME_SHAPE = /^[a-z][a-z0-9-]{2,39}$/;

const BLANK = {
  name: '', displayName: '', purpose: '',
  template: 'researcher', scopes: 'standard', runMode: 'spawn',
};

export default function NewAgentPanel({ session, showToast, onCreated, agents }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState([]);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function load() {
    try {
      const resp = await apiGet('/v1/agents/v2/agent-proposals');
      setWaiting((resp?.data?.proposals ?? []).filter(p => p.state === 'proposed'));
    } catch (err) { swallowed('new-agent-panel: load', err); setWaiting([]); }
  }

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

  return html`
    <div class="pf-agd-new">
      <div class="pf-agd-basic-head">
        <div>
          <div class="pf-agd-basic-title">${t('profile.agents.new.title')}</div>
          <div class="pf-agd-basic-desc">${t('profile.agents.new.desc')}</div>
        </div>
        <button class="btn-primary btn-sm" onClick=${() => setOpen(!open)}>
          ${open ? t('profile.agents.new.close') : t('profile.agents.new.button')}
        </button>
      </div>

      ${unattached.map(a => html`
        <div class="pf-agd-new-attach" key=${a.gaii || a.name}>
          <span>${t('profile.agents.new.attachHint').replace('{name}', a.display_name || a.name)}</span>
          <button class="btn-outline btn-sm" disabled=${busy} onClick=${() => attach(a)}>
            ${t('profile.agents.new.attach')}
          </button>
        </div>`)}

      ${open && html`
        <div class="pf-agd-new-form">
          <label class="pf-agd-new-field">
            <span class="pf-agd-new-label">${t('profile.agents.new.name')}</span>
            <input type="text" value=${form.name} onInput=${set('name')} placeholder="news-watcher" />
            <span class="pf-agd-new-hint">${t('profile.agents.new.nameHint')}</span>
          </label>

          <label class="pf-agd-new-field">
            <span class="pf-agd-new-label">${t('profile.agents.new.displayName')}</span>
            <input type="text" value=${form.displayName} onInput=${set('displayName')} />
          </label>

          <label class="pf-agd-new-field pf-agd-new-field--wide">
            <span class="pf-agd-new-label">${t('profile.agents.new.purpose')}</span>
            <textarea rows="2" value=${form.purpose} onInput=${set('purpose')}
              placeholder=${t('profile.agents.new.purposePlaceholder')}></textarea>
          </label>

          <label class="pf-agd-new-field">
            <span class="pf-agd-new-label">${t('profile.agents.new.shape')}</span>
            <select value=${form.template} onInput=${set('template')}>
              ${CREW_TEMPLATES.map(tpl => html`
                <option value=${tpl.id} key=${tpl.id}>${t(tpl.nameKey)}</option>`)}
              <option value="none">${t('profile.agents.new.shapeNone')}</option>
            </select>
            <span class="pf-agd-new-hint">
              ${form.template === 'none'
                ? t('profile.agents.new.shapeNoneHint')
                : t(CREW_TEMPLATES.find(x => x.id === form.template)?.descKey ?? '')}
            </span>
          </label>

          <label class="pf-agd-new-field">
            <span class="pf-agd-new-label">${t('profile.agents.new.reaches')}</span>
            <select value=${form.scopes} onInput=${set('scopes')}>
              <option value="readonly">${t('profile.agents.new.scopesReadonly')}</option>
              <option value="standard">${t('profile.agents.new.scopesStandard')}</option>
              <option value="full">${t('profile.agents.new.scopesFull')}</option>
            </select>
            ${/* The wildcard has no areas to name — areaLine renders it as a bare asterisk, which
                  tells the reader nothing about what they are handing over. */''}
            <span class="pf-agd-new-hint">
              ${form.scopes === 'full' ? t('profile.agents.new.scopesFullHint') : areaLine(scopeList, t)}
            </span>
          </label>

          <label class="pf-agd-new-field">
            <span class="pf-agd-new-label">${t('profile.agents.new.runModeLabel')}</span>
            <select value=${form.runMode} onInput=${set('runMode')}>
              <option value="spawn">${t('profile.agents.runMode.spawn')}</option>
              <option value="resident">${t('profile.agents.runMode.resident')}</option>
            </select>
            <span class="pf-agd-new-hint">
              ${form.runMode === 'spawn'
                ? t('profile.agents.new.runModeSpawnHint')
                : t('profile.agents.new.runModeResidentHint')}
            </span>
          </label>

          <div class="pf-agd-new-actions">
            <button class="btn-primary btn-sm" disabled=${busy} onClick=${create}>
              ${busy ? t('profile.agents.new.working') : t('profile.agents.new.create')}
            </button>
          </div>
        </div>`}

      ${waiting.length > 0 && html`
        <div class="pf-agd-new-waiting">
          <div class="pf-agd-new-waiting-title">${t('profile.agents.new.waitingTitle')}</div>
          ${waiting.map(p => html`
            <div class="pf-agd-new-waiting-row" key=${p.id}>
              <div>
                <div class="pf-agd-basic-name">${p.display_name || p.name}</div>
                <div class="pf-agd-basic-item-desc">${p.purpose}</div>
                <div class="pf-agd-new-hint">
                  ${t('profile.agents.new.proposedBy').replace('{who}', p.proposed_by)}
                  ${(p.scopes ?? []).length > 0 && html` · ${areaLine(p.scopes, t)}`}
                  ${!p.crew_def && html` · ${t('profile.agents.new.noDefinition')}`}
                </div>
              </div>
              <div class="pf-agd-new-waiting-actions">
                <button class="btn-primary btn-sm" disabled=${busy} onClick=${() => settle(p, 'approve')}>
                  ${t('profile.agents.new.approve')}
                </button>
                <button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => settle(p, 'decline')}>
                  ${t('profile.agents.new.decline')}
                </button>
              </div>
            </div>`)}
        </div>`}
    </div>
  `;
}
