/**
 * @file skills-panel.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.9.0 -- 2026-09-26 -- Every part is a kit component (page group G2a): the panel is the Section (its title, and New skill as its door), the editor the TextArea with FormActions and the Note, the skills the List (the version a tag, the description under the name, the ways at the end; View opens the row's panel with the ref, the front matter and the body in the Box's copy tone). The page writes no class.
 *   v1.8.0 -- 2026-09-26 -- A skill's front matter is the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.7.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.6.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.5.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.4.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.3.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.2.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
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

import { Section } from '/components/Section.js';
import { HeadDesc } from '/components/SubHeading.js';
import { Stack } from '/components/Layout.js';
import { TextArea } from '/components/TextField.js';
import { FormActions } from '/components/Field.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Code } from '/components/Mark.js';
import { Box } from '/components/Box.js';
import { List, Row as ListRow, Name, Doors } from '/components/List.js';
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

  const zip = async (skill) => {
    try {
      await skillsService.downloadSkillZip(skill.name, { scope: 'workspace', organism: orgId, ws: wsId });
      showToast(t('skills.zipDownloaded') || 'Skill ZIP downloaded');
    } catch (err) {
      showToast((t('skills.zipFailed') || 'Download failed') + ': ' + err.message, true);
    }
  };
  /** A skill's opened view: its ref, the front matter as code and the body as the Markdown reader. */
  const detail = (skill) => {
    const { frontmatter, body } = splitSkillMd(expandedSkill.fileContents?.['SKILL.md']);
    return html`
      <${Code}>${skill.ref}<//>
      ${frontmatter && html`<${Code} block>${frontmatter}<//>`}
      <${Box} tone="copy"><${Markdown} text=${body} /><//>`;
  };

  return html`
    <${Section} first title=${t('skills.wsPanelTitle') || 'Workspace skills'}
      doors=${html`<${Loud} control onClick=${() => { setEditorMd(WS_SKILL_TEMPLATE); setEditorOpen(!editorOpen); }}>+ ${t('skills.newSkill') || 'New skill'}<//>`}>
      <${HeadDesc}>${t('skills.wsPanelDesc') || 'SKILL.md expertise shared with every member and agent of this workspace. Skills travel with workspace exports and templates, and show up in the AI overview map. Link one to an agent by ref from the agent’s Data Access tab.'}<//>
      ${editorOpen && html`
        <${Stack} below="large">
          <${TextArea} rows=${18} value=${editorMd} onInput=${setEditorMd} />
          <${FormActions}>
            <${Loud} control disabled=${publishing} onClick=${handlePublish}>
              ${publishing ? (t('skills.publishing') || 'Publishing…') : (t('skills.publish') || 'Publish')}
            <//>
            <${Action} small onClick=${() => setEditorOpen(false)}>${t('common.cancel')}<//>
          <//>
          <${Note}>${t('skills.editorHint') || ''}<//>
        <//>
      `}

      <${List} cols="name-doors" loading=${loading ? (t('organisms.loading') || 'Loading…') : false}
        empty=${t('skills.wsEmpty') || 'No workspace skills yet — publish the first one.'}>
        ${skills.map(skill => html`
          <${ListRow} key=${skill.ref} open=${expanded === skill.ref && !!expandedSkill}
            panel=${expanded === skill.ref && expandedSkill ? detail(skill) : null}>
            <${Name} tag=${'v' + skill.version} desc=${skill.description}>${skill.name}<//>
            <${Doors}>
              <${Action} small title=${t('skills.zipHint') || ''} onClick=${() => zip(skill)}>${t('skills.zipBtn') || '⤓ .zip'}<//>
              <${Action} small onClick=${() => copyRef(skill)}>${t('skills.copyRef') || 'Copy ref'}<//>
              <${Action} small expanded=${expanded === skill.ref} onClick=${() => handleToggleView(skill)}>
                ${expanded === skill.ref ? (t('skills.hide') || 'Hide') : (t('skills.view') || 'View')}
              <//>
              <${Action} small onClick=${() => handleEdit(skill)}>${t('common.edit') || 'Edit'}<//>
            <//>
          <//>`)}
      <//>
    <//>
  `;
}
