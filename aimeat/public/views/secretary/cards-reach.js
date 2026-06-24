/**
 * @file secretary/cards-reach.js
 * @description Presentational cards for the Secretary's P2 "reach" capabilities (kept out of cards.js so
 *   both stay under the file-size limit). Each export is a PURE render function taking a props bag — no
 *   hooks, no state. Cards: createResourceCard (P2-A create-don't-just-find) · knowledgeCard (P2-B
 *   knowledge custodian) · accessCard (P2-C access gatekeeper) · crewCard (P2-D crew setup). The owning
 *   view passes the matching hook (use-create-resource / use-knowledge / use-access / use-crew) in.
 *   See views/secretary.js + docs/plans/2026-06-24-secretary-p2-fix-prompt.md.
 * @structure createResourceCard · knowledgeCard · accessCard · crewCard
 * @usage import { createResourceCard, knowledgeCard, accessCard, crewCard } from '/views/secretary/cards-reach.js';
 * @version-history
 *   v0.3.0 — 2026-06-25 — crewCard gains an "Add a specialist" form + an app-style scope-CONSENT checklist:
 *     when the chosen role declares requestable extras, the owner approves a subset before they are granted
 *     (declare→consent→grant). No extras → no consent step.
 *   v0.2.0 — 2026-06-24 — G2: createResourceCard shows a clear "disabled on this node" message when the
 *     session can't create a capability; G3: knowledgeCard adds a Draft-band knowledge-link sub-section.
 *   v0.1.0 — 2026-06-24 — P2: create-resource / knowledge / access / crew cards.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';

/** P2-A — when discover finds nothing, offer to CREATE the missing capability (Draft → approve). */
export function createResourceCard(p) {
  return html`
    <section class="sec-card sec-create">
      <h2 class="sec-h2">${t('secretary.create.title')}</h2>
      ${p.created ? html`
        <div class="sec-plan-result">
          <div class="sec-status"><span class="sec-dot"></span> ${t('secretary.create.done')}</div>
          <p class="sec-purpose">${escHtml(p.created.name)}</p>
          <p class="sec-hint"><code>${escHtml(p.created.id)}</code></p>
          <button class="btn-ghost btn-sm" onClick=${p.reset}>${t('secretary.plan.new')}</button>
        </div>`
      : p.draft ? html`
        <p class="sec-hint">${t('secretary.create.reviewHint')}</p>
        <div class="sec-form">
          <input class="sec-input" placeholder=${t('secretary.create.name')} value=${p.draft.name} onInput=${(e) => p.setField('name', e.target.value)} />
          <textarea class="sec-paste" rows="2" placeholder=${t('secretary.create.summary')} value=${p.draft.summary} onInput=${(e) => p.setField('summary', e.target.value)}></textarea>
          <input class="sec-input" placeholder=${t('secretary.create.whenToUse')} value=${p.draft.whenToUse} onInput=${(e) => p.setField('whenToUse', e.target.value)} />
          <div class="sec-actions">
            <button class="btn-ghost btn-sm" onClick=${p.reset}>${t('secretary.cancel')}</button>
            <button class="btn-primary" disabled=${!p.draft.name.trim() || p.creating} onClick=${p.approve}>${p.creating ? t('secretary.applying') : t('secretary.create.approve')}</button>
          </div>
        </div>`
      : p.canCreate === false ? html`
        <p class="sec-hint">${t('secretary.create.disabled')}</p>`
      : html`
        <p class="sec-hint">${t('secretary.create.emptyHint')}</p>
        <button class="btn-outline btn-sm" disabled=${!p.query || !p.query.trim() || p.canCreate === null} onClick=${() => p.startDraft(p.query)}>${t('secretary.create.start')}</button>`}
    </section>`;
}

