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
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared set: Sections, the on/off settings as switch
 *     actions (the notifications sheet's .nt-sw is gone), the day and action choices as tabs, the
 *     rules as ListRows, the form as Fields in Columns. Saving is unchanged.
 *   v1.1.0 -- 2026-09-13 -- Compose section headlines with poster-section-title.
 *   v1.0.0 — 2026-09-13 — Initial, with the Messages list's sections, rules and archive.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Columns, Stack, ListRow, Field, Action, Surface, Text } from '/components/poster-parts.js';

const DAY_CHOICES = [7, 14, 30, 60, 90];
const ACTIONS = ['fold', 'group', 'archive'];
const SCOPES = ['agents', 'all'];
const EMPTY_RULE = { name: '', action: 'group', scope: 'agents', with: '', subject: '', body: '', days: '' };

/** An on/off setting: the set's switch action. */
const Switch = ({ on, label, disabled, onToggle }) =>
  html`<${Action} semantics="switch" selected=${!!on} disabled=${disabled} onClick=${onToggle}>${label}<//>`;

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

/** A labelled row of either-or choices, pressed like tabs. */
const Choice = ({ label, id, choices, value, disabled, onPick, titleOf }) => html`
  <${Stack} density="compact">
    <${Text} kind="label" id=${id}>${label}<//>
    <${Stack} direction="wrap" density="compact" role="group" label=${label}>
      ${choices.map(c => html`<${Action} key=${c.value} kind="tab" selected=${value === c.value} disabled=${disabled}
        title=${titleOf ? titleOf(c.value) : undefined} onClick=${() => onPick(c.value)}>${c.label}<//>`)}
    <//>
  <//>`;

export function OrganizePage({ org, showToast }) {
  const s = org.settings;
  const [draft, setDraft] = useState(EMPTY_RULE);
  const set = (patch) => setDraft(d => ({ ...d, ...patch }));

  if (!s) return html`<${Text} tone="muted">${t('common.loading')}<//>`;
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
    <${Stack}>
      <${Text} kind="lead">${t('inbox.org.pageLead')}<//>

      <${Section} size="small" title=${t('inbox.org.autoTitle')} description=${t('inbox.org.autoHint')}>
        <${Stack} direction="wrap" align="end">
          <${Switch} on=${auto.enabled} disabled=${busy} label=${auto.enabled ? t('inbox.org.on') : t('inbox.org.off')}
            onToggle=${() => org.saveSettings({ auto_archive: { enabled: !auto.enabled } })} />
          <${Choice} label=${t('inbox.org.autoDays')} id="inbox-org-days" value=${auto.days} disabled=${busy || !auto.enabled}
            titleOf=${(d) => t('inbox.org.days', { n: String(d) })}
            choices=${DAY_CHOICES.map(d => ({ value: d, label: String(d) }))} onPick=${(d) => org.saveSettings({ auto_archive: { days: d } })} />
        <//>
      <//>

      <${Section} size="small" title=${t('inbox.org.foldTitle')} description=${t('inbox.org.foldHint')}>
        <${Stack} direction="horizontal">
          <${Switch} on=${s.fold_same_subject} disabled=${busy} label=${s.fold_same_subject ? t('inbox.org.on') : t('inbox.org.off')}
            onToggle=${() => org.saveSettings({ fold_same_subject: !s.fold_same_subject })} />
        <//>
      <//>

      <${Section} size="small" title=${t('inbox.org.rulesTitle')} count=${rules.length || undefined} description=${t('inbox.org.rulesHint')}>
        <${Stack}>
          ${rules.length === 0 ? html`<${Text} tone="muted">${t('inbox.org.rulesEmpty')}<//>` : html`<${Surface} kind="plain" density="flush">${rules.map(r => html`
            <${ListRow} key=${r.id} density="compact" muted=${!r.enabled} name=${r.name} detail=${ruleSummary(r)} detailKind="text"
              actions=${html`
                <${Switch} on=${r.enabled} disabled=${busy} label=${r.enabled ? t('inbox.org.ruleInUse') : t('inbox.org.rulePaused')} onToggle=${() => toggleRule(r)} />
                <${Action} kind="text" tone="danger" disabled=${busy} onClick=${() => org.saveSettings({ remove_rule: r.id })}>${t('inbox.org.ruleRemove')}<//>`} />`)}<//>`}

          <${Columns} collapse=${600}>
            <${Field} label=${t('inbox.org.ruleName')} maxLength=${80} value=${draft.name} onInput=${e => set({ name: e.target.value })} />
            <${Choice} label=${t('inbox.org.ruleAction')} value=${draft.action}
              choices=${ACTIONS.map(a => ({ value: a, label: actionWord(a) }))} onPick=${(a) => set({ action: a })} />
            <${Field} label=${t('inbox.org.ruleWith')} maxLength=${200} list="inbox-contact-suggest" value=${draft.with} onInput=${e => set({ with: e.target.value })} />
            <${Field} label=${t('inbox.org.ruleSubject')} maxLength=${200} value=${draft.subject} onInput=${e => set({ subject: e.target.value })} />
            <${Field} label=${t('inbox.org.ruleBody')} maxLength=${200} value=${draft.body} onInput=${e => set({ body: e.target.value })} />
            <${Field} label=${t('inbox.org.ruleOlder')} type="number" min=${1} max=${365} inputMode="numeric" value=${draft.days} onInput=${e => set({ days: e.target.value })} />
            <${Choice} label=${t('inbox.org.ruleScope')} value=${draft.scope}
              choices=${SCOPES.map(sc => ({ value: sc, label: scopeWord(sc) }))} onPick=${(sc) => set({ scope: sc })} />
          <//>
          <${Stack} direction="wrap" align="center">
            <${Action} kind="primary" disabled=${busy} onClick=${addRule}>${t('inbox.org.ruleAdd')}<//>
            <${Text} kind="caption" tone="muted">${t('inbox.org.ruleFormHint')}<//>
          <//>
        <//>
      <//>

      <${Text} kind="caption" tone="muted">${t('inbox.org.chatHint')}<//>
    <//>`;
}
