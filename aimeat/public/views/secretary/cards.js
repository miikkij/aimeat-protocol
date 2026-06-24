/**
 * @file secretary/cards.js
 * @description Presentational cards for the Secretary view, split out of views/secretary.js to keep the
 *   main component focused on state + logic (and under the file-size limit). Each export is a PURE render
 *   function taking a props bag — no hooks, no state — so the view owns all state/handlers and passes
 *   them in. Cards: contextSwitcher · hirePanel · chatCard · findCard · noteCard · decisionsCard ·
 *   brainCard · operatingCard · historyCard · metaCard. See views/secretary.js + docs/plans/2026-06-23-secretary-feature.md.
 * @structure one exported render function per card (props in → htm out)
 * @usage import { chatCard, findCard, ... } from '/views/secretary/cards.js'; ... ${chatCard({...})}
 * @version-history
 *   v0.3.0 — 2026-06-24 — Phase 5: goalsCard + decisionLogCard (learning loop).
 *   v0.2.0 — 2026-06-24 — Phase 4: feedCard + automationCard.
 *   v0.1.0 — 2026-06-24 — Extract cards from views/secretary.js (Phase 3 cleanup).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { CopyButton } from '/components/CopyButton.js';
import { SECRETARY_CAPABILITIES, BANDS } from '/js/services/secretary-policy.js';
import { buildInterviewPrompt } from '/js/services/secretary-helpers.js';

/** Context "hats" switcher chips + add. */
export function contextSwitcher(p) {
  return html`
    <div class="sec-ctx-bar">
      ${p.contexts.map((c) => html`
        <button class="sec-ctx-chip ${c.id === p.activeId ? 'active' : ''}" key=${c.id} onClick=${() => p.switchContext(c.id)}>${escHtml(c.name)}</button>`)}
      <button class="sec-ctx-add" title=${t('secretary.addContext')} onClick=${p.openAdd}>＋</button>
    </div>`;
}

/** Hire / re-run onboarding: external prompt-driven interview + in-app generate + paste→apply. */
export function hirePanel(p) {
  return html`
    <section class="sec-card sec-hire">
      <div class="sec-card-head">
        <h2 class="sec-h2">${p.firstEver ? t('secretary.hireTitle') : (p.hireMode === 'edit' ? t('secretary.rerun') : t('secretary.addContextTitle'))}</h2>
        ${!p.firstEver && html`<button class="btn-ghost btn-sm" onClick=${p.onCancel}>${t('secretary.cancel')}</button>`}
      </div>
      <p class="sec-desc">${t('secretary.hireIntro')}</p>
      <div class="sec-opt">
        <div class="sec-opt-h">${t('secretary.optionA')}</div>
        <div class="sec-prompt-box">${buildInterviewPrompt(p.owner)}</div>
        <${CopyButton} text=${buildInterviewPrompt(p.owner)} className="btn-outline btn-sm" label=${t('secretary.copyPrompt')} copiedLabel=${'✓ ' + t('secretary.copied')} />
      </div>
      <div class="sec-opt">
        <div class="sec-opt-h">${t('secretary.optionB')}</div>
        <textarea class="sec-paste" rows="3" placeholder=${t('secretary.needsPlaceholder')} value=${p.needs} onInput=${(e) => p.setNeeds(e.target.value)}></textarea>
        <button class="btn-outline btn-sm" disabled=${!p.needs.trim() || p.generating} onClick=${p.generateInApp}>${p.generating ? t('secretary.generating') : t('secretary.generate')}</button>
      </div>
      <div class="sec-step"><span class="sec-step-n">→</span> ${t('secretary.hireStep2')}</div>
      <textarea class="sec-paste" rows="7" placeholder=${t('secretary.pastePlaceholder')} value=${p.result} onInput=${(e) => p.setResult(e.target.value)}></textarea>
      <div class="sec-actions">
        <button class="btn-primary" disabled=${!p.result.trim() || p.applying} onClick=${p.applyResult}>${p.applying ? t('secretary.applying') : (p.firstEver || p.hireMode === 'new' ? t('secretary.apply') : t('secretary.applyEdit'))}</button>
      </div>
    </section>`;
}

