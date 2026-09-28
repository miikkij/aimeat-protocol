/**
 * @file views/profile/agents/agent-defaults-section.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent Defaults section — owner-level default rules and token
 *   budget for agents. Mounted at the foot of the Your agents page.
 * @version-history
 *   v1.11.1 -- 2026-09-28 -- No escHtml() on text preact renders: preact escapes text and attributes
 *     itself, so rules with a quote or an ampersand showed as &quot; / &amp;. A rule is the server's
 *     { id, description } object, so the rows show its description (they showed "[object Object]", and
 *     once escHtml was gone preact wrote into the object and Save failed on a circular structure), and
 *     a new rule is sent in that shape (a string rule was refused with 400).
 *   v1.11.0 -- 2026-09-26 -- Every part is a component that takes data (page group G1a): the headings
 *     are SubHeading, the two boxes are the section card, the rules and the token budget are the
 *     List's rows with the name in the key's face (asKey), the new rule is the TextField with its Add
 *     beside it (Enter adds), the budget a number TextField, the foot FormActions.
 *   v1.10.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.9.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.8.0 -- 2026-09-26 -- A rule's name and the token budget's name wear the Key's face (.key-name, css/components/key-name.css); .mem-key keeps only its place (a unification: the look most tabs use).
 *   v1.7.0 -- 2026-09-25 -- The last lines that say nothing is there are the quiet sentence (.poster-quiet); the ecosystem's empty frame goes, its second line is the Hint (Jouni's decision "Empty line", a unification).
 *   v1.6.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.5.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.4.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v1.1.0 — 2026-09-05 — Moved from access-tab/agent-defaults.js to the agents' own folder and
 *     mounted on the Your agents page: the rules are about the agents, not about who holds a key.
 *     Self-loads now (no composite slice to seed from). Nothing else changed.
 *   v1.0.0 — 2026-07-13 — Extracted from access-tab.js (max-file-lines)
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { getOwnerDefaults, upsertOwnerDefaults } from '/js/services/agent-directives.js';
import { swallowed } from '/js/swallowed.js';
import { num } from '/js/format.js';
import { SubHeading } from '/components/SubHeading.js';
import { Card } from '/components/Card.js';
import { Row, Space } from '/components/Layout.js';
import { Action, Loud } from '/components/Action.js';
import { List, Row as ListRow, Name, Cell, Doors } from '/components/List.js';
import { Field, Fields, FormActions } from '/components/Field.js';
import { TextField } from '/components/TextField.js';

/** A rule as the server stores it is { id, description, details? } (models/agent-directives-schemas.ts).
 *  Its text is the description. A plain string is still read, in case an older record holds one. */
const ruleText = (rule) => (typeof rule === 'string' ? rule : (rule?.description || rule?.id || ''));

