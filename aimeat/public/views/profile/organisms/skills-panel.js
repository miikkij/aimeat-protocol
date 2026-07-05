/**
 * @file skills-panel.js
 * @description Workspace Skills panel — the workspace-scope slice of the skills registry
 *   (`ws:{org}/{ws}/{name}` refs). Members see the loadable expertise this workspace carries,
 *   view a skill's SKILL.md (rendered markdown), publish/update one into the workspace, and
 *   copy the ref for linking to an agent. Skills published here ride workspace exports and
 *   templates, and surface in the aimeat_workspace_overview map for AI members.
 * @structure SkillsPanel({ orgId, wsId, showToast }) (named export)
 * @usage
 *   import { SkillsPanel } from '/views/profile/organisms/skills-panel.js';
 *   html`<${SkillsPanel} orgId=${orgId} wsId=${wsId} showToast=${showToast} />`
 * @version-history
 *   v1.0.0 -- 2026-07-06 -- Initial creation (Skills feature — workspace UI surface)
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { copyToClipboard } from '/js/utils.js';
import { Markdown } from '/components/Markdown.js';
import { splitSkillMd } from '/views/profile/skills-tab.js';
import * as skillsService from '/js/services/skills.js';

const html = htm.bind(h);

const WS_SKILL_TEMPLATE = `---
name: workspace-skill
description: Expertise shared with every member of this workspace. Describe what it does + when to use it.
---

# Workspace skill

The know-how this workspace's agents and members should share.
`;

export function SkillsPanel({ orgId, wsId, showToast }) {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMd, setEditorMd] = useState(WS_SKILL_TEMPLATE);
  const [publishing, setPublishing] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [expandedSkill, setExpandedSkill] = useState(null);

  const load = useCallback(async ({ showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    try {
      setSkills(await skillsService.listWorkspaceSkills(orgId, wsId));
    } catch (err) {
      showToast((t('skills.loadFailed') || 'Failed to load skills') + ': ' + err.message, true);
    } finally {
      setLoading(false);
    }
  }, [orgId, wsId, showToast]);

  useEffect(() => { load(); }, [load]);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => onLiveUpdate(['skills', 'memory'], () => loadRef.current({ showSpinner: false })), []);

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const skill = await skillsService.publishSkill({
        skillMd: editorMd, scope: 'workspace', organism: orgId, ws: wsId,
      });
      showToast((t('skills.publishOk') || 'Skill {name} published').replace('{name}', skill?.name ?? ''));
      setEditorOpen(false);
      setEditorMd(WS_SKILL_TEMPLATE);
      await load({ showSpinner: false });
    } catch (err) {
      showToast((t('skills.publishFailed') || 'Publish failed') + ': ' + err.message, true);
    } finally {
      setPublishing(false);
    }
  };

  const handleToggleView = async (skill) => {
    if (expanded === skill.ref) { setExpanded(null); setExpandedSkill(null); return; }
    try {
      const full = await skillsService.getSkill(skill.name, { scope: 'workspace', organism: orgId, ws: wsId });
      setExpanded(skill.ref);
      setExpandedSkill(full);
    } catch (err) {
      showToast((t('skills.loadFailed') || 'Failed to load skills') + ': ' + err.message, true);
    }
  };

  const handleEdit = async (skill) => {
    try {
      const full = await skillsService.getSkill(skill.name, { scope: 'workspace', organism: orgId, ws: wsId });
      setEditorMd(full?.fileContents?.['SKILL.md'] ?? WS_SKILL_TEMPLATE);
      setEditorOpen(true);
    } catch (err) {
      showToast((t('skills.loadFailed') || 'Failed to load skills') + ': ' + err.message, true);
    }
  };

  const copyRef = (skill) => {
    copyToClipboard(skill.ref);
    showToast(t('skills.refCopied') || 'Skill ref copied — link it to an agent from its Data Access tab');
  };

  return html`
    <div class="pj-section pf-skl">
      <div class="pf-skl-section-header">
        <span class="pf-skl-section-title">${t('skills.wsPanelTitle') || 'Workspace skills'}</span>
        <button class="btn-primary btn-sm" onClick=${() => { setEditorMd(WS_SKILL_TEMPLATE); setEditorOpen(!editorOpen); }}>
          + ${t('skills.newSkill') || 'New skill'}
        </button>
      </div>
      <div class="section-desc">${t('skills.wsPanelDesc') || 'SKILL.md expertise shared with every member and agent of this workspace. Skills travel with workspace exports and templates, and show up in the AI overview map. Link one to an agent by ref from the agent’s Data Access tab.'}</div>

      ${editorOpen && html`
        <div class="pf-skl-editor">
          <textarea class="pf-skl-editor-md" rows="18" value=${editorMd}
                    onInput=${(e) => setEditorMd(e.target.value)}></textarea>
          <div class="pf-skl-editor-actions">
            <button class="btn-primary btn-sm" disabled=${publishing} onClick=${handlePublish}>
              ${publishing ? (t('skills.publishing') || 'Publishing…') : (t('skills.publish') || 'Publish')}
            </button>
            <button class="btn-outline btn-sm" onClick=${() => setEditorOpen(false)}>${t('common.cancel')}</button>
          </div>
          <div class="pf-skl-editor-hint">${t('skills.editorHint') || ''}</div>
        </div>
      `}

      ${loading ? html`<div class="pj-empty">${t('organisms.loading') || 'Loading…'}</div>` : (
        skills.length === 0
          ? html`<div class="pf-skl-empty">${t('skills.wsEmpty') || 'No workspace skills yet — publish the first one.'}</div>`
          : skills.map(skill => html`
              <div key=${skill.ref} class="pf-skl-row">
                <div class="pf-skl-row-main">
                  <span class="pf-skl-name">${skill.name}</span>
                  <span class="pf-skl-version">v${skill.version}</span>
                  <span class="pf-skl-actions">
                    <button class="btn-ghost btn-sm" onClick=${() => copyRef(skill)}>${t('skills.copyRef') || 'Copy ref'}</button>
                    <button class="btn-ghost btn-sm" onClick=${() => handleToggleView(skill)}>
                      ${expanded === skill.ref ? (t('skills.hide') || 'Hide') : (t('skills.view') || 'View')}
                    </button>
                    <button class="btn-ghost btn-sm" onClick=${() => handleEdit(skill)}>${t('common.edit') || 'Edit'}</button>
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
                    </div>
                  `;
                })()}
              </div>
            `)
      )}
    </div>
  `;
}
