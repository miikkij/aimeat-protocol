/**
 * @file public/views/admin/prompts-tab.js
 * @description Admin dashboard System Prompts tab — browse managed prompts grouped by category,
 *   edit content + locale overrides + active flag, view/restore version history, and reset a
 *   single prompt / group / all prompts to factory defaults.
 *
 * @structure
 *   - GROUP_NAMES: maps prompt group keys to i18n labels
 *   - PromptsTab (default): list view (stats, grouped accordions, reset-group/all) and
 *     an edit view (content textarea, variables/usedIn reference, change note, version history)
 *   - Handlers: openEdit/handleSave/handleReset/handleResetAll/handleRestore call the admin service
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { dt, Badge, StatsGrid, Empty, ExpandableHelp, Spinner } from './shared.js';
import {
  getSystemPrompts, getSystemPrompt, updateSystemPrompt,
  resetSystemPrompt, resetAllSystemPrompts, resetPromptGroup, getPromptVersions, restorePromptVersion,
} from '/js/services/admin.js';
import { useConfirm } from '/components/Modal.js';

const GROUP_NAMES = {
  tiers: 'promptsGroupTiers',
  builders: 'promptsGroupBuilders',
  portal: 'promptsGroupPortal',
  knowledge: 'promptsGroupKnowledge',
  platform: 'promptsGroupPlatform',
  generator: 'promptsGroupGenerator',
};

export default function PromptsTab({ data }) {
  const [prompts, setPrompts] = useState(data?.systemPrompts?.prompts || []);
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState(null);
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { confirm, ConfirmUI } = useConfirm();

  // Group prompts
  const groups = {};
  for (const p of prompts) {
    if (!groups[p.group]) groups[p.group] = [];
    groups[p.group].push(p);
  }

  const stats = [
    { label: t('dashboard.promptsTotal'), value: prompts.length },
    { label: t('dashboard.promptsStatusActive'), value: prompts.filter(p => p.active).length, tone: 'green' },
    { label: t('dashboard.promptsStatusInactive'), value: prompts.filter(p => !p.active).length, tone: 'red' },
    { label: t('dashboard.promptsGroups'), value: Object.keys(groups).length },
  ];

  async function openEdit(id) {
    setLoading(true);
    try {
      const [pRes, vRes] = await Promise.all([
        getSystemPrompt(id),
        getPromptVersions(id),
      ]);
      setEditData({
        ...pRes.data.prompt,
        changeNote: '',
      });
      setVersions(vRes.data.versions || []);
      setEditId(id);
    } catch (e) {
      window.showToast?.(e.message, true);
    }
    setLoading(false);
  }

  async function handleSave() {
    if (!editData) return;
    setSaving(true);
    try {
      const body = {
        content: editData.content,
        active: editData.active,
        locales: editData.locales || undefined,
      };
      if (editData.changeNote) body.changeNote = editData.changeNote;
      const res = await updateSystemPrompt(editId, body);
      setEditData({ ...res.data.prompt, changeNote: '' });
      // Refresh versions and prompt list
      const vRes = await getPromptVersions(editId);
      setVersions(vRes.data.versions || []);
      const listRes = await getSystemPrompts();
      setPrompts(listRes.data.prompts || []);
      window.showToast?.(t('dashboard.promptsSaved'));
    } catch (e) {
      window.showToast?.(e.message, true);
    }
    setSaving(false);
  }

  function handleReset() {
    confirm(t('dashboard.promptsResetConfirm'), async () => {
      setSaving(true);
      try {
        const res = await resetSystemPrompt(editId);
        setEditData({ ...res.data.prompt, changeNote: '' });
        const vRes = await getPromptVersions(editId);
        setVersions(vRes.data.versions || []);
        const listRes = await getSystemPrompts();
        setPrompts(listRes.data.prompts || []);
        window.showToast?.(t('dashboard.promptsResetDone'));
      } catch (e) {
        window.showToast?.(e.message, true);
      }
      setSaving(false);
    }, { danger: true });
  }

  function handleResetAll() {
    confirm(t('dashboard.promptsResetAllConfirm'), async () => {
      setSaving(true);
      try {
        const res = await resetAllSystemPrompts();
        setPrompts(res.data.prompts || []);
        window.showToast?.(t('dashboard.promptsResetAllDone'));
      } catch (e) {
        window.showToast?.(e.message, true);
      }
      setSaving(false);
    }, { danger: true });
  }

  function handleRestore(version) {
    confirm(t('dashboard.promptsRestoreConfirm'), async () => {
      setSaving(true);
      try {
        const res = await restorePromptVersion(editId, version);
        setEditData({ ...res.data.prompt, changeNote: '' });
        const vRes = await getPromptVersions(editId);
        setVersions(vRes.data.versions || []);
        const listRes = await getSystemPrompts();
        setPrompts(listRes.data.prompts || []);
        window.showToast?.(t('dashboard.promptsRestored'));
      } catch (e) {
        window.showToast?.(e.message, true);
      }
      setSaving(false);
    });
  }

  // Edit view
  if (editId && editData) {
    return html`
      <div>
        <button class="adm-btn-action" onClick=${() => { setEditId(null); setEditData(null); }}>← ${t('dashboard.promptsTab')}</button>
        <h3 style="margin:12px 0 4px">${editData.name}</h3>
        <p class="adm-text-dim adm-text-base" style="margin:0 0 16px">${editData.description}</p>

        <!-- Active toggle -->
        <label class="adm-flex-center adm-mb-md" style="cursor:pointer">
          <input type="checkbox" checked=${editData.active}
            onChange=${e => setEditData({...editData, active: e.target.checked})} />
          ${editData.active ? t('dashboard.promptsStatusActive') : t('dashboard.promptsStatusInactive')}
        </label>

        <!-- Content editor -->
        <div class="adm-prompt-editor">
          <label style="font-weight:600;font-size:.9rem">${t('dashboard.promptsContent')}</label>
          <textarea class="adm-prompt-textarea"
            value=${editData.content}
            onInput=${e => setEditData({...editData, content: e.target.value})}
          />
        </div>

        ${/* Finnish override. The store has carried a per-language field all along and the PATCH
              route already validates it — there was simply no box to type in, so an operator could
              not write the Finnish half of anything user-facing. Empty means "no override": the
              English content above is served to everyone. */''}
        <div class="adm-prompt-editor">
          <label style="font-weight:600;font-size:.9rem">${t('dashboard.promptsLocaleFi')}</label>
          <p class="adm-text-dim adm-text-base" style="margin:2px 0 4px">${t('dashboard.promptsLocaleFiHint')}</p>
          <textarea class="adm-prompt-textarea"
            value=${(editData.locales && editData.locales.fi) || ''}
            onInput=${e => setEditData({
              ...editData,
              locales: { ...(editData.locales || {}), fi: e.target.value },
            })}
          />
        </div>

        <!-- Variables reference -->
        ${editData.variables && editData.variables.length > 0 && html`
          <div class="adm-prompt-vars">
            <strong>${t('dashboard.promptsVariables')}:</strong> ${editData.variables.map(v => html` <code>{{${v}}}</code>`)}
          </div>
        `}

        <!-- Used in -->
        ${editData.usedIn && editData.usedIn.length > 0 && html`
          <div style="margin:8px 0">
            <strong class="adm-text-base">${t('dashboard.promptsUsedIn')}:</strong>
            ${editData.usedIn.map(u => u.startsWith('/')
              ? html` <a href="${u}" target="_blank" class="adm-prompt-used-tag" style="text-decoration:none;color:var(--accent,#06b6d4)">${u}</a>`
              : html` <span class="adm-prompt-used-tag">${u}</span>`
            )}
          </div>
        `}

        <!-- Change note -->
        <input class="adm-input adm-input-full" type="text" placeholder=${t('dashboard.promptsChangeNotePlaceholder')}
          value=${editData.changeNote || ''}
          onInput=${e => setEditData({...editData, changeNote: e.target.value})}
          style="margin:8px 0" />

        <!-- Buttons -->
        <div class="adm-flex" style="margin:12px 0">
          <button class="adm-btn-action" onClick=${handleSave} disabled=${saving}>
            ${saving ? '...' : t('dashboard.promptsSave')}
          </button>
          <button class="adm-btn-action adm-btn-danger" onClick=${handleReset} disabled=${saving}>
            ${t('dashboard.promptsReset')}
          </button>
        </div>

        <!-- Version History -->
        <details class="adm-mt-lg">
          <summary class="adm-prompt-group-header">${t('dashboard.promptsVersionHistory')} (${versions.length})</summary>
          ${versions.length === 0
            ? html`<${Empty} text=${t('dashboard.promptsNoVersions')} />`
            : versions.map(v => html`
              <div class="adm-prompt-version-row">
                <span style="font-weight:600">v${v.version}</span>
                <span class="adm-text-dim" style="flex:1">${dt(v.changedAt)} · ${v.changedBy}${v.changeNote ? ` · ${v.changeNote}` : ''}</span>
                <button class="adm-btn-sm" onClick=${() => handleRestore(v.version)} disabled=${saving}>
                  ${t('dashboard.promptsRestore')}
                </button>
              </div>
            `)
          }
        </details>
        <${ConfirmUI} />
      </div>
    `;
  }

  // Loading
  if (loading) return html`<${Spinner} />`;

  // List view
  return html`
    <${StatsGrid} items=${stats} />
    <${ExpandableHelp} title=${t('dashboard.promptsHelpTitle')}>
      <p>${t('dashboard.promptsHelp')}</p>
    </${ExpandableHelp}>

    <div style="margin:12px 0">
      <button class="adm-btn-action adm-btn-danger" onClick=${handleResetAll} disabled=${saving}>
        ${t('dashboard.promptsResetAll')}
      </button>
    </div>

    ${Object.keys(groups).length === 0
      ? html`<${Empty} text=${t('dashboard.promptsEmpty')} />`
      : Object.entries(groups).map(([g, items]) => html`
        <details class="adm-card adm-mb-sm" open>
          <summary class="adm-prompt-group-header">
            ${t('dashboard.' + (GROUP_NAMES[g] || g))} (${items.length})
          </summary>
          <div style="text-align:right;padding:4px 8px">
            <button class="adm-btn-action adm-btn-danger" style="font-size:12px;padding:4px 12px" onClick=${() => {
              confirm(
                t('dashboard.promptsResetGroupConfirm') || 'Reset all prompts in this group to factory defaults?',
                async () => {
                  try {
                    setLoading(true);
                    await resetPromptGroup(g);
                    const res = await getSystemPrompts();
                    setPrompts(res.data.prompts || []);
                    setLoading(false);
                    window.showToast?.(t('dashboard.promptsResetAllDone') || 'Group reset to factory defaults');
                  } catch (err) {
                    setLoading(false);
                    window.showToast?.(err.message, true);
                  }
                },
                { danger: true }
              );
            }}>${t('dashboard.promptsResetGroup') || 'Palauta ryhmä'}</button>
          </div>
          ${items.map(p => html`
            <div class="adm-hrow" style="cursor:pointer" onClick=${() => openEdit(p.id)}>
              <div style="flex:1">
                <div class="adm-flex-center" style="gap:6px">
                  <strong>${p.name}</strong>
                  <${Badge} type=${p.active ? 'healthy' : 'critical'} />
                </div>
                <div class="adm-text-sm adm-text-dim">${p.description}</div>
                ${p.usedIn && p.usedIn.length > 0 && html`
                  <div>${p.usedIn.map(u => u.startsWith('/')
                    ? html`<a href="${u}" target="_blank" class="adm-prompt-used-tag" style="text-decoration:none;color:var(--accent,#06b6d4)" onClick=${e => e.stopPropagation()}>${u}</a> `
                    : html`<span class="adm-prompt-used-tag">${u}</span> `
                  )}</div>
                `}
              </div>
              <div class="adm-text-sm adm-text-dim" style="text-align:right">
                <div>v${p.version} · ${dt(p.updatedAt)}</div>
              </div>
            </div>
          `)}
        </details>
      `)
    }
    <${ConfirmUI} />
  `;
}
