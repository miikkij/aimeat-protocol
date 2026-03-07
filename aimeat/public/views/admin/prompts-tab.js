import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import * as api from '/js/services/admin.js';
import { Badge, Empty } from './shared.js';

export default function PromptsTab({ data, reload, session }) {
  const [prompts, setPrompts] = useState([]);
  const [editing, setEditing] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState([]);
  const [versions, setVersions] = useState([]);
  const [viewingVersion, setViewingVersion] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  function toast(text) {
    setMsg(text);
    setTimeout(() => setMsg(null), 3000);
  }

  async function loadPrompts() {
    setLoading(true);
    try {
      const r = await api.getSystemPrompts();
      setPrompts(r.data?.prompts || []);
    } catch (err) {
      console.error('Failed to load prompts', err);
    }
    setLoading(false);
  }

  useEffect(() => { loadPrompts(); }, []);

  async function startEdit(p) {
    setEditing(p.id);
    setEditContent(p.content);
    setEditTags([...(p.tags || [])]);
    setViewingVersion(null);
    try {
      const r = await api.getPromptVersions(p.id);
      setVersions(r.data?.versions || []);
    } catch {
      setVersions([]);
    }
  }

  function cancelEdit() {
    setEditing(null);
    setEditContent('');
    setEditTags([]);
    setVersions([]);
    setViewingVersion(null);
  }

  async function savePrompt(id) {
    setSaving(true);
    try {
      await api.updateSystemPrompt(id, editContent, editTags);
      toast(t('dashboard.promptSaved'));
      cancelEdit();
      await loadPrompts();
    } catch (err) {
      toast('Error: ' + (err.message || 'Save failed'));
    }
    setSaving(false);
  }

  async function activateVersion(promptId, ver) {
    if (!confirm(t('dashboard.promptActivateConfirm'))) return;
    setSaving(true);
    try {
      await api.activatePromptVersion(promptId, ver);
      toast(t('dashboard.promptActivated'));
      cancelEdit();
      await loadPrompts();
    } catch (err) {
      toast('Error: ' + (err.message || 'Activate failed'));
    }
    setSaving(false);
  }

  async function viewVersion(promptId, ver) {
    try {
      const r = await api.getPromptVersion(promptId, ver);
      setViewingVersion(r.data?.version || null);
    } catch {
      setViewingVersion(null);
    }
  }

  function insertVariable(varName) {
    setEditContent(prev => prev + '{{' + varName + '}}');
  }

  function removeTag(idx) {
    setEditTags(prev => prev.filter((_, i) => i !== idx));
  }

  function addTag() {
    const tag = prompt('Tag name:');
    if (tag && tag.trim()) {
      setEditTags(prev => [...prev, tag.trim()]);
    }
  }

  if (!prompts.length && !loading) {
    return html`<${Empty} text="No system prompts configured" />`;
  }

  // Group by category
  const tierPrompts = prompts.filter(p => p.category === 'tier');
  const appBuilderPrompts = prompts.filter(p => p.category === 'app-builder');

  function renderPromptCard(p) {
    const isEditing = editing === p.id;
    return html`
      <div class="adm-card" style="margin-bottom:12px" key=${p.id}>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <strong>${escHtml(p.name)}</strong>
              <span style="font-size:.75rem;color:var(--text-dim)">v${p.version}</span>
              ${(p.tags || []).map(tag => html`<span class="tag">${escHtml(tag)}</span>`)}
            </div>
            <div style="font-size:.8rem;color:var(--text-dim);margin-top:4px">${escHtml(p.description)}</div>
            <div style="font-size:.7rem;color:var(--text-dim);margin-top:2px">
              ${t('dashboard.promptLastUpdated')}: ${new Date(p.updatedAt).toLocaleString()}
            </div>
          </div>
          ${!isEditing && html`
            <button class="adm-btn-action" onClick=${() => startEdit(p)}>${t('dashboard.promptEdit')}</button>
          `}
        </div>

        ${isEditing && html`
          <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">
            <!-- Available variables -->
            ${p.variables && p.variables.length > 0 && html`
              <div style="margin-bottom:8px">
                <span style="font-size:.8rem;font-weight:600">${t('dashboard.promptVariables')}:</span>
                ${' '}
                ${p.variables.map(v => html`
                  <code
                    style="cursor:pointer;margin:0 3px;padding:2px 6px;background:var(--bg-alt);border-radius:4px;font-size:.75rem"
                    onClick=${() => insertVariable(v)}
                    title=${'Click to insert {{' + v + '}}'}
                  >${escHtml(v)}</code>
                `)}
              </div>
            `}

            <!-- Content textarea -->
            <textarea
              style="width:100%;min-height:300px;font-family:monospace;font-size:.8rem;background:var(--bg-alt);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px;resize:vertical"
              value=${editContent}
              onInput=${e => setEditContent(e.target.value)}
            />

            <!-- Tags -->
            <div style="margin-top:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span style="font-size:.8rem;font-weight:600">${t('dashboard.promptTags')}:</span>
              ${editTags.map((tag, i) => html`
                <span class="tag" style="cursor:pointer" onClick=${() => removeTag(i)} title="Click to remove">
                  ${escHtml(tag)} \u00D7
                </span>
              `)}
              <button class="adm-btn-sm" onClick=${addTag}>${t('dashboard.promptAddTag')}</button>
            </div>

            <!-- Save / Cancel -->
            <div style="margin-top:12px;display:flex;gap:8px">
              <button class="adm-btn-action" onClick=${() => savePrompt(p.id)} disabled=${saving}>
                ${saving ? '...' : t('dashboard.promptSave')}
              </button>
              <button class="adm-btn-action" onClick=${cancelEdit}>${t('dashboard.promptCancel')}</button>
            </div>

            <!-- Version history -->
            ${versions.length > 0 && html`
              <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">
                <h4 style="margin:0 0 8px">${t('dashboard.promptVersionHistory')}</h4>
                ${versions.sort((a, b) => b.version - a.version).map(v => html`
                  <div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:.8rem">
                    <span class="mono">v${v.version}</span>
                    <span style="color:var(--text-dim)">
                      \u2014 ${new Date(v.savedAt).toLocaleString()} ${t('dashboard.promptVersionBy')} ${escHtml(v.savedBy)}
                    </span>
                    ${v.version === p.version && html`<span style="color:var(--accent);font-size:.7rem">(${t('dashboard.promptCurrent')})</span>`}
                    ${v.version === 1 && html`<span style="color:var(--text-dim);font-size:.7rem">(${t('dashboard.promptInitial')})</span>`}
                    <button class="adm-btn-sm" onClick=${() => viewVersion(p.id, v.version)}>${t('dashboard.promptViewVersion')}</button>
                    ${v.version !== p.version && html`
                      <button class="adm-btn-sm" onClick=${() => activateVersion(p.id, v.version)} disabled=${saving}>
                        ${t('dashboard.promptActivateVersion')}
                      </button>
                    `}
                  </div>
                `)}

                ${viewingVersion && html`
                  <pre style="margin-top:8px;padding:8px;background:var(--bg-alt);border:1px solid var(--border);border-radius:6px;font-size:.75rem;white-space:pre-wrap;max-height:300px;overflow:auto">${escHtml(viewingVersion.content)}</pre>
                `}
              </div>
            `}
          </div>
        `}
      </div>
    `;
  }

  function renderGroup(title, items) {
    if (!items.length) return null;
    return html`
      <div style="margin-bottom:20px">
        <h3 style="margin:0 0 8px">${title}</h3>
        ${items.map(p => renderPromptCard(p))}
      </div>
    `;
  }

  return html`
    ${msg && html`<div class="adm-toast">${escHtml(msg)}</div>`}
    ${renderGroup(t('dashboard.promptTierGroup'), tierPrompts)}
    ${renderGroup(t('dashboard.promptAppBuilderGroup'), appBuilderPrompts)}
  `;
}