/** P2-B — promote a refined note/decision into the shareable knowledge base (Draft → approve). */
export function knowledgeCard(p) {
  const f = p.form;
  return html`
    <section class="sec-card sec-knowledge">
      <div class="sec-card-head">
        <h2 class="sec-h2">${t('secretary.knowledge.title')}</h2>
        <button class="btn-ghost btn-sm" onClick=${() => p.setForm({ ...f, open: !f.open })}>${f.open ? t('secretary.cancel') : t('secretary.knowledge.add')}</button>
      </div>
      <p class="sec-hint">${t('secretary.knowledge.hint')}</p>
      ${f.open ? html`
        <div class="sec-form">
          <input class="sec-input" placeholder=${t('secretary.knowledge.titlePlaceholder')} value=${f.title} onInput=${(e) => p.setForm({ ...f, title: e.target.value })} />
          <textarea class="sec-paste" rows="3" placeholder=${t('secretary.knowledge.bodyPlaceholder')} value=${f.body} onInput=${(e) => p.setForm({ ...f, body: e.target.value })}></textarea>
          <label class="sec-hint"><input type="checkbox" checked=${f.shareCatalog} onChange=${(e) => p.setForm({ ...f, shareCatalog: e.target.checked })} /> ${t('secretary.knowledge.shareCatalog')}</label>
          <button class="btn-primary" disabled=${!f.title.trim() || !f.body.trim() || f.saving} onClick=${p.contribute}>${f.saving ? t('secretary.applying') : t('secretary.knowledge.contribute')}</button>
        </div>` : null}
      ${p.created ? html`
        <div class="sec-plan-result">
          <div class="sec-status"><span class="sec-dot"></span> ${t('secretary.knowledge.done')}</div>
          <p class="sec-purpose">${escHtml(p.created.name)}</p>
          <p class="sec-hint"><code>${escHtml(p.created.package_id)}</code></p>
        </div>` : null}

      ${(p.packages || []).length >= 2 ? html`
        <div class="sec-card-head">
          <h3 class="sec-h3">${t('secretary.knowledge.linkTitle')}</h3>
          <button class="btn-ghost btn-sm" onClick=${() => p.setLinkForm({ ...p.linkForm, open: !p.linkForm.open })}>${p.linkForm.open ? t('secretary.cancel') : t('secretary.knowledge.linkAdd')}</button>
        </div>
        ${p.linkForm.open ? html`
          <div class="sec-form">
            <div class="sec-note-bar">
              <select class="sec-band" value=${p.linkForm.sourceId} onChange=${(e) => p.setLinkForm({ ...p.linkForm, sourceId: e.target.value })}>
                <option value="">${t('secretary.knowledge.linkSource')}</option>
                ${p.packages.map((pk) => html`<option value=${pk.id} selected=${p.linkForm.sourceId === pk.id}>${escHtml(pk.name)}</option>`)}
              </select>
              <select class="sec-band" value=${p.linkForm.relation} onChange=${(e) => p.setLinkForm({ ...p.linkForm, relation: e.target.value })}>
                ${(p.LINK_RELATIONS || []).map((rel) => html`<option value=${rel} selected=${p.linkForm.relation === rel}>${rel}</option>`)}
              </select>
              <select class="sec-band" value=${p.linkForm.targetId} onChange=${(e) => p.setLinkForm({ ...p.linkForm, targetId: e.target.value })}>
                <option value="">${t('secretary.knowledge.linkTarget')}</option>
                ${p.packages.map((pk) => html`<option value=${pk.id} selected=${p.linkForm.targetId === pk.id}>${escHtml(pk.name)}</option>`)}
              </select>
            </div>
            <input class="sec-input" placeholder=${t('secretary.knowledge.linkDesc')} value=${p.linkForm.description} onInput=${(e) => p.setLinkForm({ ...p.linkForm, description: e.target.value })} />
            <button class="btn-primary" disabled=${!p.linkForm.sourceId || !p.linkForm.targetId || p.linkForm.sourceId === p.linkForm.targetId || !p.linkForm.description.trim() || p.linkForm.saving} onClick=${p.createLink}>${p.linkForm.saving ? t('secretary.applying') : t('secretary.knowledge.linkApprove')}</button>
          </div>` : null}
        ${p.linkResult ? html`
          <div class="sec-status"><span class="sec-dot"></span> ${escHtml(p.linkResult.sourceName)} <em>${escHtml(p.linkResult.relation)}</em> ${escHtml(p.linkResult.targetName)}</div>` : null}` : null}
    </section>`;
}

