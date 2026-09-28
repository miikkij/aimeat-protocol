/**
 * @file test/unit/ai-capabilities.test.ts
 * @description The pure parts of V5 of the System 2 plan: the app's prefer.* and local.* in its
 *   aimeat-ai meta, the publish hints about the AI capabilities, and the files of a text call.
 * @usage pnpm test -- ai-capabilities
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V5 of the System 2 plan).
 */
import { describe, it, expect } from 'vitest';
import { parseAiPosture, lintAppAiDisclosure } from '../../src/services/app-ai-posture.js';
import { lintAppAiCapabilityUse } from '../../src/services/app-ai-capability-hints.js';
import { readCallFiles, CALL_FILE_LIMITS } from '../../src/services/ai-call-files.js';
import type { Storage } from '../../src/storage/interface.js';

const meta = (content: string) => `<html><head><meta name="aimeat-ai" content="${content}"></head></html>`;

describe('prefer.* and local.* in the aimeat-ai meta', () => {
  it('reads a type or a model reference per capability, in order, and keeps the model\'s case', () => {
    const p = parseAiPosture(meta('generates=text,image; prefer.text=anthropic,openrouter; prefer.image=openrouter:Black-Forest-Labs/flux.2-pro; local.transcription=yes'));
    expect(p?.prefer).toEqual({ text: ['anthropic', 'openrouter'], image: ['openrouter:Black-Forest-Labs/flux.2-pro'] });
    expect(p?.local).toEqual(['transcription']);
  });

  it('drops an unknown capability, a malformed entry and a local that is not yes', () => {
    const p = parseAiPosture(meta('prefer.video=openrouter; prefer.text=Not A Type,anthropic; local.image=no; local.embed=true'));
    expect(p?.prefer).toEqual({ text: ['anthropic'] });
    expect(p?.local).toEqual(['embed']);
  });

  it('travels to the stored posture, and a later version that declares nothing keeps it', () => {
    const first = lintAppAiDisclosure(meta('generates=text; discloses=yes; prefer.text=anthropic; local.text=yes')).posture;
    expect(first.prefer).toEqual({ text: ['anthropic'] });
    const next = lintAppAiDisclosure('<html></html>', first).posture;
    expect(next.prefer).toEqual({ text: ['anthropic'] });
    expect(next.local).toEqual(['text']);
  });
});

describe('the publish hints about the capabilities', () => {
  it('asks to check first when a capability is used and capabilities() never is', () => {
    const hints = lintAppAiCapabilityUse('AIMEAT.ai.image({ app_id, prompt })', {});
    expect(hints.some(h => h.includes('AIMEAT.ai.capabilities()'))).toBe(true);
    expect(lintAppAiCapabilityUse('await AIMEAT.ai.capabilities(); AIMEAT.ai.image({ prompt })', {})).toEqual([]);
    expect(lintAppAiCapabilityUse('AIMEAT.ai.complete({ prompt, files: [f] })', {}).length).toBe(1);
  });

  it('asks to declare a model named in a call, and not when the meta declares models', () => {
    const code = 'AIMEAT.ai.isAvailable(); AIMEAT.ai.complete({ prompt, model: "openai:gpt-5.4" })';
    expect(lintAppAiCapabilityUse(code, {}).some(h => h.includes('declares no models'))).toBe(true);
    expect(lintAppAiCapabilityUse(code, { models: ['openai:gpt-5.4'] }).some(h => h.includes('declares no models'))).toBe(false);
  });

  it('warns about vectors written to memory', () => {
    const hints = lintAppAiCapabilityUse('AIMEAT.ai.capabilities(); const v = await AIMEAT.ai.embed({ input }); await AIMEAT.data.set(k, v)', {});
    expect(hints.some(h => h.includes('1024 kB'))).toBe(true);
  });
});

describe('the files of a text call', () => {
  const file = { data: Buffer.from('%PDF-1.4'), mimeType: 'application/pdf' };
  const storage = { getStorageFile: async (gaii: string, key: string) => (gaii === 'me@n' && key === 'docs/a.pdf' ? file : null) } as unknown as Storage;

  it('reads a key in the caller\'s own storage and a data: URL', async () => {
    const out = await readCallFiles(storage, 'me@n', [{ storage_key: 'docs/a.pdf' }, { data_url: 'data:text/plain;base64,aGVp', filename: 'b.txt' }]);
    expect(out.map(f => [f.mediaType, f.filename])).toEqual([['application/pdf', 'a.pdf'], ['text/plain', 'b.txt']]);
    expect(Buffer.from(out[1].data as Uint8Array).toString()).toBe('hei');
  });

  it('answers 404 for a key that is not the caller\'s, and refuses an https URL and too many files', async () => {
    await expect(readCallFiles(storage, 'someone@n', [{ storage_key: 'docs/a.pdf' }])).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(readCallFiles(storage, 'me@n', [{ data_url: 'https://example.com/a.pdf' }])).rejects.toMatchObject({ code: 'INVALID_BODY' });
    const many = Array.from({ length: CALL_FILE_LIMITS.maxFiles + 1 }, () => ({ data_url: 'data:text/plain;base64,aA==' }));
    await expect(readCallFiles(storage, 'me@n', many)).rejects.toMatchObject({ code: 'INVALID_BODY' });
  });
});
