/**
 * @file notifications/links.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The addresses a notification links to when it is about ONE thing: a shared place or
 *   one of its workspaces, a package, a data product, one item a Settings page opens by id. Each
 *   shape is one the target page reads (named per function), so a press opens the thing the notice
 *   is about and not the list it sits in. A notice about a list keeps the list's own address.
 * @structure organismLink · packageLink · sharedDataLink · openItemLink
 * @usage link: organismLink(org.id, ws)
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial (wish-ilmoitus-vie-jonnekin-ja-sen-tekstin-voi-kopioida): a press on
 *     a shared-place, package or data-product notice opened the list, often the page the person was on.
 */

const enc = encodeURIComponent;

/** One shared place, or one workspace in it: the Organisms page reads ?org= and ?ws= (organisms-tab.js). */
export function organismLink(orgId: string, ws?: string | null): string {
  return `/v1/profile?tab=organisms&org=${enc(orgId)}${ws ? `&ws=${enc(ws)}` : ''}`;
}

/** One package by its group id: the Packages page reads ?package= (packages-tab.js). */
export function packageLink(groupId: string): string {
  return `/v1/profile?tab=packages&package=${enc(groupId)}`;
}

/** One data product by its name, or the page when there is none: "Data you share" reads ?product= (shared-data-tab.js). */
export function sharedDataLink(product?: string | null): string {
  return product ? `/v1/profile?tab=sharedData&product=${enc(product)}` : '/v1/profile?tab=sharedData';
}

/**
 * One item on a Settings page that opens items by id (js/open-item.js useOpenItem): the scheduler's
 * schedule, a workflow, an extension (`ext:<name>`). The bell hands `open` to that page.
 */
export function openItemLink(tab: string, id: string): string {
  return `/v1/profile?tab=${enc(tab)}&open=${enc(id)}`;
}
