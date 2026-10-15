/**
 * @file agent-config-files.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The memory addresses and requests behind the Agent Config tab's files
 *   (tab-agent-config.js). Pure functions, no imports, so a unit test reads them as they ship.
 *
 *   ONE PREFIX. An agent publishes its configuration under `agents.config.<agent name>.*` in its own
 *   namespace (the skill bundle and the onboarding check read that address), and the tab lists that
 *   prefix in the agent's namespace. An uploaded file goes to the same place: the owner writes it
 *   into the agent's namespace with POST /v1/memory and `agent`, which creates the record or
 *   replaces one of the same name. The upload used to write `agents.<name>.config.<file>` into the
 *   owner's namespace with PUT, which answers 404 for a key that does not exist yet, and the list
 *   would not have shown it anyway (feature-list audit #78).
 *
 *   A SAVE SENDS THE VERSION. PUT /v1/memory/:key refuses a body without the version it read
 *   (400), and a stale one with 409 VERSION_CONFLICT, so an edit cannot overwrite a change the agent
 *   made in the meantime.
 * @structure CONFIG_PREFIX · configFileKey · configFileName · uploadRequest · saveRequest
 * @usage const r = uploadRequest(agent, 'AGENTS.md', text); await apiPost(r.path, r.body);
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #78).
 */

/** The prefix the agent writes and the tab lists, in the agent's own namespace. */
export const CONFIG_PREFIX = 'agents.config.';

/** `agents.config.<agent name>.<file name>`: where one uploaded file is stored. */
export function configFileKey(agentName, filename) {
  return `${CONFIG_PREFIX}${agentName}.${filename}`;
}

/**
 * The name to show for a stored key: the part after `agents.config.<agent name>.`, else after
 * `agents.config.`. A key in the old upload shape (`agents.<name>.config.<file>`) reads as its file.
 */
export function configFileName(key, agentName) {
  const own = agentName ? `${CONFIG_PREFIX}${agentName}.` : null;
  if (own && key.startsWith(own) && key.length > own.length) return key.slice(own.length);
  return key.replace(/^agents\.(?:config\.|[^.]+\.config\.)/, '');
}

/**
 * The request that stores an uploaded file: POST /v1/memory into the agent's namespace. POST
 * creates the record, or replaces one with the same key.
 * @param {{ name: string, gaii?: string }} agent
 */
export function uploadRequest(agent, filename, content) {
  return {
    path: '/v1/memory',
    body: {
      key: configFileKey(agent.name, filename),
      value: content,
      visibility: 'owner',
      ...(agent.gaii ? { agent: agent.gaii } : {}),
    },
  };
}

/**
 * The request that saves an edited file: PUT /v1/memory/:key with the version the list read.
 * @param {{ key: string, version?: number }} file
 */
export function saveRequest(file, content) {
  return {
    path: `/v1/memory/${encodeURIComponent(file.key)}`,
    body: { value: content, version: file.version },
  };
}