export function AgentDefaultsSection({ showToast, initial }) {
  const [defaults, setDefaults] = useState(initial?.defaults ?? null);   // seeded from /v1/access/overview; else self-loads
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editRules, setEditRules] = useState([]);
  const [editBudget, setEditBudget] = useState('');
  const [newRule, setNewRule] = useState('');

  const loadDefaults = useCallback(async () => {
    try {
      const resp = await getOwnerDefaults();
      setDefaults(resp?.data?.defaults || null);
    } catch (err) {
      swallowed('agent-defaults: AgentDefaultsSection', err);
      setDefaults(null);
    }
  }, []);

  useEffect(() => { if (!initial) loadDefaults(); }, [loadDefaults]);   // eslint-disable-line react-hooks/exhaustive-deps -- seed once from `initial`; fetch only when unseeded

  // Live update listener
  const liveRef = useRef(loadDefaults);
  liveRef.current = loadDefaults;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  const startEdit = useCallback(() => {
    const rules = defaults?.rules || [];
    const budget = defaults?.default_token_budget;
    setEditRules([...rules]);
    setEditBudget(budget != null ? String(budget) : '');
    setNewRule('');
    setEditing(true);
  }, [defaults]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const budgetVal = editBudget.trim() ? parseInt(editBudget, 10) : undefined;
      if (editBudget.trim() && (isNaN(budgetVal) || budgetVal < 0)) {
        showToast(t('profile.access.adInvalidBudget') || 'Token budget must be a non-negative number');
        setSaving(false);
        return;
      }
      await upsertOwnerDefaults({
        rules: editRules,
        default_token_budget: budgetVal,
        default_memory_areas: defaults?.default_memory_areas || [],
      });
      showToast(t('profile.access.adSaved') || 'Agent defaults saved');
      setEditing(false);
      loadDefaults();
    } catch (e) {
      showToast(e.message || (t('profile.access.adSaveError') || 'Failed to save defaults'));
    } finally {
      setSaving(false);
    }
  }, [editRules, editBudget, defaults, showToast, loadDefaults]);

  const addRule = useCallback(() => {
    if (!newRule.trim()) return;
    // The server accepts only { id, description }: a string rule was refused with 400, so a rule added
    // here could never be saved.
    const description = newRule.trim();
    setEditRules(prev => [...prev, { id: `rule-${Date.now().toString(36)}`, description }]);
    setNewRule('');
  }, [newRule]);

  const removeRule = useCallback((idx) => {
    setEditRules(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const rules = defaults?.rules || [];
  const budget = defaults?.default_token_budget;

  return html`
    <${Space} above="section">
      <${SubHeading} level=${3} desc=${t('profile.access.adDesc') || 'Owner-level defaults that apply to all your agents unless overridden by per-agent directives.'}>${t('profile.access.adTitle') || 'Agent Defaults'}<//>
    <//>

    ${!editing ? html`
      <${Card} tone="section">
        <${Row} gap="none" justify="between" below="small">
          <${SubHeading}>${t('profile.access.adRules') || 'Default Rules'}<//>
          <${Action} small onClick=${startEdit}>
            ${t('profile.access.adEdit') || 'Edit'}
          <//>
        <//>

        <${List} cols="name-doors" dense
          empty=${`${t('profile.access.adNoRules') || 'No default rules set.'} ${t('profile.access.adRuleExample') || 'Example: "Always answer in Finnish" or "Never spend morsels without asking".'}`}>
          ${rules.map((rule, i) => html`
            <${ListRow} key=${i}>
              <${Name} asKey>${ruleText(rule)}<//>
              <${Cell} />
            <//>
          `)}
        <//>

        <${List} cols="name-doors" dense>
          <${ListRow}>
            <${Name} asKey>${t('profile.access.adTokenBudget') || 'Token Budget'}<//>
            <${Doors}>
              <${Action} tone="text" title=${t('profile.access.adEdit') || 'Edit'} onClick=${startEdit}>
                ${budget != null ? num(budget) : (t('profile.access.adUnlimited') || 'Unlimited')} ✎
              <//>
            <//>
          <//>
        <//>
      <//>
    ` : html`
      <${Card} tone="section">
        <${SubHeading} level=${4}>${t('profile.access.adEditTitle') || 'Edit Agent Defaults'}<//>
        <${Fields}>
          <${Field} label=${t('profile.access.adRules') || 'Rules'} group>
            <${List} cols="name-doors" dense>
              ${editRules.map((rule, i) => html`
                <${ListRow} key=${i}>
                  <${Name} asKey>${ruleText(rule)}<//>
                  <${Doors}>
                    <${Action} small tone="danger" onClick=${() => removeRule(i)}>
                      ${t('profile.access.adRemoveRule') || 'Remove'}
                    <//>
                  <//>
                <//>
              `)}
            <//>
            <${TextField} ariaLabel=${t('profile.access.adRulePlaceholder') || 'Add a rule...'}
              placeholder=${t('profile.access.adRulePlaceholder') || 'Add a rule...'}
              value=${newRule} onInput=${setNewRule} onEnter=${addRule}
              actions=${html`<${Action} small onClick=${addRule}>${t('profile.access.adAddRule') || 'Add'}<//>`} />
          <//>

          <${TextField} type="number" min="0" label=${t('profile.access.adTokenBudget') || 'Token Budget'}
            placeholder=${t('profile.access.adBudgetPlaceholder') || 'Leave empty for unlimited'}
            value=${editBudget} onInput=${setEditBudget} />

          <${FormActions}>
            <${Loud} control onClick=${handleSave} disabled=${saving}>
              ${saving ? '...' : (t('profile.access.adSave') || 'Save')}
            <//>
            <${Action} small onClick=${() => setEditing(false)}>
              ${t('profile.access.adCancel') || 'Cancel'}
            <//>
          <//>
        <//>
      <//>
    `}
  `;
}
