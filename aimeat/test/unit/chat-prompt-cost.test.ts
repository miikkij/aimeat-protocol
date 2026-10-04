/**
 * @file chat-prompt-cost.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two halves of the chat's prompt cost (hosted fleet report, 2026-10-04):
 *   - services/goose-chat-config.ts: the chat's goose config switches off every goose extension but
 *     todo, gives an empty working directory, and leaves an operator's own config.yaml alone.
 *   - routes/llm-proxy.ts cacheSessionId: the session_id OpenRouter routes a conversation by is the
 *     system message's hash, so every round and every conversation on the same prefix share it, and
 *     the caller's own session_id or prompt_cache_key wins.
 *   The measured effect (characters per round, cache hits, cost) is scripts/chat-turn-measure.ts.
 * @usage pnpm exec vitest run test/unit/chat-prompt-cost.test.ts
 * @version-history
 *   v1.1.0 — 2026-10-04 — The key is the system message alone (the payer split the cache by person).
 *   v1.0.0 — 2026-10-04 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  ensureChatGooseConfig, chatGooseConfigYaml, CHAT_GOOSE_EXTENSIONS, NODE_CONFIG_MARKER,
} from '../../src/services/goose-chat-config.js';
import { cacheSessionId } from '../../src/routes/llm-proxy.js';

const fresh = () => ({ goosePathRoot: mkdtempSync(join(tmpdir(), 'aimeat-goose-test-')), nodeId: 'aimeat-test-node' });

describe('the chat goose config', () => {
  it('switches off every goose extension but todo, in the shape goose reads', () => {
    const doc = parse(chatGooseConfigYaml()) as { extensions: Record<string, { enabled: boolean; type: string; name: string }> };
    const on = Object.entries(doc.extensions).filter(([, e]) => e.enabled).map(([n]) => n);
    expect(on).toEqual(['todo']);
    for (const name of ['developer', 'analyze', 'apps', 'extensionmanager', 'skills', 'summon', 'tom']) {
      expect(doc.extensions[name], name).toMatchObject({ enabled: false, type: 'platform', name });
    }
    expect(Object.keys(doc.extensions).sort()).toEqual(Object.keys(CHAT_GOOSE_EXTENSIONS).sort());
  });

  it('writes the config and an empty working directory, and rewrites only its own file', () => {
    const cfg = fresh();
    const { root, cwd } = ensureChatGooseConfig(cfg);
    const file = join(root, 'config', 'config.yaml');
    expect(readFileSync(file, 'utf8')).toBe(chatGooseConfigYaml());
    expect(readdirSync(cwd)).toEqual([]);

    // An older file of the node's own is brought up to date.
    writeFileSync(file, `${NODE_CONFIG_MARKER}\nextensions: {}\n`);
    ensureChatGooseConfig(cfg);
    expect(readFileSync(file, 'utf8')).toBe(chatGooseConfigYaml());
  });

  it('leaves an operator\'s own config.yaml as it is', () => {
    const cfg = fresh();
    mkdirSync(join(cfg.goosePathRoot, 'config'), { recursive: true });
    const theirs = 'extensions:\n  developer:\n    enabled: true\n    type: platform\n    name: developer\n';
    writeFileSync(join(cfg.goosePathRoot, 'config', 'config.yaml'), theirs);
    ensureChatGooseConfig(cfg);
    expect(readFileSync(join(cfg.goosePathRoot, 'config', 'config.yaml'), 'utf8')).toBe(theirs);
  });
});

describe('cacheSessionId', () => {
  const system = { role: 'system', content: 'You are goose.' };
  const first = { role: 'user', content: 'What is the capital of Finland?' };

  it('is the same for every round of one conversation, and for every conversation with the same prefix', () => {
    const round1 = cacheSessionId({ messages: [system, first] });
    const round2 = cacheSessionId({ messages: [system, first, { role: 'assistant', content: 'Helsinki.' }, { role: 'user', content: 'Thanks' }] });
    const another = cacheSessionId({ messages: [system, { role: 'user', content: 'Something else' }] });
    expect(round1).toBe(round2);
    // The prefix a cache reuses is the system message; another question on it goes to the same provider.
    expect(another).toBe(round1);
    expect(round1).toMatch(/^aimeat-[0-9a-f]{40}$/);
  });

  it('differs for another system message, and carries no content', () => {
    const base = cacheSessionId({ messages: [system, first] });
    expect(cacheSessionId({ messages: [{ role: 'system', content: 'You are a CRM agent.' }, first] })).not.toBe(base);
    expect(base).not.toContain('goose');
  });

  it('takes the caller\'s own session_id, then prompt_cache_key', () => {
    expect(cacheSessionId({ messages: [system, first], session_id: ' crew-run-7 ' })).toBe('crew-run-7');
    expect(cacheSessionId({ messages: [system, first], prompt_cache_key: 'pck-1' })).toBe('pck-1');
    expect(cacheSessionId({ session_id: 'x'.repeat(300) })).toHaveLength(256);
  });
});
