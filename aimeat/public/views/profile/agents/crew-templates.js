/**
 * @file crew-templates.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three starting shapes an empty agent can pick in the Crew tab, as complete crew
 *   definitions (crewaimeat crew_def shape). Each one carries `{{ctx.prompt}}` in a task and a
 *   context chain that is a DAG, so it validates as written and the person changes words, not
 *   structure. Prompt text stays English: it is read by a model, not by the person.
 * @structure CREW_TEMPLATES · buildTemplate(id, agentName) · emptyMember() · emptyTask()
 * @version-history
 *   v1.1.1 -- 2026-11-02 -- morningDigest: no notify tool and no heading or date from the model; the node
 *     sends the digest and dates it (crew63: the model sent nothing and wrote October).
 *   v1.1.0 -- 2026-11-02 -- morningDigest: the agent the home offers on the first visit (Jouni, 2.11
 *     00.52, "three visits" a). Built by buildTemplate, not listed in the Crew tab.
 *   v1.0.0 -- 2026-08-28 -- Initial (JSON-agent Crew tab).
 */

export const CREW_TEMPLATES = [
  { id: 'researcher', nameKey: 'profile.agents.detail.crew.templates.researcher', descKey: 'profile.agents.detail.crew.templates.researcherDesc' },
  { id: 'writerEditor', nameKey: 'profile.agents.detail.crew.templates.writerEditor', descKey: 'profile.agents.detail.crew.templates.writerEditorDesc' },
  { id: 'scheduledWatch', nameKey: 'profile.agents.detail.crew.templates.scheduledWatch', descKey: 'profile.agents.detail.crew.templates.scheduledWatchDesc' },
];

export function emptyMember() {
  return { name: '', role: '', goal: '', backstory: '', tools: [], allow_delegation: false };
}

export function emptyTask() {
  return { id: '', description: '', expected_output: '', agent: '', context: [], async: false };
}

/** A complete definition for `id`, named after the agent it will live on. */
export function buildTemplate(id, agentName) {
  const base = { agent_name: agentName, process: 'sequential', listen_for: ['tasks'], memory: false, discover: false, tags: [] };
  switch (id) {
    case 'researcher':
      return {
        ...base,
        tags: ['research'],
        agents: [
          {
            name: 'researcher', role: 'Research analyst',
            goal: 'Find what is actually known about the topic, from sources a reader can open.',
            backstory: 'You search widely, read the sources rather than the snippets, and keep track of where each fact came from.',
            tools: ['web', 'article_fetch'], allow_delegation: false,
          },
        ],
        tasks: [
          {
            id: 'research',
            description: 'Research this request: {{ctx.prompt}}\n\nToday is {{ctx.today}}. Search, open the most relevant sources, and note the facts with their source URLs.',
            expected_output: 'A brief of at most 400 words: what is known, what is uncertain, and a source list with URLs.',
            agent: 'researcher', context: [], async: false,
          },
        ],
      };
    case 'writerEditor':
      return {
        ...base,
        tags: ['writing'],
        agents: [
          {
            name: 'writer', role: 'Writer',
            goal: 'Turn the request into a clear first draft.',
            backstory: 'You write plainly and structure a text so a reader finds the point in the first paragraph.',
            tools: [], allow_delegation: false,
          },
          {
            name: 'editor', role: 'Editor',
            goal: 'Make the draft tighter and correct without changing what it says.',
            backstory: 'You cut what does not carry weight, fix what is wrong, and keep the writer\'s voice.',
            tools: [], allow_delegation: false,
          },
        ],
        tasks: [
          {
            id: 'draft',
            description: 'Write a first draft for this request: {{ctx.prompt}}',
            expected_output: 'A complete draft in the length and form the request asks for.',
            agent: 'writer', context: [], async: false,
          },
          {
            id: 'edit',
            description: 'Edit the draft you are given. Keep its meaning, improve its clarity, fix errors, and return the finished text only.',
            expected_output: 'The finished text, ready to publish.',
            agent: 'editor', context: ['draft'], async: false,
          },
        ],
      };
    case 'scheduledWatch':
      return {
        ...base,
        tags: ['watch'],
        memory: true,
        agents: [
          {
            name: 'watcher', role: 'Topic watcher',
            goal: 'Notice what changed about the topic since the last check and keep a running note.',
            backstory: 'You check the same topic on a schedule, compare against what you noted last time, and record only what is new.',
            tools: ['web', 'article_fetch', 'memory', 'schedule'], allow_delegation: false,
          },
        ],
        tasks: [
          {
            id: 'check',
            description: 'Check this topic: {{ctx.prompt}}\n\nToday is {{ctx.today}}. Read your previous note from memory if there is one, search for what is new, and update the note.',
            expected_output: 'A short update of what changed since the last check, and the updated running note saved to memory.',
            agent: 'watcher', context: [], async: false,
          },
        ],
      };
    // The first agent the home offers (views/home/morning-digest.js), not listed in CREW_TEMPLATES:
    // the request ({{ctx.prompt}}) is written in the person's language from their profile answers. The
    // node sends the digest and writes its heading and date (schedule deliver: "owner",
    // services/task-result-delivery.ts), so the crew has no notify tool and sends nothing twice.
    case 'morningDigest':
      return {
        ...base,
        tags: ['digest'],
        agents: [
          {
            name: 'editor', role: 'Morning digest editor',
            goal: 'Give the person, each morning, the few pieces of news and information that matter for their own work.',
            backstory: 'You read widely and choose little. You pick what touches the person\'s work, say in one sentence why each item matters to them, and link the source.',
            tools: ['news', 'web', 'article_fetch'], allow_delegation: false,
          },
        ],
        tasks: [
          {
            id: 'digest',
            description: 'Make this morning digest: {{ctx.prompt}}\n\nToday is {{ctx.today}}. Find at most five items from the last day that touch the work described above: the news tool first, then the web. Open each one you keep. Write the digest in the language the request above is written in: for each item one sentence of what happened and one of why it matters for this work, with its link on a line of its own. Write no heading and no date: the node puts the heading and the date on it and sends it to the person. Your final answer is the digest itself.',
            expected_output: 'The digest as the final answer: at most five items, each with what happened, why it matters for the person\'s work, and the source link on its own line.',
            agent: 'editor', context: [], async: false,
          },
        ],
      };
    default:
      return { ...base, agents: [emptyMember()], tasks: [emptyTask()] };
  }
}
