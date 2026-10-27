/**
 * @file test/unit/ai-call-size.test.ts
 * @description What a call sends as input, as the planner prices a call on the node's key
 *   (services/ai/call-size.ts; secaudit2026oct26, node-key-hold.ts:estimate:node-key-estimate-omits-call-inputs):
 *   the tools and response format of a /v1/llm call, and the pictures and files of a text call, count
 *   beside the messages and the prompt. A call with none of them counts as it did.
 * @usage pnpm exec vitest run test/unit/ai-call-size.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import { chatCallInputTokens, textCallInputTokens, PICTURE_TOKENS, FILE_ADDRESS_TOKENS } from '../../src/services/ai/call-size.js';

const messages = [{ role: 'user', content: 'hello there' }];

describe('chatCallInputTokens', () => {
  it('is the messages alone, as before, when the call sends nothing else', () => {
    expect(chatCallInputTokens({ messages })).toBe(Math.ceil(JSON.stringify(messages).length / 4));
  });
  it('grows with the tools, the tool choice and the response format', () => {
    const base = chatCallInputTokens({ messages });
    const tools = [{ type: 'function', function: { name: 'f', description: 'x'.repeat(4000) } }];
    expect(chatCallInputTokens({ messages, tools })).toBeGreaterThan(base + 1000);
    expect(chatCallInputTokens({ messages, tools, tool_choice: 'auto', response_format: { type: 'json_object' } }))
      .toBeGreaterThan(chatCallInputTokens({ messages, tools }));
  });
});

describe('textCallInputTokens', () => {
  it('is the prompt and the system prompt alone, as before, with no pictures or files', () => {
    expect(textCallInputTokens({ prompt: 'a'.repeat(400), systemPrompt: 'b'.repeat(40) })).toBe(110);
  });
  it('counts each picture, whatever the length of its address', () => {
    const one = textCallInputTokens({ prompt: 'p', images: [`data:image/png;base64,${'A'.repeat(100_000)}`] });
    expect(one).toBe(1 + PICTURE_TOKENS);
    expect(textCallInputTokens({ prompt: 'p', images: ['https://a/1.png', 'https://a/2.png', ''] })).toBe(1 + 2 * PICTURE_TOKENS);
  });
  it('counts a file by its bytes: text at a quarter, a binary document at a sixteenth, an address at a flat figure', () => {
    const bytes = new Uint8Array(16_000);
    expect(textCallInputTokens({ prompt: 'p', files: [{ data: bytes, mediaType: 'text/csv' }] })).toBe(1 + 4_000);
    expect(textCallInputTokens({ prompt: 'p', files: [{ data: bytes, mediaType: 'application/pdf' }] })).toBe(1 + 1_000);
    expect(textCallInputTokens({ prompt: 'p', files: [{ data: new URL('https://a/doc.pdf'), mediaType: 'application/pdf' }] })).toBe(1 + FILE_ADDRESS_TOKENS);
  });
});
