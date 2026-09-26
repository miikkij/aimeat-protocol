/**
 * @file public/views/profile/inbox-tab/organize-page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The "List rules" page under Messages: whether the owner's own agents' conversations
 *   archive themselves after a number of days, whether copies with one subject show as one row, and the
 *   rules that fold, group or archive. Everything saves the moment it changes, except a new rule, which
 *   saves on its button. The same settings an AI changes with aimeat_dm_organize_as_owner, which the
 *   last line on the page says.
 * @structure OrganizePage({ org, showToast })
 * @usage <OrganizePage org=${org} showToast=${showToast} />
 * @version-history
 *   v1.6.0 -- 2026-09-25 -- A setting that is on or off is the library's Switch (components/Switch.js), the look most Settings tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.1.0 -- 2026-09-13 -- Compose section headlines with poster-section-title.
 *   v1.0.0 — 2026-09-13 — Initial, with the Messages list's sections, rules and archive.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Hint } from '/components/Hint.js';
import { Switch } from '/components/Switch.js';

const DAY_CHOICES = [7, 14, 30, 60, 90];
const ACTIONS = ['fold', 'group', 'archive'];
const SCOPES = ['agents', 'all'];
const EMPTY_RULE = { name: '', action: 'group', scope: 'agents', with: '', subject: '', body: '', days: '' };

const actionWord = (a) => t(`inbox.org.action.${a}`);
const scopeWord = (s) => t(`inbox.org.scope.${s}`);

/** A rule in one line, in the words the form uses. */
function ruleSummary(r) {
  const m = r.match || {};
  const parts = [];
  if (m.with) parts.push(`${t('inbox.org.ruleWith')}: ${m.with}`);
  if (m.subject) parts.push(`${t('inbox.org.ruleSubject')}: ${m.subject}`);
  if (m.body) parts.push(`${t('inbox.org.ruleBody')}: ${m.body}`);
  if (m.older_than_days) parts.push(t('inbox.org.ruleOlderN', { days: String(m.older_than_days) }));
  parts.push(scopeWord(m.scope || 'agents'));
  return `${parts.join(' · ')} → ${actionWord(r.action)}`;
}

/** The rule list as the PUT body wants it back: everything but the read-only birth date. */
const ruleInput = (r) => ({ id: r.id, name: r.name, enabled: r.enabled, action: r.action, match: r.match });

