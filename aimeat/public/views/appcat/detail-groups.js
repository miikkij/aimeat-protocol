/**
 * @file public/views/appcat/detail-groups.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How the app detail's sections are grouped, and which of them ask for a look.
 *
 *   Jouni, 2026-10-04: the detail's "On this page" list had 22 items in one run and he kept losing
 *   his place in it. The sections are grouped by why a person opens the page, the page follows the
 *   same order, and the rail names each group:
 *   - Edit: where the work is, editing with AI, the working-copy history, the versions, the actions;
 *   - What this is: about, the design spec, where the app puts what, what it needs, its skills;
 *   - Building together: the roadmap, who else may build it, the audit log;
 *   - Publishing and visibility: server settings, visitors, search, marks, legal pages, promotion;
 *   - Money and agents: the EXCHANGE listing, tool sales, costs and contracts, bundled agents. This
 *     group is `quiet`: when the app sells no tool and bundles no agent, it folds to one line.
 *
 *   A section asks for a look when the catalogue's own "something missing" test (model.js kunto)
 *   says the app lacks what that section fixes, when the design spec is missing or behind the app's
 *   version, or when a legal page the app ought to have is missing. Owner only: those facts are the
 *   owner's (the listing gives nobody else spec_check or the manifest's spec stamp).
 * @structure GROUPS · SECTION_IDS · attentionOf(d, flags)
 * @usage const att = attentionOf(d, kunto(row, bound)); att.spec → ['…'] or undefined
 * @version-history
 *   v1.0.0 — 2026-10-04 — Initial (wish-appcatin-sovellussivulle-design-spec-roadmap-rakentajat-ja-l).
 */
import { x } from '/views/appcat/i18n.js';

/** The groups in page order; each names its sections in page order. */
export const GROUPS = [
  { id: 'edit', title: 'detail.groupEdit', ids: ['work', 'ai', 'history', 'versions', 'actions'] },
  { id: 'what', title: 'detail.groupWhat', ids: ['about', 'spec', 'datamap', 'needs', 'skills'] },
  { id: 'together', title: 'detail.groupTogether', ids: ['roadmap', 'builders', 'audit'] },
  { id: 'publish', title: 'detail.groupPublish', ids: ['manage', 'visitors', 'search', 'marks', 'legal', 'promote'] },
  { id: 'money', title: 'detail.groupMoney', ids: ['odps', 'monetize', 'cost', 'agents'], quiet: true },
];

/** Every section in page order. */
export const SECTION_IDS = GROUPS.flatMap((g) => g.ids);

/** Which section fixes each "something missing" condition of the catalogue (model.js KUNTO_KEYS). */
const KUNTO_SECTION = { noMap: 'datamap', noAi: 'marks', specOff: 'ai', seoOff: 'search', noShot: 'actions', noSkill: 'skills' };

/**
 * The sections that ask for a look, each with the reasons in words: { [sectionId]: string[] }.
 * `flags` is model.js kunto(row, bound) for the app; nothing asks on somebody else's app.
 */
export function attentionOf(d, flags) {
  const out = {};
  if (!d || !d.isOwn) return out;
  const add = (id, why) => { (out[id] = out[id] || []).push(why); };
  for (const [key, id] of Object.entries(KUNTO_SECTION)) if (flags && flags[key]) add(id, x('kunto.' + key));
  const stamp = d.manifest && d.manifest.designSpec;
  if (!stamp) add('spec', x('detail.specMissing'));
  else if (typeof stamp.version === 'number' && stamp.version < (d.version || 0)) add('spec', x('detail.specBehind'));
  const missing = d.legal && d.legal.readiness && Array.isArray(d.legal.readiness.missing) ? d.legal.readiness.missing.length : 0;
  if (missing) add('legal', x('legal.chip', { n: missing }));
  return out;
}