/** Context-aware chat (per active context) + the cheap routing suggestion. */
export function chatCard(p) {
  return html`
    <section class="sec-card sec-chat">
      <h2 class="sec-h2">${t('secretary.chatTitle')} · ${escHtml(p.activeName)}</h2>
      <div class="sec-chat-log">
        ${p.chat.length === 0
          ? html`<div class="sec-hint">${t('secretary.chatEmpty')}</div>`
          : p.chat.map((m, i) => html`<div class="sec-msg sec-msg-${m.role}" key=${i}>${escHtml(m.content)}</div>`)}
        ${p.chatSending ? html`<div class="sec-msg sec-msg-assistant sec-msg-pending">…</div>` : null}
      </div>
      ${p.routeSuggestion ? html`
        <div class="sec-route-hint">
          <span>${t('secretary.routeSuggest')} <strong>${escHtml(p.routeSuggestion.name)}</strong></span>
          <button class="btn-ghost btn-sm" onClick=${() => p.switchContext(p.routeSuggestion.id)}>${t('secretary.routeSwitch')}</button>
        </div>` : null}
      <div class="sec-chat-input">
        <textarea rows="2" placeholder=${t('secretary.chatPlaceholder')} value=${p.chatInput}
          onInput=${(e) => p.setChatInput(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); p.sendChat(); } }}></textarea>
        <button class="btn-primary" disabled=${!p.chatInput.trim() || p.chatSending} onClick=${p.sendChat}>
          ${p.chatSending ? t('secretary.chatSending') : t('secretary.chatSend')}
        </button>
      </div>
    </section>`;
}

/** Resource finder via aimeat_discover. */
export function findCard(p) {
  return html`
    <section class="sec-card sec-find">
      <h2 class="sec-h2">${t('secretary.findTitle')}</h2>
      <p class="sec-hint">${t('secretary.findHint')}</p>
      <div class="sec-find-bar">
        <input class="sec-find-in" placeholder=${t('secretary.findPlaceholder')} value=${p.findQ}
          onInput=${(e) => p.setFindQ(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); p.doFind(); } }} />
        <select class="sec-band" value=${p.findScope} onChange=${(e) => p.setFindScope(e.target.value)}>
          <option value="public" selected=${p.findScope === 'public'}>${t('secretary.findScopePublic')}</option>
          <option value="own" selected=${p.findScope === 'own'}>${t('secretary.findScopeMine')}</option>
        </select>
        <button class="btn-primary" disabled=${p.finding} onClick=${p.doFind}>${p.finding ? t('secretary.findSearching') : t('secretary.findSearch')}</button>
      </div>
      ${p.findResults !== null && html`
        <div class="sec-find-results">
          ${p.findResults.length === 0
            ? html`<div class="sec-hint">${t('secretary.findEmpty')}</div>`
            : p.findResults.map((e, i) => html`
              <div class="sec-find-row" key=${i}>
                <span class="sec-find-type">${escHtml(e.type)}</span>
                <div class="sec-find-main">
                  <div class="sec-find-title">${e.url ? html`<a href=${e.url} target="_blank" rel="noreferrer">${escHtml(e.title)}</a>` : escHtml(e.title)}</div>
                  ${e.description ? html`<div class="sec-find-desc">${escHtml(String(e.description).slice(0, 160))}</div>` : null}
                </div>
              </div>`)}
        </div>`}
    </section>`;
}

/** Save-a-note composer (file into a workspace) + Ask-in-inbox (Ask band). */
export function noteCard(p) {
  return html`
    <section class="sec-card sec-note">
      <h2 class="sec-h2">${t('secretary.noteTitle')}</h2>
      <p class="sec-hint">${t('secretary.noteHint')}</p>
      <textarea class="sec-paste" rows="3" placeholder=${t('secretary.notePlaceholder')} value=${p.noteText} onInput=${(e) => p.setNoteText(e.target.value)}></textarea>
      <div class="sec-note-bar">
        <label class="sec-hint">${t('secretary.noteInto')}</label>
        <select class="sec-band" value=${p.effectiveWsId} onChange=${(e) => p.setNoteWsId(e.target.value)}>
          ${p.wsList.map((w) => html`<option value=${w.id} selected=${p.effectiveWsId === w.id}>${escHtml(w.name)}</option>`)}
        </select>
        <button class="btn-primary" disabled=${!p.noteText.trim() || p.noteSaving} onClick=${p.saveNote}>${p.noteSaving ? t('secretary.noteSaving') : t('secretary.noteSave')}</button>
        ${p.wsList.length >= 2 ? html`<button class="btn-outline btn-sm" disabled=${!p.noteText.trim() || p.noteSaving} onClick=${p.askDecision} title=${t('secretary.askInInboxHint')}>${t('secretary.askInInbox')}</button>` : null}
      </div>
    </section>`;
}