export function OrganizePage({ org, showToast }) {
  const s = org.settings;
  const [draft, setDraft] = useState(EMPTY_RULE);
  const set = (patch) => setDraft(d => ({ ...d, ...patch }));

  if (!s) return html`<p class="og-hint">${t('common.loading')}</p>`;
  const auto = s.auto_archive || { enabled: true, days: 14 };
  const rules = s.rules || [];
  const busy = org.saving;

  const addRule = async () => {
    const name = draft.name.trim();
    if (!name) { showToast?.(t('inbox.org.ruleNeedName'), true); return; }
    const match = {
      scope: draft.scope,
      ...(draft.with.trim() ? { with: draft.with.trim() } : {}),
      ...(draft.subject.trim() ? { subject: draft.subject.trim() } : {}),
      ...(draft.body.trim() ? { body: draft.body.trim() } : {}),
      ...(Number(draft.days) > 0 ? { older_than_days: Math.min(365, Math.round(Number(draft.days))) } : {}),
    };
    if (draft.scope === 'all' && Object.keys(match).length === 1) { showToast?.(t('inbox.org.ruleNeedCondition'), true); return; }
    if (await org.saveSettings({ add_rule: { name, action: draft.action, match } })) setDraft(EMPTY_RULE);
  };
  const toggleRule = (r) => org.saveSettings({ rules: rules.map(x => (x.id === r.id ? { ...ruleInput(x), enabled: !x.enabled } : ruleInput(x))) });

  return html`
    <div class="inbox-org">
      <p class="og-desc">${t('inbox.org.pageLead')}</p>

      <section class="og-sec og-sec--first">
        <div class="og-sec-h"><h2 class="poster-section-title">${t('inbox.org.autoTitle')}</h2></div>
        <div class="inbox-org-line">
          <${Switch} on=${auto.enabled} disabled=${busy} label=${auto.enabled ? t('inbox.org.on') : t('inbox.org.off')}
            onToggle=${() => org.saveSettings({ auto_archive: { enabled: !auto.enabled } })} />
          <span class="poster-label" id="inbox-org-days">${t('inbox.org.autoDays')}</span>
          <div class="pf-tabs" role="group" aria-labelledby="inbox-org-days">
            ${DAY_CHOICES.map(d => html`<button type="button" key=${d} class=${`poster-tab ${auto.days === d ? 'is-on' : ''}`}
              disabled=${busy || !auto.enabled} aria-pressed=${auto.days === d ? 'true' : 'false'} title=${t('inbox.org.days', { n: String(d) })}
              onClick=${() => org.saveSettings({ auto_archive: { days: d } })}>${d}</button>`)}
          </div>
        </div>
        <${Hint}>${t('inbox.org.autoHint')}<//>
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2 class="poster-section-title">${t('inbox.org.foldTitle')}</h2></div>
        <${Switch} on=${s.fold_same_subject} disabled=${busy} label=${s.fold_same_subject ? t('inbox.org.on') : t('inbox.org.off')}
          onToggle=${() => org.saveSettings({ fold_same_subject: !s.fold_same_subject })} />
        <${Hint}>${t('inbox.org.foldHint')}<//>
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2 class="poster-section-title">${t('inbox.org.rulesTitle')}${rules.length ? html` <small>${rules.length}</small>` : null}</h2></div>
        <${Hint}>${t('inbox.org.rulesHint')}<//>
        <div class="inbox-org-rules">
          ${rules.length === 0 ? html`<p class="og-hint">${t('inbox.org.rulesEmpty')}</p>` : rules.map(r => html`
            <div class=${`inbox-org-rule${r.enabled ? '' : ' is-off'}`} key=${r.id}>
              <div class="inbox-org-rule-words"><b>${r.name}</b><small>${ruleSummary(r)}</small></div>
              <${Switch} on=${r.enabled} disabled=${busy} label=${r.enabled ? t('inbox.org.ruleInUse') : t('inbox.org.rulePaused')} onToggle=${() => toggleRule(r)} />
              <button type="button" class="poster-action poster-action--quiet" disabled=${busy} onClick=${() => org.saveSettings({ remove_rule: r.id })}>${t('inbox.org.ruleRemove')}</button>
            </div>`)}
        </div>

        <div class="inbox-org-form">
          <div class="og-fields og-fields--2">
            <label class="og-field"><span class="poster-label">${t('inbox.org.ruleName')}</span>
              <input class="og-input" maxlength="80" value=${draft.name} onInput=${e => set({ name: e.target.value })} /></label>
            <div class="og-field inbox-org-wide"><span class="poster-label">${t('inbox.org.ruleAction')}</span>
              <div class="pf-tabs">${ACTIONS.map(a => html`<button type="button" key=${a} class=${`poster-tab ${draft.action === a ? 'is-on' : ''}`}
                aria-pressed=${draft.action === a ? 'true' : 'false'} onClick=${() => set({ action: a })}>${actionWord(a)}</button>`)}</div></div>
            <label class="og-field"><span class="poster-label">${t('inbox.org.ruleWith')}</span>
              <input class="og-input" maxlength="200" list="inbox-contact-suggest" value=${draft.with} onInput=${e => set({ with: e.target.value })} /></label>
            <label class="og-field"><span class="poster-label">${t('inbox.org.ruleSubject')}</span>
              <input class="og-input" maxlength="200" value=${draft.subject} onInput=${e => set({ subject: e.target.value })} /></label>
            <label class="og-field"><span class="poster-label">${t('inbox.org.ruleBody')}</span>
              <input class="og-input" maxlength="200" value=${draft.body} onInput=${e => set({ body: e.target.value })} /></label>
            <label class="og-field"><span class="poster-label">${t('inbox.org.ruleOlder')}</span>
              <input class="og-input" type="number" min="1" max="365" inputmode="numeric" value=${draft.days} onInput=${e => set({ days: e.target.value })} /></label>
            <div class="og-field inbox-org-wide"><span class="poster-label">${t('inbox.org.ruleScope')}</span>
              <div class="pf-tabs">${SCOPES.map(sc => html`<button type="button" key=${sc} class=${`poster-tab ${draft.scope === sc ? 'is-on' : ''}`}
                aria-pressed=${draft.scope === sc ? 'true' : 'false'} onClick=${() => set({ scope: sc })}>${scopeWord(sc)}</button>`)}</div></div>
          </div>
          <div class="og-actions inbox-org-actions">
            <button type="button" class="poster-slab poster-slab--control" disabled=${busy} onClick=${addRule}>${t('inbox.org.ruleAdd')}</button>
            <${Hint}>${t('inbox.org.ruleFormHint')}<//>
          </div>
        </div>
      </section>

      <p class="poster-hint inbox-org-chat">${t('inbox.org.chatHint')}</p>
    </div>`;
}
