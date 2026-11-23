/**
 * @file public/views/appcat/gap-prompt.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The prompt the catalogue composes for the person's own AI when an own app is missing
 *   something (model.js kunto): one app with everything it lacks, or several apps that lack the same
 *   thing. The person copies it, reads it and pastes it into their AI, which does the work through
 *   the MCP tools the text names. Each fix sentence names the tool that does it, as its catalog
 *   definition describes it (src/tool-catalog/definitions/): aimeat_datamap_get and _set for the data
 *   map, aimeat_app_publish with the build guide's spec_token, aimeat_app_manage actions `seo` and
 *   `screenshot`, aimeat_skill_publish with metadata.binding. Two conditions are the owner's choice
 *   and not a fault (kept out of search engines, unchanged for 60 days), and their sentences ask
 *   before anything changes. English, as every prompt; no import, so the unit runner loads it.
 * @structure GAP_FIX · NAMED_APPS · gapPrompt(apps)
 * @usage copy=${gapPrompt([{ name: 'Shop', ref: 'alice/shop.html', gaps: ['noMap', 'noShot'] }])}
 * @version-history
 *   v1.0.0 — 2026-11-23 — Initial.
 */

/** What the AI does about each condition, written about "the app". The keys are model.js KUNTO_KEYS. */
export const GAP_FIX = {
  noMap: 'It has no data map, the statement of what the app stores, where and why. Read the map as it stands (aimeat_datamap_get), work out from the source what the app stores and where, and write the whole map with aimeat_datamap_set. Leave a "why" you cannot see in the code empty and ask me for it.',
  noAi: 'The server has no record of whether it uses AI. Read the source. If the app makes text, pictures, audio or video with AI, add <meta name="aimeat-ai" content="generates=text; discloses=yes; public-interest=no"> to its head with the kinds it makes, and show the AI label where that output appears (AIMEAT.ai.disclose). Then publish it again with aimeat_app_publish: the publish records the AI use, and its answer names anything still missing.',
  specOff: 'It was published without the current build guide. Fetch the guide (GET /v1/prompts/build-app-atelier), check the app against it, correct what differs, and publish the new version with the guide\'s spec_token (aimeat_app_publish).',
  seoOff: 'Search engines cannot find it. This can be what I want, so ask me first. On my yes, switch it on with aimeat_app_manage, action seo, with index true and a title and a description for the search result.',
  stale60: 'It has not changed in 60 days. Nothing is broken. Tell me what it does and how often it was opened, and ask me whether I still need it. Delete nothing.',
  noShot: 'It has no screenshot. Take one with aimeat_app_manage, action screenshot: it renders the published app and stores the picture.',
  noSkill: 'No skill is bound to it, so an AI that meets the app has no guide for it. Write a short skill that says what the app is for and how an AI uses it, and publish it with aimeat_skill_publish, bound to the app (metadata.binding "app:<owner>/<filename>").',
};

/** How many apps a prompt for several names; the rest are counted, and the AI lists them itself. */
export const NAMED_APPS = 25;

const RULES_ONE = 'Read the app before you change it (aimeat_app_get). Tell me what you will change before you publish a new version or change who can find the app, and wait for my yes. When you are done, tell me in plain words what you changed and what is still open.';
const RULES_MANY = 'Read each app before you change it (aimeat_app_get). Tell me what you will change before you publish a new version or change who can find an app, and wait for my yes. When you are done, tell me in plain words what you changed and what is still open.';

/**
 * The prompt for the apps given. One app: everything it lacks, numbered. Several apps: the
 * conditions they share are said once and each app is named with its reference.
 * @param {{ name: string, ref: string, gaps: string[] }[]} apps `ref` is "owner/filename"; `gaps`
 *   are KUNTO_KEYS in the order to do them
 * @returns {string} '' when no app has a known condition
 */
export function gapPrompt(apps) {
  const list = (apps || [])
    .map((a) => ({ name: String(a.name || a.ref || ''), ref: String(a.ref || ''), gaps: (a.gaps || []).filter((g) => GAP_FIX[g]) }))
    .filter((a) => a.ref && a.gaps.length);
  if (!list.length) return '';
  if (list.length === 1) {
    const [app] = list;
    // One app: the skill's binding names the app itself, so nothing is left for the AI to fill in.
    const steps = app.gaps.map((g, i) => `${i + 1}. ${GAP_FIX[g].replace('app:<owner>/<filename>', 'app:' + app.ref)}`).join('\n');
    return `Fix what my AIMEAT app "${app.name}" (${app.ref}) is missing. Work through the AIMEAT MCP tools, in my name.\n\nWhat is missing, and what to do about each:\n${steps}\n\n${RULES_ONE}`;
  }
  const shared = [];
  for (const app of list) for (const g of app.gaps) if (!shared.includes(g)) shared.push(g);
  const steps = shared.map((g, i) => `${i + 1}. ${GAP_FIX[g]}`).join('\n');
  const named = list.slice(0, NAMED_APPS).map((a) => `- ${a.name} (${a.ref})`).join('\n');
  const rest = list.length > NAMED_APPS
    ? `\nand ${list.length - NAMED_APPS} more: list my apps with aimeat_app_list and ask me which to do next.`
    : '';
  return `Fix what ${list.length} of my AIMEAT apps are missing. Work through the AIMEAT MCP tools, in my name, one app at a time.\n\nWhat is missing in each app, and what to do about it:\n${steps}\n\nThe apps:\n${named}${rest}\n\n${RULES_MANY}`;
}
