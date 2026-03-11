import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, StatsGrid, Empty, ExpandableHelp, Spinner } from './shared.js';
import {
  getSystemPrompts, getSystemPrompt, updateSystemPrompt,
  resetSystemPrompt, getPromptVersions, restorePromptVersion,
} from '/js/services/admin.js';

const GROUP_NAMES = {
  tiers: 'promptsGroupTiers',
  builders: 'promptsGroupBuilders',
  portal: 'promptsGroupPortal',
  knowledge: 'promptsGroupKnowledge',
  platform: 'promptsGroupPlatform',
};

export default function PromptsTab({ data, reload }) {
  const [prompts, setPrompts] = useState(data?.systemPrompts?.prompts || []);
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState(null);
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Group prompts
  const groups = {};
  for (const p of prompts) {
    if (!groups[p.group]) groups[p.group] = [];
    groups[p.group].push(p);
  }

  const stats = [
    { label: t('dashboard.promptsTotal'), value: prompts.length },
    { label: t('dashboard.promptsStatusActive'), value: prompts.filter(p => p.active).length, color: '#22c55e' },
    { label: t('dashboard.promptsStatusInactive'), value: prompts.filter(p => !p.active).length, color: '#ef4444' },
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

  async function handleReset() {
    if (!confirm(t('dashboard.promptsResetConfirm'))) return;
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
  }

  async function handleRestore(version) {
    if (!confirm(t('dashboard.promptsRestoreConfirm'))) return;
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
  }

  // Edit view
  if (editId && editData) {
    return html`
      <div>
        <button class="adm-btn-action" onClick=${() => { setEditId(null); setEditData(null); }}>← ${t('dashboard.promptsTab')}</button>
        <h3 style="margin:12px 0 4px">${escHtml(editData.name)}</h3>
        <p style="color:var(--text-dim);font-size:.85rem;margin:0 0 16px">${escHtml(editData.description)}</p>

        <!-- Active toggle -->
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;cursor:pointer">
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

        <!-- Variables reference -->
        ${editData.variables && editData.variables.length > 0 && html`
          <div class="adm-prompt-vars">
            <strong>${t('dashboard.promptsVariables')}:</strong> ${editData.variables.map(v => html` <code>{{${v}}}</code>`)}
          </div>
        `}

        <!-- Used in -->
        ${editData.usedIn && editData.usedIn.length > 0 && html`
          <div style="margin:8px 0">
            <strong style="font-size:.85rem">${t('dashboard.promptsUsedIn')}:</strong>
            ${editData.usedIn.map(u => html` <span class="adm-prompt-used-tag">${escHtml(u)}</span>`)}
          </div>
        `}

        <!-- Change note -->
        <input type="text" placeholder=${t('dashboard.promptsChangeNotePlaceholder')}
          value=${editData.changeNote || ''}
          onInput=${e => setEditData({...editData, changeNote: e.target.value})}
          style="width:100%;margin:8px 0;padding:6px 10px;background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--text-bright);border-radius:6px" />

        <!-- Buttons -->
        <div style="display:flex;gap:8px;margin:12px 0">
          <button class="adm-btn-action" onClick=${handleSave} disabled=${saving}>
            ${saving ? '...' : t('dashboard.promptsSave')}
          </button>
          <button class="adm-btn-action" style="background:#dc262633;color:#ef4444" onClick=${handleReset} disabled=${saving}>
            ${t('dashboard.promptsReset')}
          </button>
        </div>

        <!-- Version History -->
        <details style="margin-top:16px">
          <summary class="adm-prompt-group-header">${t('dashboard.promptsVersionHistory')} (${versions.length})</summary>
          ${versions.length === 0
            ? html`<${Empty} text=${t('dashboard.promptsNoVersions')} />`
            : versions.map(v => html`
              <div class="adm-prompt-version-row">
                <span style="font-weight:600">v${v.version}</span>
                <span style="color:var(--text-dim);flex:1">${dt(v.changedAt)} · ${escHtml(v.changedBy)}${v.changeNote ? ` · ${escHtml(v.changeNote)}` : ''}</span>
                <button class="adm-btn-sm" onClick=${() => handleRestore(v.version)} disabled=${saving}>
                  ${t('dashboard.promptsRestore')}
                </button>
              </div>
            `)
          }
        </details>
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

    ${Object.keys(groups).length === 0
      ? html`<${Empty} text=${t('dashboard.promptsEmpty')} />`
      : Object.entries(groups).map(([g, items]) => html`
        <details class="adm-card" style="margin-bottom:8px" open>
          <summary class="adm-prompt-group-header">
            ${t('dashboard.' + (GROUP_NAMES[g] || g))} (${items.length})
          </summary>
          ${items.map(p => html`
            <div class="adm-hrow" style="cursor:pointer" onClick=${() => openEdit(p.id)}>
              <div style="flex:1">
                <div style="display:flex;align-items:center;gap:6px">
                  <strong>${escHtml(p.name)}</strong>
                  <${Badge} type=${p.active ? 'healthy' : 'critical'} />
                </div>
                <div style="font-size:.8rem;color:var(--text-dim)">${escHtml(p.description)}</div>
                ${p.usedIn && p.usedIn.length > 0 && html`
                  <div>${p.usedIn.map(u => html`<span class="adm-prompt-used-tag">${escHtml(u)}</span> `)}</div>
                `}
              </div>
              <div style="text-align:right;font-size:.8rem;color:var(--text-dim)">
                <div>v${p.version} · ${dt(p.updatedAt)}</div>
              </div>
            </div>
          `)}
        </details>
      `)
    }
  `;
}
