/**
 * @file msm-tab.groups.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one rule the MSM page adds to what the server sends: which manifests describe
 *   the same thing.
 *
 *   TEN MANIFESTS, TWO ADDRESSES. On aimeat.io five of the ten describe one RSS feed under five
 *   names, written over two days by two people, and three more geocode a place. Read down a column
 *   of names that is ten integrations; read by where they point it is four services and six spare
 *   copies. Nothing on the page said which, because the listing carried a name and a count and
 *   nothing about the address.
 *
 *   TWO MANIFESTS ARE RELATED WHEN THEY CALL THE SAME HOST, OR WHEN THEY OFFER AN ACTION OF THE
 *   SAME NAME, and relation travels: a third that shares the action name but not the host joins
 *   the pair. Both halves are needed and neither is enough. Host alone splits the three geocoders,
 *   because two go to OpenStreetMap and one to OpenCage. Action name alone splits the five RSS
 *   manifests, because two say fetch-feed and three say fetch-rss.
 *
 *   THE FACT THAT JOINED THEM IS PART OF THE ANSWER, not just a yes: a cluster carries the hosts
 *   every member calls and the actions every member offers, and the page prints whichever it has,
 *   so an operator can see the reason and overrule it.
 * @structure hostsOf() · actionsOf() · relatedSets()
 * @usage import { relatedSets } from './msm-tab.groups.js'
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the page in the poster face.
 */

/** The hosts one listing row says it calls. The server derives these; a row without them has none. */
export function hostsOf(m) {
    return Array.isArray(m?.hosts) ? m.hosts.filter(h => typeof h === 'string' && h) : [];
}

/** The action names one listing row offers. */
export function actionsOf(m) {
    return Array.isArray(m?.actions) ? m.actions.filter(a => typeof a === 'string' && a) : [];
}

/** What both members of a pair have, in the first one's order. */
function shared(a, b) {
    return a.filter(x => b.includes(x));
}

/**
 * The manifests that describe the same thing, as clusters of two or more. Every other manifest is
 * left out; the page lists those on their own. A cluster is:
 *   { key, items, sharedHosts, sharedActions }
 * where the two shared lists are what EVERY member has, so an empty one means the members were
 * joined through the other half or through a third manifest.
 */
export function relatedSets(items) {
    const rows = Array.isArray(items) ? items : [];
    const parent = new Map(rows.map(m => [m.name, m.name]));
    const find = (n) => { while (parent.get(n) !== n) { parent.set(n, parent.get(parent.get(n))); n = parent.get(n); } return n; };

    for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
            const sameHost = shared(hostsOf(rows[i]), hostsOf(rows[j])).length > 0;
            const sameAction = shared(actionsOf(rows[i]), actionsOf(rows[j])).length > 0;
            if (!sameHost && !sameAction) continue;
            const ri = find(rows[i].name);
            const rj = find(rows[j].name);
            if (ri !== rj) parent.set(rj, ri);
        }
    }

    const byRoot = new Map();
    for (const m of rows) {
        const root = find(m.name);
        if (!byRoot.has(root)) byRoot.set(root, []);
        byRoot.get(root).push(m);
    }

    const out = [];
    for (const [root, members] of byRoot) {
        if (members.length < 2) continue;
        let sharedHosts = hostsOf(members[0]);
        let sharedActions = actionsOf(members[0]);
        for (const m of members.slice(1)) {
            sharedHosts = shared(sharedHosts, hostsOf(m));
            sharedActions = shared(sharedActions, actionsOf(m));
        }
        out.push({ key: `set:${root}`, items: members, sharedHosts, sharedActions });
    }
    // Biggest first: the pile worth looking at is the one with the most copies in it.
    out.sort((a, b) => b.items.length - a.items.length || a.items[0].name.localeCompare(b.items[0].name));
    return out;
}

/** The manifests no cluster claimed, in the order they were given. */
export function loneOnes(items, sets) {
    const claimed = new Set(sets.flatMap(s => s.items.map(m => m.name)));
    return (Array.isArray(items) ? items : []).filter(m => !claimed.has(m.name));
}
