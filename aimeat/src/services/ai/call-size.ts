/**
 * @file src/services/ai/call-size.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How many input tokens a call sends, as the planner prices it before the call runs
 *   (route-plan.ts estimate; on the node's key, node-key-hold.ts holds that price while it runs).
 *
 *   The estimate counted only the messages (/v1/llm) or the prompt and the system prompt
 *   (/v1/ai/complete), while the call also sends tools, a response format, pictures and files, which a
 *   provider bills as input. A call whose size sat in those parts was priced at a few cents, passed
 *   the allowance test and was debited its real cost only after it ran (secaudit2026oct26,
 *   node-key-hold.ts:estimate:node-key-estimate-omits-call-inputs). Now every part counts:
 *   - text and JSON at about four characters to a token, as before;
 *   - a picture at PICTURE_TOKENS, whatever its address, since a provider bills a picture by its
 *     pixels and not by the length of its data: URL;
 *   - a file by its bytes: a quarter for text, a sixteenth for a binary document such as a PDF, whose
 *     bytes are mostly layout and compression; a file sent as an address at FILE_ADDRESS_TOKENS.
 *   It is the estimate's `inputTokens`, which prices a call on the node's key; the owner's own price
 *   ceiling per call keeps reading `promptTokens`, so a call on an own key is judged as before.
 * @structure PICTURE_TOKENS · FILE_ADDRESS_TOKENS · chatCallInputTokens · textCallInputTokens
 * @usage
 *   estimate: { promptTokens, inputTokens: chatCallInputTokens(body), maxTokens }
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import type { TextFile } from './gateway.js';

/** What one picture is counted at: about what a provider bills a 1024-pixel picture. */
export const PICTURE_TOKENS = 1_000;
/** What one file sent as an address is counted at; its size is not known before the call. */
export const FILE_ADDRESS_TOKENS = 2_000;

const tokensOfText = (chars: number): number => Math.ceil(chars / 4);

/** True for a file the provider reads as text, whose bytes are its words. */
function isTextLike(mediaType: string): boolean {
  const t = mediaType.toLowerCase();
  return t.startsWith('text/') || t.includes('json') || t.includes('xml') || t.includes('csv') || t.includes('yaml');
}

/** The input of a /v1/llm call: the messages, the tools, the tool choice and the response format. */
export function chatCallInputTokens(body: { messages?: unknown; tools?: unknown; tool_choice?: unknown; response_format?: unknown }): number {
  let chars = JSON.stringify(body.messages ?? []).length;
  for (const part of [body.tools, body.tool_choice, body.response_format]) {
    if (part !== undefined) chars += JSON.stringify(part).length;
  }
  return tokensOfText(chars);
}

/** The input of a text call: the prompt, the system prompt, the pictures and the files. */
export function textCallInputTokens(opts: { prompt: string; systemPrompt?: string; images?: string[]; files?: TextFile[] }): number {
  let tokens = tokensOfText(opts.prompt.length + (opts.systemPrompt?.length ?? 0));
  tokens += (opts.images ?? []).filter((u) => typeof u === 'string' && u.length > 0).length * PICTURE_TOKENS;
  for (const f of opts.files ?? []) {
    if (f.data instanceof URL) tokens += FILE_ADDRESS_TOKENS;
    else tokens += Math.ceil(f.data.byteLength / (isTextLike(f.mediaType) ? 4 : 16));
  }
  return tokens;
}
