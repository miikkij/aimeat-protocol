/**
 * @file public/components/People.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who takes part in a place, person by person, each with the agents that act for them.
 *   People is the column of persons; Person is one person in the Object box: a person mark and the
 *   name in bold, the person's tags (you, creator, guest), the node they come from when it is not
 *   this one, and how many things they have done here; under the line, their agents. AgentChip is one
 *   agent as a small rounded chip: `own` (one of the viewer's own agents, a green rim) or `ghost`
 *   (someone else's agent: dashed and dimmed, since the viewer sees only what it has done), with its
 *   count at the end; AgentChips is a row of them. A page passes data and words; it never writes a
 *   class. Its look is css/components/people.css (the values of people-list.css and agent-chip.css,
 *   the .pj-part-* rules, under the component's own names).
 * @structure People({ children }) · Person({ name, marks, node, count, countTitle, children }) ·
 *   AgentChips({ children }) · AgentChip({ own, ghost, title, count, countTitle, children })
 * @usage html`<${People}>
 *          <${Person} name=${o.owner} marks=${html`<${Mark} tone="sun">${t('organisms.you')}<//>`} node=${o.node} count=${o.contributions}>
 *            <${AgentChip} own title=${a.gaii} count=${a.contributions}>🤖 ${a.name}<//>
 *          <//>
 *        <//>`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the People panel's persons and agent chips of
 *     views/profile/organisms/participants-panel.js as a component (page group G2a).
 */
import { h } from 'preact';
import htm from 'htm';
import { Box } from '/components/Box.js';
import { Mark } from '/components/Mark.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const shown = (v) => v !== undefined && v !== null && v !== false && v !== '' && v !== 0;

export function People({ children }) {
  return html`<div class="people">${children}</div>`;
}

/** One person: the line with the name, then the agents (children) under it. */
export function Person({ name, marks, node, count, countTitle, children }) {
  const agents = Array.isArray(children) ? children.flat(Infinity).filter(Boolean) : children;
  const hasAgents = Array.isArray(agents) ? agents.length > 0 : !!agents;
  return html`<${Box} packed>
    <div class="people-line">
      <span>${'👤 '}<strong>${name}</strong></span>
      ${marks}
      ${shown(node) ? html`<span class="people-node">${'🌐 '}${node}</span>` : null}
      ${shown(count) ? html`<${Mark} kind="count" tone="tally" title=${countTitle}>${count}<//>` : null}
    </div>
    ${hasAgents ? html`<${AgentChips}>${agents}<//>` : null}
  <//>`;
}

export function AgentChips({ children }) {
  return html`<div class="agent-chips">${children}</div>`;
}

/** One agent. `count` stands at its end as a tally (0 is still drawn: it says the agent did nothing here). */
export function AgentChip({ own, ghost, title, count, countTitle, children }) {
  return html`<span class=${cx('agent-chip', own && 'agent-chip--own', ghost && 'agent-chip--ghost')} title=${title}>
    ${children}${count !== undefined && count !== null ? html`<${Mark} kind="count" tone="tally" title=${countTitle}>${count}<//>` : null}
  </span>`;
}

export default People;