/** Pending Ask-band decisions awaiting the owner's inbox answer (+ Apply / dismiss). */
export function decisionsCard(p) {
  return html`
    <section class="sec-card">
      <h2 class="sec-h2">${t('secretary.decisionsTitle')}</h2>
      <ul class="sec-hist">
        ${p.pendingIds.map((pid) => {
          const dec = p.pendingDecisions[pid];
          const answer = p.decisionAnswers[pid];
          return html`<li class="sec-hist-row" key=${pid}>
            <span class="sec-hist-purpose">${escHtml((dec.body || dec.question || '').slice(0, 60))}</span>
            ${answer
              ? html`<button class="btn-primary btn-sm" onClick=${() => p.applyDecision(pid)}>${t('secretary.decisionApply')}: ${escHtml(answer)}</button>`
              : html`<span class="sec-hint">${t('secretary.decisionAwaiting')}</span>`}
            <button class="btn-ghost btn-sm" onClick=${() => p.dismissDecision(pid)}>${t('secretary.cancel')}</button>
          </li>`;
        })}
      </ul>
    </section>`;
}

/** Status + brain (purpose + rules) + self-organism summary, with Re-run. */
export function brainCard(p) {
  const brain = p.brain;
  const active = p.active;
  return html`
    <section class="sec-card">
      <div class="sec-card-head">
        <div class="sec-status"><span class="sec-dot"></span> ${t('secretary.hiredStatus')}</div>
        <button class="btn-ghost btn-sm" onClick=${p.openEdit}>${t('secretary.rerun')}</button>
      </div>
      <h2 class="sec-h2">${t('secretary.brain')}</h2>
      <p class="sec-purpose">${escHtml(brain.purpose)}</p>
      ${Array.isArray(brain.rules) && brain.rules.length > 0 && html`<ul class="sec-rules">${brain.rules.map((r) => html`<li key=${r.id}>${escHtml(r.description)}</li>`)}</ul>`}
      ${active.organismName && html`
        <h2 class="sec-h2">${t('secretary.selfOrganism')}</h2>
        <p class="sec-orgname">🗂 ${escHtml(active.organismName)}</p>
        ${Array.isArray(active.workspaces) && html`<ul class="sec-ws">${active.workspaces.map((w, i) => html`<li key=${i}><strong>${escHtml(w.name)}</strong>${w.purpose ? html` — ${escHtml(w.purpose)}` : null}</li>`)}</ul>`}`}
    </section>`;
}

/** Operating model: stop-spending + daily budget + per-capability autonomy bands. */
export function operatingCard(p) {
  const policy = p.policy;
  return html`
    <section class="sec-card">
      <h2 class="sec-h2">${t('secretary.howIWork')}</h2>
      <label class="sec-stop ${policy.stopSpending ? 'on' : ''}">
        <input type="checkbox" checked=${policy.stopSpending} onChange=${p.toggleStop} />
        <span><strong>${t('secretary.stopSpending')}</strong><br/><span class="sec-hint">${t('secretary.stopSpendingHint')}</span></span>
      </label>
      <div class="sec-budget">
        <label>${t('secretary.dailyBudget')}</label>
        <input type="number" min="0" class="sec-budget-in" value=${policy.dailyMorselBudget == null ? '' : policy.dailyMorselBudget} placeholder=${t('secretary.noLimit')} onChange=${(e) => p.setBudget(e.target.value)} />
        <span class="sec-hint">${t('secretary.dailyBudgetHint')}</span>
      </div>
      <p class="sec-hint sec-bands-note">${t('secretary.bandsNote')}</p>
      <ul class="sec-caps">
        ${SECRETARY_CAPABILITIES.map((c) => html`
          <li class="sec-cap" key=${c.id}>
            <span class="sec-cap-label">${t('secretary.cap.' + c.id)}${c.costs ? html`<span class="sec-cap-tag">${t('secretary.capCosts')}</span>` : null}</span>
            ${c.enterprise
              ? html`<span class="sec-cap-locked sec-cap-ent">${t('secretary.enterprise')}</span>`
              : c.locked
              ? html`<span class="sec-cap-locked">${t('secretary.band.' + policy.bands[c.id])} · ${t('secretary.locked')}</span>`
              : html`<select class="sec-band" value=${policy.bands[c.id]} onChange=${(e) => p.setBand(c.id, e.target.value)}>${BANDS.map((b) => html`<option value=${b} selected=${policy.bands[c.id] === b}>${t('secretary.band.' + b)}</option>`)}</select>`}
          </li>`)}
      </ul>
    </section>`;
}