/** P2-C — manage the owner's OWN consent grants + sharing groups. */
export function accessCard(p) {
  const gf = p.grantForm;
  const grpf = p.groupForm;
  return html`
    <section class="sec-card sec-access">
      <h2 class="sec-h2">${t('secretary.access.title')}</h2>
      <p class="sec-hint">${t('secretary.access.hint')}</p>

      <div class="sec-card-head">
        <h3 class="sec-h3">${t('secretary.access.grantsTitle')}</h3>
        <button class="btn-ghost btn-sm" onClick=${() => p.setGrantForm({ ...gf, open: !gf.open })}>${gf.open ? t('secretary.cancel') : t('secretary.access.propose')}</button>
      </div>
      ${gf.open ? html`
        <div class="sec-form">
          <input class="sec-input" placeholder=${t('secretary.access.dataPattern')} value=${gf.dataPattern} onInput=${(e) => p.setGrantForm({ ...gf, dataPattern: e.target.value })} />
          <input class="sec-input" placeholder=${t('secretary.access.recipient')} value=${gf.recipient} onInput=${(e) => p.setGrantForm({ ...gf, recipient: e.target.value })} />
          <input class="sec-input" placeholder=${t('secretary.access.purpose')} value=${gf.purpose} onInput=${(e) => p.setGrantForm({ ...gf, purpose: e.target.value })} />
          <button class="btn-primary" disabled=${!gf.dataPattern.trim() || !gf.recipient.trim() || !gf.purpose.trim() || gf.saving} onClick=${p.approveGrant}>${gf.saving ? t('secretary.applying') : t('secretary.access.approveGrant')}</button>
        </div>` : null}
      ${p.consents.length === 0
        ? html`<div class="sec-hint">${t('secretary.access.noGrants')}</div>`
        : html`<ul class="sec-goal-list">
            ${p.consents.map((c) => html`<li class="sec-goal-row" key=${c.id}>
              <div class="sec-goal-main">
                <div class="sec-goal-title">${escHtml(c.recipient)}</div>
                <div class="sec-hint"><code>${escHtml(c.data_pattern)}</code> · ${escHtml(c.purpose)}</div>
              </div>
              <button class="btn-ghost btn-sm" onClick=${() => p.revokeGrant(c.id)}>${t('secretary.access.revoke')}</button>
            </li>`)}
          </ul>`}

      <div class="sec-card-head">
        <h3 class="sec-h3">${t('secretary.access.groupsTitle')}</h3>
        <button class="btn-ghost btn-sm" onClick=${() => p.setGroupForm({ ...grpf, open: !grpf.open })}>${grpf.open ? t('secretary.cancel') : t('secretary.access.newGroup')}</button>
      </div>
      ${grpf.open ? html`
        <div class="sec-note-bar">
          <input class="sec-input" placeholder=${t('secretary.access.groupName')} value=${grpf.name} onInput=${(e) => p.setGroupForm({ ...grpf, name: e.target.value })} />
          <button class="btn-primary" disabled=${!grpf.name.trim() || grpf.saving} onClick=${p.createGroup}>${grpf.saving ? t('secretary.applying') : t('secretary.access.createGroup')}</button>
        </div>` : null}
      ${p.groups.length === 0
        ? html`<div class="sec-hint">${t('secretary.access.noGroups')}</div>`
        : html`<ul class="sec-goal-list">
            ${p.groups.map((g) => html`<li class="sec-goal-row" key=${g.id}>
              <div class="sec-goal-main"><div class="sec-goal-title">${escHtml(g.name)}</div>
                <div class="sec-hint">${(g.members || []).length} ${t('secretary.access.members')}</div></div>
            </li>`)}
          </ul>`}
    </section>`;
}

/** P2-D — approve a pending agent + set its mode/tags (the crew on-ramp). Plus: provision a SPECIALIST
 *  with an app-style declare→consent→grant scope flow (the role's requestable extras need owner consent). */
