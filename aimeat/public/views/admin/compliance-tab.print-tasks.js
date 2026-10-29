/**
 * @file compliance-tab.print-tasks.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure arithmetic of the Compliance printout: what each person has to do, which AI
 *   uses and apps get a full description, and the counts of the state page. No DOM and no i18n: the
 *   rows carry codes and counts, and compliance-tab.print.js says them in the reader's language.
 *
 *   WHY BY PERSON. Until 2026-10-29 the printout listed the gaps by kind, and an app appeared in every
 *   table that named it: on aimeat.io (195 apps) more than 180 pages, with one maker's ninety apps
 *   repeated in four tables. A reader acts by person, so the tasks are grouped by who does them: the
 *   node's administrator, and each app's maker with the apps each task concerns (Jouni, 2026-10-29).
 *
 *   WHO GETS A FULL DESCRIPTION. An AI use that is not an app (an agent, or a call with no agent), an
 *   AI use in an Annex III area or proposed as high risk, and an app whose personal data anyone, its
 *   maker or an outside service can see (reach `exposed`). Every other app is one line in the table.
 * @structure APP_TASKS · personTasks · fullDescriptions · stateCounts
 * @usage imported by compliance-tab.print.js; tested by test/unit/compliance-print-tasks.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial.
 */

/** A gap kind of an app's scope → the task its maker does. */
export const APP_TASKS = {
  'app-data-map-unreadable': 'fixWords',
  'app-personal-data-without-register': 'register',
  'app-register-without-privacy-notice': 'notice',
  'app-personal-data-domain-unstated': 'domain',
  'retention-conflict': 'retention',
};

/** The report's AI Act gap kinds the per-person list says otherwise (as AI uses, or as a maker's task). */
const AI_KINDS_ELSEWHERE = new Set(['app-uses-ai-not-in-register', 'unclassified-usecase', 'app-declares-generation-with-gap']);

const refKey = (owner, file) => `${owner}/${file}`.toLowerCase();

/**
 * The tasks, grouped by person.
 *
 * @param {{ report: object, uses: Array<object>, savedIds: Set<string>, open: (u: object) => number,
 *   highIds: Set<string>, gapThing: (g: object) => string }} input — `uses` every AI use (saved and
 *   found), `open(u)` the questions open of the ones it is asked, `gapThing(g)` the thing a gap
 *   concerns as the reader reads it.
 * @returns {{ operator: Array<{ task: string, n?: number, kind?: string, items: string[] }>,
 *   makers: Array<{ owner: string, tasks: Array<{ task: string, items: Array<{ title: string, n?: number }> }> }> }}
 */