/** Brain version history + restore. */
export function historyCard(p) {
  return html`
    <section class="sec-card">
      <h2 class="sec-h2">${t('secretary.history')}</h2>
      <ul class="sec-hist">
        ${p.brainHistory.map((snap, i) => html`
          <li class="sec-hist-row" key=${i}>
            <span class="sec-hist-purpose">${escHtml((snap.purpose || '').slice(0, 80))}</span>
            <button class="btn-ghost btn-sm" disabled=${p.applying} onClick=${() => p.restore(snap)}>${t('secretary.restore')}</button>
          </li>`)}
      </ul>
    </section>`;
}

/** Guided playbook (Phase 3c): propose steps → approve → execute (file + discover) → result. */
export function guidedPlanCard(p) {
  return html`
    <section class="sec-card sec-plan">
      <h2 class="sec-h2">${t('secretary.plan.title')}</h2>
      <p class="sec-hint">${t('secretary.plan.hint')}</p>
      ${!p.steps && !p.result ? html`
        <textarea class="sec-paste" rows="2" placeholder=${t('secretary.plan.placeholder')} value=${p.goal} onInput=${(e) => p.setGoal(e.target.value)}></textarea>
        <div class="sec-actions">
          <button class="btn-primary" disabled=${!p.goal.trim() || p.planning} onClick=${p.planIt}>${p.planning ? t('secretary.plan.planning') : t('secretary.plan.go')}</button>
        </div>` : null}
      ${p.steps && !p.result ? html`
        <div class="sec-plan-steps">
          ${p.steps.summary ? html`<p class="sec-purpose">${escHtml(p.steps.summary)}</p>` : null}
          <ol class="sec-rules">
            ${p.steps.steps.map((s, i) => html`<li key=${i}><strong>${escHtml(s.title)}</strong>${s.detail ? html` — ${escHtml(s.detail)}` : null}</li>`)}
          </ol>
          <div class="sec-actions">
            <button class="btn-ghost btn-sm" onClick=${p.cancelPlan}>${t('secretary.cancel')}</button>
            <button class="btn-primary" disabled=${p.running} onClick=${p.runPlan}>${p.running ? t('secretary.plan.running') : t('secretary.plan.approve')}</button>
          </div>
        </div>` : null}
      ${p.result ? html`
        <div class="sec-plan-result">
          <div class="sec-status"><span class="sec-dot"></span> ${t('secretary.plan.ran')}</div>
          ${p.result.wsName ? html`<p class="sec-hint">${t('secretary.plan.filed')} <strong>${escHtml(p.result.wsName)}</strong></p>` : null}
          <p class="sec-hint">${t('secretary.plan.found')} ${p.result.found}</p>
          <button class="btn-ghost btn-sm" onClick=${p.resetPlan}>${t('secretary.plan.new')}</button>
        </div>` : null}
    </section>`;
}

/** Home feed (Phase 4): what the Secretary did on its own (autonomous briefings). */
export function feedCard(p) {
  return html`
    <section class="sec-card sec-feed">
      <h2 class="sec-h2">${t('secretary.feed.title')}</h2>
      ${p.feed.length === 0
        ? html`<div class="sec-hint">${t('secretary.feed.empty')}</div>`
        : html`<ul class="sec-feed-list">
            ${p.feed.map((it, i) => html`<li class="sec-feed-item" key=${it.id || i}>
              <div class="sec-feed-meta">${it.contextName ? escHtml(it.contextName) + ' · ' : ''}${it.ts ? new Date(it.ts).toLocaleString() : ''}</div>
              <div class="sec-feed-text">${escHtml(it.text || '')}</div>
            </li>`)}
          </ul>`}
    </section>`;
}

