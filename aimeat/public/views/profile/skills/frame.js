/**
 * @file public/views/profile/skills/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Skills page's views share: the words (x), the shelf a skill sits on, whom
 *   it serves (an app it is bound to, the agents that hold its ref, or nobody in particular), the
 *   words for visibility and size, the rule and the request an AI gets, the install lines, the
 *   SKILL.md splitter, the crumb and the cross-page rail links.
 * @structure x · splitSkillMd · isOwn · whoOf · visibilityWord · sizeWord · dateWord · agentRule ·
 *   agentRequest · installLine · crumb · pageLinks · openTab
 * @usage import { x, whoOf, agentRule } from './frame.js';
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (design canvas "AIMEAT Taidot-sivu", direction A with the
 *     Kenelle column; the registry now says linkedBy, versions, supersededBy and builtin).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';

export const x = (key, vars) => t('skpage.' + key, vars);

/** Split a SKILL.md into its YAML frontmatter (shown as code) and markdown body (rendered). */
export function splitSkillMd(md) {
  const m = String(md ?? '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  return m ? { frontmatter: m[1], body: m[2] } : { frontmatter: '', body: String(md ?? '') };
}

export const isOwn = (s, ownerName) => s.scope === 'user' && s.owner === ownerName;
export const bindingFile = (s) => String(s.binding || s.metadata?.binding || '').split('/').pop() || '';

/** Whom a skill serves, for the Kenelle column: the app it is bound to, the agents holding its ref, or nobody in particular. */
export function whoOf(s, ctx) {
  const file = bindingFile(s);
  const agents = (s.linkedBy || []).map((l) => ({ agent: l.agent, pin: (l.ref.match(/@(\d+\.\d+\.\d+)$/) || [])[1] || '' }));
  if (s.supersededBy) return { kind: 'replaced', label: x('who.replaced'), sub: x('who.replacedSub', { by: s.supersededBy.split('/').pop() }), agents };
  if (file) {
    const title = ctx.apps?.[file] || file.replace(/\.html$/, '').toUpperCase();
    return { kind: 'app', label: x('who.app', { app: title }), file, sub: agents.length ? x('who.appAndAgents', { n: agents.length }) : x('who.appSub'), agents };
  }
  if (agents.length) return { kind: 'agents', label: agents.length === 1 ? x('who.agent', { agent: agents[0].agent }) : x('who.agents', { n: agents.length }), sub: agents[0].pin ? x('who.pinned', { v: agents[0].pin }) : x('who.agentSub'), agents };
  if (s.scope === 'node') return { kind: 'all', label: x('who.all'), sub: s.builtin ? x('who.builtin') : x('who.allSub'), agents };
  if (s.scope === 'workspace') return { kind: 'ws', label: x('who.ws', { name: ctx.orgs?.[s.org] || s.ws }), sub: x('who.wsSub'), agents };
  return { kind: 'free', label: x('who.free'), sub: s.visibility === 'owner' ? x('who.freeOwner') : x('who.freeSub'), agents };
}

export const visibilityWord = (v) => (v === 'public' ? x('vis.public') : v === 'members' ? x('vis.members') : v === 'workspace' ? x('vis.workspace') : x('vis.owner'));
export function sizeWord(files) {
  const bytes = (files || []).reduce((a, f) => a + (f.size || 0), 0);
  return bytes >= 1024 ? x('kb', { n: (bytes / 1024).toFixed(bytes >= 10240 ? 0 : 1).replace('.', ',') }) : x('bytes', { n: bytes });
}
export function dateWord(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' });
}
export const daysAgo = (iso) => (Date.now() - new Date(iso || 0).getTime()) / 86400000;

/** The rule an agent gets with the page's slab. English, since it is for the model. */
export function agentRule(nodeUrl) {
  return [
    'Skills on this AIMEAT node are SKILL.md packs loaded by reference, never copied into prompts. Before driving an app, list the skills bound to it (aimeat_skill_list { binding: "app:<owner>/<file>" }) and read them. When you do not know how something is done here, search the registry by name before guessing (aimeat_skill_list, then aimeat_skill_get { ref }). A skill the owner attached to you loads fresh every time.',
    'A ref says where a skill lives: node:<name>, user:<owner>/<name>, ws:<org>/<ws>/<name>; append @<version> to pin the retained snapshot.',
    `Without MCP: GET ${nodeUrl}/v1/skills and GET ${nodeUrl}/v1/skills/<name>?scope=user&owner=<owner>. Public skills are also listed at ${nodeUrl}/.well-known/agent-skills/index.json.`,
  ].join('\n');
}

/** The request a person pastes into their own AI to have a skill written and published. English, since it is for the model. */
export function agentRequest(ownerName) {
  return [
    'Write a skill for this AIMEAT node that teaches an agent [what, and when to use it]. Read node:aimeat-node-guide first and, when the skill is about an app, the app\'s source.',
    `Publish it into my own skills (aimeat_skill_publish, scope user) and bind it to the app with metadata.binding: app:${ownerName || '<owner>'}/<file>.html when there is one.`,
    'Show me the SKILL.md before publishing. Name: lowercase with hyphens. Description: what it does and when to use it, in one or two sentences.',
  ].join('\n');
}

export const installLine = (ref) => `aimeat skill install ${ref}`;

export function crumb() {
  return html`<div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span>${t('profile.landing.menuBuildShare')}</span><span>/</span><span class="og-crumb-here">${t('skills.tabLabel')}</span></div>`;
}

export const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
export function pageLinks() {
  return html`
    <button type="button" class="og-rail-link" onClick=${() => openTab('agents')}><i>→</i>${t('profile.tabs.agents')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('apps')}><i>→</i>${t('profile.tabs.apps')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('capabilities')}><i>→</i>${t('capabilities.tabLabel')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('organisms')}><i>→</i>${t('profile.tabs.organisms')}<em>→</em></button>`;
}