export function personTasks({ report, uses, savedIds, open, highIds, gapThing }) {
  const apps = (report && report.processing && report.processing.apps) || [];
  const titleOf = new Map(apps.map(a => [String(a.app).toLowerCase(), a.title]));
  const title = (owner, file) => titleOf.get(refKey(owner, file)) || String(file).replace(/\.html$/i, '');

  const operator = [];
  const unsaved = uses.filter(u => !savedIds.has(u.id));
  if (unsaved.length) operator.push({ task: 'save', n: unsaved.length, items: unsaved.map(u => u.title || u.id) });
  const high = uses.filter(u => highIds.has(u.id));
  if (high.length) operator.push({ task: 'high', n: high.length, items: high.map(u => u.title || u.id) });
  // The questions of a use that is not an app are the administrator's; an app's are its maker's.
  const own = uses.filter(u => !(u.apps || []).length && open(u) > 0);
  if (own.length) operator.push({ task: 'answer', n: own.reduce((s, u) => s + open(u), 0), items: own.map(u => u.title || u.id) });

  const makers = new Map();
  const add = (owner, task, item) => {
    if (!owner) return;
    const m = makers.get(owner) || new Map();
    const list = m.get(task) || [];
    if (!list.some(x => x.title === item.title)) list.push(item);
    m.set(task, list);
    makers.set(owner, m);
  };

  const byKind = new Map();
  for (const g of [...((report && report.gaps) || []), ...((report && report.processing && report.processing.gaps) || [])]) {
    const ev = g.evidence || {};
    if (ev.scope === 'app' && ev.owner && ev.app) {
      const task = g.kind === 'app-personal-data-unstated'
        ? ((ev.families || []).length ? 'sayPersonal' : 'writeMap')
        : APP_TASKS[g.kind] || `kind:${g.kind}`;
      add(String(ev.owner), task, { title: title(ev.owner, ev.app) });
      continue;
    }
    if (g.kind === 'app-declares-generation-with-gap' && typeof ev.app === 'string' && ev.app.includes('/')) {
      const [owner, ...rest] = ev.app.split('/');
      add(owner, 'label', { title: title(owner, rest.join('/')) });
      continue;
    }
    if (AI_KINDS_ELSEWHERE.has(g.kind)) continue;
    const list = byKind.get(g.kind) || [];
    list.push(gapThing(g));
    byKind.set(g.kind, list);
  }
  for (const [kind, items] of byKind) operator.push({ task: 'gap', kind, n: items.length, items: [...new Set(items.filter(Boolean))] });

  for (const u of uses) {
    const ref = (u.apps || [])[0];
    const n = open(u);
    if (!ref || n === 0) continue;
    const [owner, ...rest] = String(ref).split('/');
    add(owner, 'aiAct', { title: title(owner, rest.join('/')), n });
  }

  const order = ['writeMap', 'fixWords', 'sayPersonal', 'aiAct', 'register', 'notice', 'domain', 'retention', 'label'];
  const rank = (t) => (order.includes(t) ? order.indexOf(t) : order.length);
  return {
    operator,
    makers: [...makers].map(([owner, m]) => ({
      owner,
      tasks: [...m].map(([task, items]) => ({ task, items })).sort((a, b) => rank(a.task) - rank(b.task)),
    })).sort((a, b) => b.tasks.reduce((s, t) => s + t.items.length, 0) - a.tasks.reduce((s, t) => s + t.items.length, 0) || a.owner.localeCompare(b.owner)),
  };
}

/**
 * Which AI uses and which apps get a full description, in the document's order: the uses that are
 * not apps, the AI uses in an Annex III area or proposed high, then the `exposed` apps (an exposed
 * app that is an AI use prints as that use, once).
 *
 * @returns {{ uses: object[], apps: object[] }} — `apps` the exposed apps that are not an AI use
 */
export function fullDescriptions({ report, uses, highIds }) {
  const apps = (report && report.processing && report.processing.apps) || [];
  const rowOf = new Map(apps.map(a => [String(a.app).toLowerCase(), a]));
  const appOf = (u) => rowOf.get(String((u.apps || [])[0] || '').toLowerCase()) || null;
  const chosen = uses.filter((u) => {
    if (!(u.apps || []).length) return true;
    const row = appOf(u);
    return highIds.has(u.id) || !!(row && (row.annex3 || row.reach === 'exposed'));
  });
  const asUse = new Set(uses.flatMap(u => (u.apps || []).map(a => String(a).toLowerCase())));
  return {
    uses: chosen,
    apps: apps.filter(a => a.reach === 'exposed' && !asUse.has(String(a.app).toLowerCase())),
  };
}

/** The state page's counts from the report's app lines and gaps. */
export function stateCounts(report) {
  const p = (report && report.processing) || {};
  const apps = p.apps || [];
  const by = p.apps_by_reach || {};
  const gaps = p.gaps || [];
  return {
    apps: apps.length,
    exposed: by.exposed || 0,
    shared: by.shared || 0,
    self: by.self || 0,
    none: by.none || 0,
    unknown: by.unknown || 0,
    noRegister: gaps.filter(g => g.kind === 'app-personal-data-without-register').length,
    noNotice: gaps.filter(g => g.kind === 'app-register-without-privacy-notice').length,
    aiApps: apps.filter(a => a.uses_ai).length,
    noLabel: apps.filter(a => a.uses_ai && a.tells_ai === false).length,
  };
}