/** Autonomous tick + calendar (Phase 4): enable / run-now / pause the daily check-in. */
export function automationCard(p) {
  const s = p.schedule;
  return html`
    <section class="sec-card sec-auto">
      <h2 class="sec-h2">${t('secretary.auto.title')}</h2>
      ${!s ? html`
        <p class="sec-hint">${t('secretary.auto.hint')}</p>
        <button class="btn-primary" onClick=${p.enableTick}>${t('secretary.auto.enable')}</button>`
      : html`
        <div class="sec-auto-row">
          <div>
            <div><strong>${escHtml(s.displayName || t('secretary.auto.scheduleName'))}</strong>${s.enabled ? null : html` <span class="sec-hint">(${t('secretary.auto.paused')})</span>`}</div>
            <div class="sec-hint">${t('secretary.auto.nextRun')}: ${s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : '—'}${s.cron ? ' · ' + escHtml(s.cron) : ''}</div>
          </div>
          <div class="sec-auto-actions">
            <button class="btn-ghost btn-sm" onClick=${p.toggleTick}>${s.enabled ? t('secretary.auto.pause') : t('secretary.auto.resume')}</button>
            <button class="btn-primary btn-sm" disabled=${p.running} onClick=${p.runTick}>${p.running ? t('secretary.auto.running') : t('secretary.auto.runNow')}</button>
          </div>
        </div>`}
    </section>`;
}

/** Goals (Phase 5): lightweight standalone goal records the Secretary works toward. */
export function goalsCard(p) {
  const f = p.goalForm;
  return html`
    <section class="sec-card sec-goals">
      <div class="sec-card-head">
        <h2 class="sec-h2">${t('secretary.learn.goalsTitle')}</h2>
        <button class="btn-ghost btn-sm" onClick=${() => p.setGoalForm({ ...f, open: !f.open })}>${f.open ? t('secretary.cancel') : t('secretary.learn.addGoal')}</button>
      </div>
      ${f.open ? html`
        <div class="sec-form">
          <input class="sec-input" placeholder=${t('secretary.learn.goalTitle')} value=${f.title} onInput=${(e) => p.setGoalForm({ ...f, title: e.target.value })} />
          <textarea class="sec-paste" rows="2" placeholder=${t('secretary.learn.goalWhy')} value=${f.why} onInput=${(e) => p.setGoalForm({ ...f, why: e.target.value })}></textarea>
          <button class="btn-primary" disabled=${!f.title.trim() || f.saving} onClick=${p.addGoal}>${f.saving ? t('secretary.noteSaving') : t('secretary.learn.saveGoal')}</button>
        </div>` : null}
      ${p.goals.length === 0
        ? html`<div class="sec-hint">${t('secretary.learn.goalsEmpty')}</div>`
        : html`<ul class="sec-goal-list">
            ${p.goals.map((g) => html`<li class="sec-goal-row ${g.status === 'done' ? 'done' : ''}" key=${g.id}>
              <div class="sec-goal-main">
                <div class="sec-goal-title">${escHtml(g.title)}</div>
                ${g.why ? html`<div class="sec-hint">${escHtml(g.why)}</div>` : null}
              </div>
              <button class="btn-ghost btn-sm" onClick=${() => p.completeGoal(g)}>${g.status === 'done' ? t('secretary.learn.reopen') : t('secretary.learn.done')}</button>
              <button class="btn-ghost btn-sm" onClick=${() => p.deleteGoal(g)}>✕</button>
            </li>`)}
          </ul>`}
    </section>`;
}