export function crewCard(p) {
  const ns = p.newSpec;
  const c = p.consent;
  return html`
    <section class="sec-card sec-crew">
      <h2 class="sec-h2">${t('secretary.crew.title')}</h2>
      <p class="sec-hint">${t('secretary.crew.hint')}</p>

      <h3 class="sec-h3">${t('secretary.crew.addSpecTitle')}</h3>
      <p class="sec-hint">${t('secretary.crew.addSpecHint')}</p>
      <div class="sec-form">
        <div class="sec-note-bar">
          <input class="sec-input sec-input-sm" placeholder=${t('secretary.crew.specName')} value=${ns.name}
            onInput=${(e) => p.setNewSpec({ ...ns, name: e.target.value })} />
          <select class="sec-band" value=${ns.role} onChange=${(e) => p.setNewSpec({ ...ns, role: e.target.value })}>
            ${p.SPECIALIST_ROLES.map((r) => html`<option value=${r} selected=${ns.role === r}>${r}</option>`)}
          </select>
          <button class="btn-primary btn-sm" disabled=${!ns.name.trim() || ns.creating}
            onClick=${p.createSpec}>${ns.creating ? t('secretary.applying') : t('secretary.crew.specCreate')}</button>
        </div>
      </div>

      ${c ? html`
        <div class="sec-form sec-consent">
          <div class="sec-status"><span class="sec-dot"></span> ${t('secretary.crew.consentTitle')} <code>${escHtml(c.name)}</code></div>
          <p class="sec-hint">${t('secretary.crew.consentNote')}</p>
          <ul class="sec-goal-list">
            ${c.extras.map((x) => html`<li class="sec-goal-row" key=${x.scope}>
              <label class="sec-goal-main">
                <input type="checkbox" checked=${c.checked.includes(x.scope)} onChange=${() => p.toggleExtra(x.scope)} />
                <span class="sec-goal-title">${escHtml(x.description)}</span>
                <span class="sec-hint"><code>${escHtml(x.scope)}</code></span>
              </label>
            </li>`)}
          </ul>
          <div class="sec-actions">
            <button class="btn-ghost btn-sm" onClick=${p.dismissConsent}>${t('secretary.crew.consentSkip')}</button>
            <button class="btn-primary btn-sm" disabled=${!c.checked.length || c.granting}
              onClick=${p.grantExtras}>${c.granting ? t('secretary.applying') : t('secretary.crew.consentGrant')}</button>
          </div>
        </div>` : null}

      ${p.pending.length > 0 ? html`
        <h3 class="sec-h3">${t('secretary.crew.pendingTitle')}</h3>
        <ul class="sec-goal-list">
          ${p.pending.map((r) => html`<li class="sec-goal-row" key=${r.user_code}>
            <div class="sec-goal-main">
              <div class="sec-goal-title">${escHtml(r.display_name || r.agent_name || t('secretary.crew.unnamed'))}</div>
              <div class="sec-hint"><code>${escHtml(r.user_code)}</code> · ${t('secretary.crew.expiresIn')} ${Math.floor((r.expires_in || 0) / 60)}m</div>
            </div>
            <button class="btn-primary btn-sm" onClick=${() => p.approve(r.user_code, 'standard')}>${t('secretary.crew.approve')}</button>
            <button class="btn-ghost btn-sm" onClick=${() => p.deny(r.user_code)}>${t('secretary.crew.deny')}</button>
          </li>`)}
        </ul>` : html`<div class="sec-hint">${t('secretary.crew.noPending')}</div>`}

      <h3 class="sec-h3">${t('secretary.crew.agentsTitle')}</h3>
      ${p.agents.length === 0
        ? html`<div class="sec-hint">${t('secretary.crew.noAgents')}</div>`
        : html`<ul class="sec-goal-list">
            ${p.agents.map((a) => html`<li class="sec-goal-row" key=${a.gaii || a.name}>
              <div class="sec-goal-main">
                <div class="sec-goal-title">${escHtml(a.name)}</div>
                <div class="sec-note-bar">
                  <select class="sec-band" value=${a.mode || 'interactive'} onChange=${(e) => p.setMode(a.name, e.target.value)}>
                    ${p.MODES.map((m) => html`<option value=${m} selected=${(a.mode || 'interactive') === m}>${m}</option>`)}
                  </select>
                  <input class="sec-input sec-input-sm" placeholder=${t('secretary.crew.tagsPlaceholder')} value=${(a.tags || []).join(', ')}
                    onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); p.setTags(a.name, e.target.value); } }} />
                </div>
              </div>
            </li>`)}
          </ul>`}
    </section>`;
}
