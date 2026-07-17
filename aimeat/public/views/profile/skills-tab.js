/**
 * @file skills-tab.js
 * @description Profile Skills tab — manage the owner's user-scope skills registry
 *   (SKILL.md packs: create/edit, visibility, delete) and browse the node-wide
 *   skill library. Skills are a dedicated system, distinct from knowledge packages;
 *   agents consume them by ref via the Agents view / crew runtimes.
 * @structure
 *   - SkillsTab (default export) — loads the library, renders My skills + Node library
 *   - SkillRow — one manifest row with expand-to-view + edit/delete actions
 *   - editor panel — SKILL.md textarea + visibility select -> POST /v1/skills
 * @usage registered in views/profile.js TABS as id 'skills'
 * @version-history
 *   v1.0.0 -- 2026-07-05 -- Initial creation (Skills feature Phase 2b)
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { Spinner, VisibilityPill } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { Markdown } from '/components/Markdown.js';
import * as skillsService from '/js/services/skills.js';

import { EmptyState } from '/components/EmptyState.js';
const html = htm.bind(h);

/** Split a SKILL.md into its YAML frontmatter (shown as code) and markdown body (rendered). */
export function splitSkillMd(md) {
  const m = String(md ?? '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  return m ? { frontmatter: m[1], body: m[2] } : { frontmatter: '', body: String(md ?? '') };
}

const SKILL_TEMPLATE = `---
name: my-skill
description: What this skill does and when an agent should use it.
---

# My skill

Write the expertise here. This markdown body is injected into an agent's prompt on activation.
`;

export default function SkillsTab({ showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [library, setLibrary] = useState({ node: [], user: [], workspace: [] });
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMd, setEditorMd] = useState(SKILL_TEMPLATE);
  const [editorVisibility, setEditorVisibility] = useState('owner');
  const [publishing, setPublishing] = useState(false);
  const [expanded, setExpanded] = useState(null);       // ref of the expanded skill
  const [expandedSkill, setExpandedSkill] = useState(null);

  const loadLibrary = useCallback(async ({ showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    try {
      const lib = await skillsService.getLibrary();
      setLibrary(lib);
    } catch (err) {
      showToast(t('skills.loadFailed') + ': ' + err.message, true);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadLibrary(); }, [loadLibrary]);

  const loadRef = useRef(loadLibrary);
  loadRef.current = loadLibrary;
  useEffect(() => onLiveUpdate(['skills'], () => { loadRef.current({ showSpinner: false }); }), []);

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const skill = await skillsService.publishSkill({ skillMd: editorMd, visibility: editorVisibility });
      showToast(t('skills.publishOk').replace('{name}', skill?.name ?? ''));
      setEditorOpen(false);
      setEditorMd(SKILL_TEMPLATE);
      await loadLibrary({ showSpinner: false });
    } catch (err) {
      showToast(t('skills.publishFailed') + ': ' + err.message, true);
    } finally {
      setPublishing(false);
    }
  };

  const handleEdit = async (skill) => {
    try {
      const full = await skillsService.getSkill(skill.name, { scope: skill.scope, owner: skill.owner ?? undefined });
      setEditorMd(full?.fileContents?.['SKILL.md'] ?? SKILL_TEMPLATE);
      setEditorVisibility(skill.visibility === 'public' ? 'public' : skill.visibility === 'members' ? 'members' : 'owner');
      setEditorOpen(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      showToast(t('skills.loadFailed') + ': ' + err.message, true);
    }
  };

  const handleDelete = (skill) => {
    confirm(
      t('skills.deleteConfirmBody').replace('{name}', skill.name),
      async () => {
        try {
          await skillsService.deleteSkill(skill.name, skill.scope);
          showToast(t('skills.deletedOk').replace('{name}', skill.name));
          if (expanded === skill.ref) { setExpanded(null); setExpandedSkill(null); }
          await loadLibrary({ showSpinner: false });
        } catch (err) {
          showToast(t('skills.deleteFailed') + ': ' + err.message, true);
        }
      },
      { title: t('skills.deleteConfirmTitle'), danger: true },
    );
  };

  const handleToggleView = async (skill) => {
    if (expanded === skill.ref) { setExpanded(null); setExpandedSkill(null); return; }
    try {
      const full = await skillsService.getSkill(skill.name, { scope: skill.scope, owner: skill.owner ?? undefined });
      setExpanded(skill.ref);
      setExpandedSkill(full);
    } catch (err) {
      showToast(t('skills.loadFailed') + ': ' + err.message, true);
    }
  };

  const handleDownload = async (skill) => {
    try {
      await skillsService.downloadSkillZip(skill.name, { scope: skill.scope, owner: skill.owner ?? undefined, organism: skill.org, ws: skill.ws });
      showToast(t('skills.zipDownloaded'));
    } catch (err) {
      showToast(t('skills.zipFailed') + ': ' + err.message, true);
    }
  };

  const renderRow = (skill, { editable }) => html`
    <div key=${skill.ref} class="pf-skl-row">
      <div class="pf-skl-row-main">
        <span class="pf-skl-name">${skill.name}</span>
        <span class="pf-skl-version">v${skill.version}</span>
        <${VisibilityPill} visibility=${skill.visibility} />
        <span class="pf-skl-files">${skill.files?.length ?? 1} ${t('skills.filesLabel')}</span>
        <span class="pf-skl-actions">
          <button class="btn-ghost btn-sm" title=${t('skills.zipHint')} onClick=${() => handleDownload(skill)}>${t('skills.zipBtn')}</button>
          <button class="btn-ghost btn-sm" onClick=${() => handleToggleView(skill)}>
            ${expanded === skill.ref ? t('skills.hide') : t('skills.view')}
          </button>
          ${editable && html`
            <button class="btn-ghost btn-sm" onClick=${() => handleEdit(skill)}>${t('common.edit') || 'Edit'}</button>
            <button class="btn-ghost btn-sm pf-skl-danger" onClick=${() => handleDelete(skill)}>${t('common.delete')}</button>
          `}
        </span>
      </div>
      <div class="pf-skl-desc">${skill.description}</div>
      ${expanded === skill.ref && expandedSkill && (() => {
        const { frontmatter, body } = splitSkillMd(expandedSkill.fileContents?.['SKILL.md']);
        return html`
          <div class="pf-skl-detail">
            <div class="pf-skl-detail-ref">${skill.ref}</div>
            ${frontmatter && html`<pre class="pf-skl-frontmatter">${frontmatter}</pre>`}
            <div class="pf-skl-body-md"><${Markdown} text=${body} /></div>
            ${(expandedSkill.files ?? []).filter(f => f.path !== 'SKILL.md').map(f => html`
              <div key=${f.path} class="pf-skl-file-row">${f.path} · ${f.size} B</div>
            `)}
          </div>
        `;
      })()}
    </div>
  `;

  return html`
    <div class="pf-skl">
      <${ConfirmUI} />
      <div class="section-title">${t('skills.title')}</div>
      <div class="section-desc">${t('skills.desc')}</div>

      <div class="pf-skl-section">
        <div class="pf-skl-section-header">
          <span class="pf-skl-section-title">${t('skills.mySkills')}</span>
          <button class="btn-primary btn-sm" onClick=${() => { setEditorMd(SKILL_TEMPLATE); setEditorVisibility('owner'); setEditorOpen(!editorOpen); }}>
            + ${t('skills.newSkill')}
          </button>
        </div>

        ${editorOpen && html`
          <div class="pf-skl-editor">
            <textarea class="pf-skl-editor-md" rows="22" value=${editorMd}
                      onInput=${(e) => setEditorMd(e.target.value)}
                      placeholder=${t('skills.editorPlaceholder')}></textarea>
            <div class="pf-skl-editor-actions">
              <label>${t('skills.visibilityLabel')}</label>
              <select value=${editorVisibility} onChange=${(e) => setEditorVisibility(e.target.value)}>
                <option value="owner">${t('skills.visibilityOwner')}</option>
                <option value="members">${t('skills.visibilityMembers')}</option>
                <option value="public">${t('skills.visibilityPublic')}</option>
              </select>
              <button class="btn-primary btn-sm" disabled=${publishing} onClick=${handlePublish}>
                ${publishing ? t('skills.publishing') : t('skills.publish')}
              </button>
              <button class="btn-outline btn-sm" onClick=${() => setEditorOpen(false)}>${t('common.cancel')}</button>
            </div>
            <div class="pf-skl-editor-hint">${t('skills.editorHint')}</div>
          </div>
        `}

        ${loading ? html`<${Spinner} />` : (
          library.user.length === 0
            ? html`<${EmptyState} text=${t('skills.emptyMine')} />`
            : library.user.map(s => renderRow(s, { editable: true }))
        )}
      </div>

      <div class="pf-skl-section">
        <div class="pf-skl-section-header">
          <span class="pf-skl-section-title">${t('skills.nodeLibrary')}</span>
        </div>
        <div class="pf-skl-section-hint">${t('skills.nodeLibraryHint')}</div>
        ${loading ? null : (
          library.node.length === 0
            ? html`<${EmptyState} text=${t('skills.emptyNode')} />`
            : library.node.map(s => renderRow(s, { editable: false }))
        )}
      </div>

      ${!loading && (library.workspace ?? []).length > 0 && html`
        <div class="pf-skl-section">
          <div class="pf-skl-section-header">
            <span class="pf-skl-section-title">${t('skills.workspaceSkills')}</span>
          </div>
          <div class="pf-skl-section-hint">${t('skills.workspaceSkillsHint')}</div>
          ${library.workspace.map(s => renderRow(s, { editable: false }))}
        </div>
      `}
    </div>
  `;
}
