/**
 * @file src/static/app-catalog/js/data-map-model.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A VERBATIM COPY of public/components/data-map/model.js. The app catalogue is built
 *   by esbuild with no Preact and no import map, so it cannot import from /components; the house
 *   convention here is to port rather than share (see detail.js). Everything below this header is
 *   byte-identical to the shared file, and test/unit/data-map-model.test.ts asserts exactly that as
 *   well as running both copies over the same table. Edit the shared one; copy it here; the test is
 *   what stops the two answering differently.
 * @version-history
 *   v1.0.0 - 2026-08-24 - Ported for TARGET-073, the surfaces half.
 */
/**
 * On what basis a family is known, strongest first. The order is load-bearing: a coverage view sorts
 * by it and `weakestTier` reports what a whole map should be trusted to.
 */
export const TIERS = ['schema-locked', 'declared-space', 'platform-prefix', 'owner-named', 'none'];

/** What a reader is looking at. `derived` is the one that decides the design — see the renderer. */
export const STATES = ['declared', 'derived', 'contradicted', 'empty'];

/** Higher is stronger. An unknown tier scores lowest, so a bad value can never look reassuring. */
export function tierRank(tier) {
  const i = TIERS.indexOf(tier);
  return i < 0 ? 0 : TIERS.length - i;
}

/** The weakest basis anywhere in the map — what the whole of it should be trusted to. */
export function weakestTier(rows) {
  if (!rows || rows.length === 0) return null;
  return rows.reduce((worst, r) => {
    const tier = (r && r.basis && r.basis.tier) || 'none';
    return tierRank(tier) < tierRank(worst) ? tier : worst;
  }, TIERS[0]);
}

/**
 * Does an observed family fall under a declared pattern? `uutiset.*` covers `uutiset.elokuu.*`.
 *
 * Prefix matching on purpose, and only up to the first `*`: a looser rule would let a near-miss
 * silently satisfy a row, and a contradiction list that under-reports is worse than one that asks
 * about something already covered.
 */
export function covers(pattern, family) {
  if (typeof pattern !== 'string' || typeof family !== 'string') return false;
  const star = pattern.indexOf('*');
  if (star < 0) return pattern === family;
  return family.startsWith(pattern.slice(0, star));
}

/**
 * What the program says it writes versus what it has been seen writing.
 *
 * Two directions, and they mean different things. `undeclared` is a family being written that no row
 * covers — either an area nobody declared or a pattern that is wrong. `dead` is a declared row that
 * has never received a write — either the program never did it, or the pattern is wrong in the other
 * direction. Both are findings; neither is an error.
 */
export function contradictions(map, observed) {
  const held = (map && map.held) || [];
  const seen = observed || [];
  const undeclared = seen.filter(o => !held.some(r => covers(r.grant && r.grant.pattern, o.family)));
  const dead = held.filter(r => (r.grant && r.grant.rights || []).includes('write')
    && seen.length > 0
    && !seen.some(o => covers(r.grant.pattern, o.family)));
  return { undeclared, dead };
}

/**
 * Which of the four states this map is in.
 *
 * `contradicted` outranks everything, because a map that disagrees with reality is the one thing a
 * reader has to see first. `empty` is a statement ("this stores nothing") and never an absence — an
 * absent map and an empty one look identical to a person, and only one of them is a finding.
 */
export function mapState(map, observed) {
  if (!map) return 'empty';
  const rows = [...(map.held || []), ...(map.elsewhere || [])];
  const { undeclared } = contradictions(map, observed);
  // ONLY `undeclared` decides this, and `dead` deliberately does not. A family being written that no
  // row covers is proof of a disagreement. A declared row that has not been written is not: the
  // program may simply not have run that path yet, and treating it as evidence marked every row in
  // the first real screen this reached — which says "all of this is wrong" and so says nothing.
  // `dead` stays computed and is reported as a note, where a reader can weigh it.
  if (undeclared.length > 0) return 'contradicted';
  if (rows.length === 0) return 'empty';
  return map.source === 'derived' ? 'derived' : 'declared';
}

/** The numbers a one-line strip shows without opening anything. */
export function summarise(map, observed) {
  const held = (map && map.held) || [];
  const elsewhere = (map && map.elsewhere) || [];
  const { undeclared, dead } = contradictions(map, observed);
  return {
    state: mapState(map, observed),
    groups: held.length + elsewhere.length,
    unexplained: held.filter(r => !String(r.why || '').trim()).length,
    contradictions: undeclared.length + dead.length,
    weakest: weakestTier([...held, ...elsewhere]),
  };
}

/**
 * Rows in reading order: what disagrees with reality first, then what nobody has explained, then the
 * rest. A reader who stops after three rows should have seen the three that matter.
 */
export function orderRows(map, observed) {
  const held = [...((map && map.held) || [])];
  const { undeclared, dead } = contradictions(map, observed);
  // Ordering may weigh `dead` — being sorted a little higher costs a reader nothing. Colour may not.
  const isContradicted = r => dead.includes(r)
    || undeclared.some(o => covers(r.grant && r.grant.pattern, o.family));
  return held.sort((a, b) => {
    const c = Number(isContradicted(b)) - Number(isContradicted(a));
    if (c !== 0) return c;
    const w = Number(!String(b.why || '').trim()) - Number(!String(a.why || '').trim());
    if (w !== 0) return w;
    return tierRank((a.basis || {}).tier) - tierRank((b.basis || {}).tier);
  });
}
