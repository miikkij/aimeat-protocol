/**
 * @file agent-config-files.test.ts
 * @description The Agent Config tab's requests (public/views/profile/agents/agent-config-files.js,
 *   feature-list audit #78): a save carries the version PUT /v1/memory/:key requires, an upload is a
 *   POST (PUT answers 404 for a key that does not exist) into the agent's namespace, and the
 *   uploaded key sits under the prefix the tab lists, so the file shows in the list.
 * @usage pnpm exec vitest run test/unit/agent-config-files.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #78).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CONFIG_PREFIX, configFileKey, configFileName, uploadRequest, saveRequest } from '../../public/views/profile/agents/agent-config-files.js';

describe('the Agent Config tab requests', () => {
  it('an upload is a POST into the agent namespace under the prefix the list reads', () => {
    const r = uploadRequest({ name: 'joker', gaii: 'joker#alice@node-1' }, 'AGENTS.md', '# hi');
    expect(r.path).toBe('/v1/memory');
    expect(r.body.key.startsWith(CONFIG_PREFIX)).toBe(true);
    expect(r.body.key).toBe('agents.config.joker.AGENTS.md');
    expect(r.body.agent).toBe('joker#alice@node-1');
    expect(r.body.value).toBe('# hi');
    expect(configFileName(r.body.key, 'joker')).toBe('AGENTS.md');
  });

  it('a save sends the version the list read', () => {
    const r = saveRequest({ key: 'agents.config.joker.soul.md', version: 3 }, 'new text');
    expect(r.path).toBe('/v1/memory/agents.config.joker.soul.md');
    expect(r.body).toEqual({ value: 'new text', version: 3 });
  });

  it('names a file from the key shapes the agent and older uploads used', () => {
    expect(configFileName(configFileKey('joker', 'soul.md'), 'joker')).toBe('soul.md');
    expect(configFileName('agents.config.runtime', 'joker')).toBe('runtime');
    expect(configFileName('agents.joker.config.old.md', 'joker')).toBe('old.md');
  });

  it('the tab uses these requests: POST for an upload, no PUT without a version', () => {
    const tab = readFileSync(new URL('../../public/views/profile/agents/tab-agent-config.js', import.meta.url), 'utf8');
    expect(tab).toContain('uploadRequest(');
    expect(tab).toContain('saveRequest(');
    expect(tab).not.toMatch(/apiPut\(`\/v1\/memory\/\$\{encodeURIComponent\([^)]*\)\}`, \{ value: [a-zA-Z]+ \}\)/);
    expect(tab).not.toContain('`agents.${agentName}.config.');
  });
});