/** Decision log (Phase 5): self-describing decision contracts that stay open until the review scores them. */
export function decisionLogCard(p) {
  const f = p.decForm;
  const scoreChip = (d) => {
    if (d.status === 'reviewed' && typeof d.score === 'number') {
      const cls = d.score >= 70 ? 'good' : d.score >= 40 ? 'mid' : 'bad';
      return html`<span class="sec-score ${cls}">${d.score}/100</span>`;
    }
    return html`<span class="sec-hint">${t('secretary.learn.revisit')}: ${d.revisitWhen ? new Date(d.revisitWhen).toLocaleDateString() : '—'}</span>`;
  };
  return html`
    <section class="sec-card sec-decisions-log">
      <div class="sec-card-head">
        <h2 class="sec-h2">${t('secretary.learn.decisionsTitle')}</h2>
        <div class="sec-auto-actions">
          <button class="btn-ghost btn-sm" disabled=${p.reviewing} onClick=${p.reviewNow}>${p.reviewing ? t('secretary.auto.running') : t('secretary.learn.reviewNow')}</button>
          <button class="btn-ghost btn-sm" onClick=${() => p.setDecForm({ ...f, open: !f.open })}>${f.open ? t('secretary.cancel') : t('secretary.learn.logDecision')}</button>
        </div>
      </div>
      ${f.open ? html`
        <div class="sec-form">
          <input class="sec-input" placeholder=${t('secretary.learn.decision')} value=${f.decision} onInput=${(e) => p.setDecForm({ ...f, decision: e.target.value })} />
          <textarea class="sec-paste" rows="2" placeholder=${t('secretary.learn.options')} value=${f.options} onInput=${(e) => p.setDecForm({ ...f, options: e.target.value })}></textarea>
          <input class="sec-input" placeholder=${t('secretary.learn.chosen')} value=${f.chosen} onInput=${(e) => p.setDecForm({ ...f, chosen: e.target.value })} />
          <input class="sec-input" placeholder=${t('secretary.learn.rationale')} value=${f.rationale} onInput=${(e) => p.setDecForm({ ...f, rationale: e.target.value })} />
          <input class="sec-input" placeholder=${t('secretary.learn.expected')} value=${f.expectedOutcome} onInput=${(e) => p.setDecForm({ ...f, expectedOutcome: e.target.value })} />
          <div class="sec-note-bar">
            <label class="sec-hint">${t('secretary.learn.goalRef')}</label>
            <select class="sec-band" value=${f.goalRef} onChange=${(e) => p.setDecForm({ ...f, goalRef: e.target.value })}>
              <option value="">—</option>
              ${p.goals.filter((g) => g.status !== 'done').map((g) => html`<option value=${'secretary.goal.' + g.id} selected=${f.goalRef === 'secretary.goal.' + g.id}>${escHtml(g.title)}</option>`)}
            </select>
            <label class="sec-hint">${t('secretary.learn.revisitIn')}</label>
            <input class="sec-input sec-input-sm" type="number" min="0" value=${f.revisitDays} onInput=${(e) => p.setDecForm({ ...f, revisitDays: e.target.value })} />
            <button class="btn-primary" disabled=${!f.decision.trim() || f.saving} onClick=${p.addDecision}>${f.saving ? t('secretary.noteSaving') : t('secretary.learn.saveDecision')}</button>
          </div>
        </div>` : null}
      ${p.decisions.length === 0
        ? html`<div class="sec-hint">${t('secretary.learn.decisionsEmpty')}</div>`
        : html`<ul class="sec-goal-list">
            ${p.decisions.map((d) => html`<li class="sec-goal-row" key=${d.id}>
              <div class="sec-goal-main">
                <div class="sec-goal-title">${escHtml(d.decision)}${d.chosen ? html` <span class="sec-hint">→ ${escHtml(d.chosen)}</span>` : null}</div>
                ${d.status === 'reviewed' && d.verdict
                  ? html`<div class="sec-hint">${escHtml(d.verdict)}</div>`
                  : (d.expectedOutcome ? html`<div class="sec-hint">${t('secretary.learn.expected')}: ${escHtml(d.expectedOutcome)}</div>` : null)}
              </div>
              ${scoreChip(d)}
              <button class="btn-ghost btn-sm" onClick=${() => p.deleteDecision(d)}>✕</button>
            </li>`)}
          </ul>`}
    </section>`;
}

/** Identity + granted scopes. */
export function metaCard(p) {
  return html`
    <section class="sec-card sec-meta-card">
      <dl class="sec-meta">
        <dt>${t('secretary.identity')}</dt>
        <dd><code>${escHtml(p.secretary.gaii)}</code></dd>
        <dt>${t('secretary.scopes')}</dt>
        <dd class="sec-scopes">${(p.secretary.default_scopes || []).map((s) => html`<span class="sec-scope" key=${s}>${s}</span>`)}</dd>
      </dl>
    </section>`;
}
