/**
 * @file skills-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Skills tab — manage the NODE-scope skills registry: the node-wide
 *   library every agent on this node can load (operator runbooks, user-level how-tos).
 *   Publish/edit SKILL.md packs, set visibility (members = any authenticated node
 *   identity, public = federated), delete. Seeded built-in skills appear here and are
 *   operator-editable; re-seeding never overwrites operator edits.
 * @structure
 *   - SkillsAdminTab (default export) — node registry list + editor
 * @usage registered in views/admin.js NAV_GROUPS
 * @version-history
 *   v1.0.0 -- 2026-07-05 -- Initial creation (Skills feature Phase 2b)
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { Badge, Spinner, Empty, useToast, Toast } from './shared.js';
import { Markdown } from '/components/Markdown.js';
import { splitSkillMd } from '../profile/skills-tab.js';
import * as skillsService from '/js/services/skills.js';

const html = htm.bind(h);

const NODE_SKILL_TEMPLATE = `---
name: node-skill
description: What this skill teaches an agent and when to use it.
---

# Node skill

Expertise available to every agent on this node.
`;

export default function SkillsAdminTab() {
  const [msg, showErr, showOk, clearToast] = useToast();
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMd, setEditorMd] = useState(NODE_SKILL_TEMPLATE);
  const [editorVisibility, setEditorVisibility] = useState('members');
  const [publishing, setPublishing] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [expandedSkill, setExpandedSkill] = useState(null);

  // useToast returns fresh function identities every render — keep them out of
  // the deps (setMsg inside is stable) or the load effect re-fires forever.
  const showErrRef = useRef(showErr);
  showErrRef.current = showErr;
  const load = useCallback(async ({ showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    try {
      setSkills(await skillsService.listScope('node'));
    } catch (err) {
      showErrRef.current(t('dashboard.skills.loadFailed') + ': ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => onLiveUpdate(['skills'], () => loadRef.current({ showSpinner: false })), []);

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const skill = await skillsService.publishSkill({ skillMd: editorMd, scope: 'node', visibility: editorVisibility });
      showOk(t('dashboard.skills.publishOk').replace('{name}', skill?.name ?? ''));
      setEditorOpen(false);
      setEditorMd(NODE_SKILL_TEMPLATE);
      await load({ showSpinner: false });
    } catch (err) {
      showErr(t('dashboard.skills.publishFailed') + ': ' + err.message);
    } finally {
      setPublishing(false);
    }
  };

  const handleEdit = async (skill) => {
    try {
      const full = await skillsService.getSkill(skill.name, { scope: 'node' });
      setEditorMd(full?.fileContents?.['SKILL.md'] ?? NODE_SKILL_TEMPLATE);
      setEditorVisibility(skill.visibility === 'public' ? 'public' : 'members');
      setEditorOpen(true);
    } catch (err) {
      showErr(t('dashboard.skills.loadFailed') + ': ' + err.message);
    }
  };

  const handleDelete = async (skill) => {
    if (!window.confirm(t('dashboard.skills.deleteConfirm').replace('{name}', skill.name))) return;
    try {
      await skillsService.deleteSkill(skill.name, 'node');
      showOk(t('dashboard.skills.deletedOk').replace('{name}', skill.name));
      await load({ showSpinner: false });
    } catch (err) {
      showErr(t('dashboard.skills.deleteFailed') + ': ' + err.message);
    }
  };

  const handleToggleView = async (skill) => {
    if (expanded === skill.ref) { setExpanded(null); setExpandedSkill(null); return; }
    try {
      const full = await skillsService.getSkill(skill.name, { scope: 'node' });
      setExpanded(skill.ref);
      setExpandedSkill(full);
    } catch (err) {
      showErr(t('dashboard.skills.loadFailed') + ': ' + err.message);
    }
  };

  return html`
    <div class="adm-skills">
      ${msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearToast} />`}
      <div class="adm-card">
        <div class="adm-card-header">
          <h3>${t('dashboard.skills.title')}</h3>
          <button class="adm-btn" onClick=${() => { setEditorMd(NODE_SKILL_TEMPLATE); setEditorOpen(!editorOpen); }}>
            + ${t('dashboard.skills.newSkill')}
          </button>
        </div>
        <p class="adm-help-text">${t('dashboard.skills.desc')}</p>

        ${editorOpen && html`
          <div class="adm-skills-editor">
            <textarea class="adm-textarea adm-skills-editor-md" rows="24" value=${editorMd}
                      onInput=${(e) => setEditorMd(e.target.value)}></textarea>
            <div class="adm-skills-editor-actions">
              <label>${t('dashboard.skills.visibilityLabel')}</label>
              <select class="adm-input" value=${editorVisibility} onChange=${(e) => setEditorVisibility(e.target.value)}>
                <option value="members">${t('dashboard.skills.visibilityMembers')}</option>
                <option value="public">${t('dashboard.skills.visibilityPublic')}</option>
              </select>
              <button class="adm-btn" disabled=${publishing} onClick=${handlePublish}>
                ${publishing ? '…' : t('dashboard.skills.publish')}
              </button>
              <button class="adm-btn" onClick=${() => setEditorOpen(false)}>${t('common.cancel')}</button>
            </div>
          </div>
        `}

        ${loading ? html`<${Spinner} />` : (
          skills.length === 0
            ? html`<${Empty} text=${t('dashboard.skills.empty')} />`
            : skills.map(skill => html`
                <div key=${skill.ref} class="adm-skills-row">
                  <div class="adm-skills-row-main">
                    <strong>${skill.name}</strong>
                    <span class="adm-skills-version">v${skill.version}</span>
                    <${Badge} text=${skill.visibility} tone=${skill.visibility === 'public' ? 'warn' : 'info'} />
                    <span class="adm-skills-actions">
                      <button class="adm-btn" onClick=${() => handleToggleView(skill)}>
                        ${expanded === skill.ref ? t('dashboard.skills.hide') : t('dashboard.skills.view')}
                      </button>
                      <button class="adm-btn" onClick=${() => handleEdit(skill)}>${t('dashboard.skills.edit')}</button>
                      <button class="adm-btn adm-btn-danger" onClick=${() => handleDelete(skill)}>${t('common.delete')}</button>
                    </span>
                  </div>
                  <div class="adm-skills-desc">${skill.description}</div>
                  ${expanded === skill.ref && expandedSkill && (() => {
                    const { frontmatter, body } = splitSkillMd(expandedSkill.fileContents?.['SKILL.md']);
                    return html`
                      <div class="adm-skills-detail">
                        ${frontmatter && html`<pre class="adm-skills-frontmatter">${frontmatter}</pre>`}
                        <div class="adm-skills-body-md"><${Markdown} text=${body} /></div>
                      </div>
                    `;
                  })()}
                </div>
              `)
        )}
      </div>
    </div>
  `;
}
