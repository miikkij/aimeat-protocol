/**
 * @file public/js/services/your-things.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The person's own things the Settings & Controls menu find searches by name: agents,
 *   shared places and their workspaces, apps, schedules, workflows, companies, contacts, skills,
 *   extensions and cortexes. Each list is read with the call its own page already makes; a list
 *   that fails is left out (and traced), so one failing page never empties the find. The places
 *   come back as one menu-find group ("Yours"), each with its kind as the grey word on the right and
 *   what opening it needs (js/open-item.js does the opening). Read when the person first types, and
 *   again when the last read is more than a minute old.
 * @structure loadYourThings(owner) → Promise<FindPlace[]> · openYourThing(place)
 * @usage const items = await loadYourThings(session.owner);
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (Jouni searched an agent's name in the menu find and it found
 *     nothing: it searched only pages).
 */
import { t, getLocale } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { listAgents } from '/js/services/agents.js';
import { listOrganisms, listWorkspaces } from '/js/services/organisms.js';
import { listApps } from '/js/services/apps.js';
import { listAllSchedules } from '/js/services/schedules.js';
import { listWorkflows } from '/js/services/workflows.js';
import { listCompanies } from '/js/services/companies.js';
import { listContacts } from '/js/services/contacts.js';
import { getLibrary } from '/js/services/skills.js';
import { listV8Extensions } from '/js/services/extensions.js';
import { listExtensions as listCortexes } from '/js/services/cortex.js';
import { openItem, openOrganism } from '/js/open-item.js';

/** A list read that cannot take the others down: [] and a trace on failure. */
async function safe(where, fn) {
  try { return (await fn()) || []; } catch (err) { swallowed(`your-things: ${where}`, err); return []; }
}

/** A title that may be one string or one per language ({ en, fi }). */
function inLanguage(s) {
  if (!s) return '';
  if (typeof s === 'string') return s;
  const lang = getLocale();
  return s[lang] || s.en || Object.values(s)[0] || '';
}

/** Run the calls a few at a time: a person in thirty shared places is thirty workspace reads. */
async function inBatches(list, size, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(...await Promise.all(list.slice(i, i + size).map(fn)));
  return out;
}

const kind = (k) => t(`menuFind.kind.${k}`);
const place = (k, id, label, open, extra = {}) => ({ id: `${k}:${id}`, label: String(label || id), tail: kind(k), data: { kind: k, open }, ...extra });

/**
 * Every own thing the find knows how to open, as menu-find places.
 * @param {string} owner the signed-in owner's account name
 */
export async function loadYourThings(owner) {
  const [agents, orgsResp, apps, schedules, workflows, companies, contacts, library, exts, cortexes] = await Promise.all([
    safe('agents', () => listAgents(owner)),
    safe('organisms', () => listOrganisms({ member: owner })),
    safe('apps', () => listApps()),
    safe('schedules', () => listAllSchedules()),
    safe('workflows', () => listWorkflows()),
    safe('companies', () => listCompanies()),
    safe('contacts', () => listContacts()),
    safe('skills', () => getLibrary()),
    safe('extensions', () => listV8Extensions()),
    safe('cortexes', () => listCortexes()),
  ]);
  const orgs = orgsResp?.data?.organisms || [];
  const workspaces = await inBatches(orgs, 6, async (o) => ({ org: o, list: await safe('workspaces', () => listWorkspaces(o.id)) }));
  const sched = schedules?.data || {};

  return [
    ...agents.map((a) => place('agent', a.name, a.name, { tab: 'agents', id: a.name })),
    ...orgs.map((o) => place('organism', o.id, o.name, { organism: o.id })),
    ...workspaces.flatMap(({ org, list }) => list.map((w) => place('workspace', `${org.id}/${w.id}`, w.name,
      { organism: org.id, workspace: w.id }, { tail: `${kind('workspace')} · ${org.name || org.id}` }))),
    ...apps.filter((a) => a.owner === owner).map((a) => place('app', `${a.owner}/${a.filename}`, a.manifest?.name || a.filename,
      { href: `/v1/appcat?q=${encodeURIComponent(a.manifest?.name || a.filename)}` }, { words: [a.filename] })),
    ...[...(sched.managed || []), ...(sched.agentInternal || [])].map((s) => place('schedule', s.id, s.displayName || s.name,
      { tab: 'scheduler', id: s.id })),
    ...(workflows?.data?.workflows || []).map((w) => place('workflow', w.def?.id || w.id, inLanguage(w.def?.title || w.title) || w.def?.id,
      { tab: 'workflows', id: w.def?.id || w.id })),
    ...companies.map((c) => place('company', c.id, c.name, { tab: 'companies', id: c.id }, { words: [c.slug].filter(Boolean) })),
    ...contacts.map((c) => place('contact', c.contact_id, c.saved_name || c.display_name || c.contact_id,
      { tab: 'contacts', id: c.contact_id }, { words: [c.display_name].filter(Boolean) })),
    ...(library?.user || []).map((s) => place('skill', s.ref || s.name, s.name, { tab: 'skills', id: s.ref })),
    ...exts.filter((e) => e.installedBy === owner).map((e) => place('extension', e.name, e.name, { tab: 'extensions', id: `ext:${e.name}` })),
    ...(cortexes?.extensions || []).filter((c) => c.installed_by === owner).map((c) => place('cortex', c.name, c.name,
      { tab: 'extensions', id: `cx:${c.name}` })),
  ];
}

/**
 * Open one of them: its page at the item (open-item.js), a shared place or workspace the Organisms
 * page's own way, an app in the app catalogue.
 * @param {{ data?: { open?: { tab?: string, id?: string, organism?: string, workspace?: string, href?: string } } }} p
 */
export function openYourThing(p) {
  const o = p?.data?.open || {};
  if (o.href) { window.location.assign(o.href); return; }
  if (o.organism) { openOrganism(o.organism, o.workspace); return; }
  if (o.tab && o.id) openItem(o.tab, o.id);
}
