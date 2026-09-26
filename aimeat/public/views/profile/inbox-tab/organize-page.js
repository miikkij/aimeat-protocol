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
 *   v1.8.1 -- 2026-09-26 -- The page is kept to 60rem again, as main's .inbox-org was (Stack narrow;
 *     fix pass).
 *   v1.8.0 -- 2026-09-26 --Written on components only (no class): the Sections, the day choice and the rule's choices are Choice, the fields TextField in two-column Fields, the rules a List (a paused rule faded), the hints Note; the page's lead sentence is the page head's desc.
 *   v1.7.0 -- 2026-09-26 -- The ways on, the row labels and the last hint are the kit (Action, Loud, Label, Note).
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
import { Switch } from '/components/Switch.js';
import { Action, Loud } from '/components/Action.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Section } from '/components/Section.js';
import { Stack, Row } from '/components/Layout.js';
import { Choice } from '/components/Choice.js';
import { TextField } from '/components/TextField.js';
import { Fields, FormActions } from '/components/Field.js';
import { List, Row as ListRow, Name, Doors } from '/components/List.js';

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

  if (!s) return html`<${Note} kind="loading">${t('common.loading')}<//>`;
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

  // The page's lead sentence is the page head's (inbox-tab.js passes it as the head's desc).
  return html`
    <${Stack} gap="large" narrow>
      <${Section} id="inbox-org-auto" first title=${t('inbox.org.autoTitle')}>
        <${Row} wrap gap="large">
          <${Switch} on=${auto.enabled} disabled=${busy} label=${auto.enabled ? t('inbox.org.on') : t('inbox.org.off')}
            onToggle=${() => org.saveSettings({ auto_archive: { enabled: !auto.enabled } })} />
          <${Label}>${t('inbox.org.autoDays')}<//>
          <${Choice} ariaLabel=${t('inbox.org.autoDays')} value=${auto.days} disabled=${busy || !auto.enabled}
            options=${DAY_CHOICES.map(d => ({ value: d, label: String(d), title: t('inbox.org.days', { n: String(d) }) }))}
            onChange=${(d) => org.saveSettings({ auto_archive: { days: d } })} />
        <//>
        <${Note}>${t('inbox.org.autoHint')}<//>
      <//>

      <${Section} id="inbox-org-fold" title=${t('inbox.org.foldTitle')}>
        <${Switch} on=${s.fold_same_subject} disabled=${busy} label=${s.fold_same_subject ? t('inbox.org.on') : t('inbox.org.off')}
          onToggle=${() => org.saveSettings({ fold_same_subject: !s.fold_same_subject })} />
        <${Note}>${t('inbox.org.foldHint')}<//>
      <//>

      <${Section} id="inbox-org-rules" title=${t('inbox.org.rulesTitle')} count=${rules.length || null}>
        <${Note}>${t('inbox.org.rulesHint')}<//>
        <${List} cols="name-doors" keepCols empty=${rules.length === 0 ? t('inbox.org.rulesEmpty') : null}>
          ${rules.map(r => html`<${ListRow} key=${r.id} faded=${!r.enabled}>
            <${Name} meta=${ruleSummary(r)}>${r.name}<//>
            <${Doors}>
              <${Switch} on=${r.enabled} disabled=${busy} label=${r.enabled ? t('inbox.org.ruleInUse') : t('inbox.org.rulePaused')} onToggle=${() => toggleRule(r)} />
              <${Action} small soft disabled=${busy} onClick=${() => org.saveSettings({ remove_rule: r.id })}>${t('inbox.org.ruleRemove')}<//>
            <//>
          <//>`)}
        <//>

        <${Fields} cols=${2}>
          <${TextField} label=${t('inbox.org.ruleName')} maxLength=${80} value=${draft.name} onInput=${(v) => set({ name: v })} />
          <${Choice} wide label=${t('inbox.org.ruleAction')} value=${draft.action} onChange=${(a) => set({ action: a })}
            options=${ACTIONS.map(a => [a, actionWord(a)])} />
          <${TextField} label=${t('inbox.org.ruleWith')} maxLength=${200} list="inbox-contact-suggest" value=${draft.with} onInput=${(v) => set({ with: v })} />
          <${TextField} label=${t('inbox.org.ruleSubject')} maxLength=${200} value=${draft.subject} onInput=${(v) => set({ subject: v })} />
          <${TextField} label=${t('inbox.org.ruleBody')} maxLength=${200} value=${draft.body} onInput=${(v) => set({ body: v })} />
          <${TextField} label=${t('inbox.org.ruleOlder')} type="number" min="1" max="365" inputMode="numeric" value=${draft.days} onInput=${(v) => set({ days: v })} />
          <${Choice} wide label=${t('inbox.org.ruleScope')} value=${draft.scope} onChange=${(sc) => set({ scope: sc })}
            options=${SCOPES.map(sc => [sc, scopeWord(sc)])} />
        <//>
        <${FormActions}>
          <${Loud} control disabled=${busy} onClick=${addRule}>${t('inbox.org.ruleAdd')}<//>
          <${Note}>${t('inbox.org.ruleFormHint')}<//>
        <//>
      <//>

      <${Note}>${t('inbox.org.chatHint')}<//>
    <//>`;
}
