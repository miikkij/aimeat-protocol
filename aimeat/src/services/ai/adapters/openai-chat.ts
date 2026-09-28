/**
 * @file openai-chat.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Answers an OpenAI chat-completions request with an AI SDK LanguageModelV4, and gives
 *   the answer back as the web `Response` an OpenAI-dialect provider would have sent: a
 *   `chat.completion` JSON body, or a `chat.completion.chunk` SSE stream that ends in `data: [DONE]`.
 *
 *   WHY. The OpenAI-compatible proxy (routes/llm-proxy.ts) and the voice reply stream
 *   (services/ai-voice.ts) forward a chat-completions request and pass the provider's answer to
 *   their client byte for byte, reading usage out of it on the way. That holds for every provider
 *   that speaks the OpenAI dialect. A provider that does not (Anthropic's Messages API) is reached
 *   through its AI SDK package instead, and this module is the conversion on both sides, so those
 *   two callers handle its `Response` exactly as they handle a raw provider response: the same
 *   `response.ok` check, the same frame parser, the same usage frame.
 *
 *   It works at the LanguageModelV4 specification level (`doGenerate` / `doStream`) and never
 *   imports the `ai` package, which only the gateway may import (pnpm check:ai-disclosure).
 *
 *   What is left out on purpose: reasoning parts (OpenAI's chat dialect has no field for them),
 *   sources, files, raw chunks, and tool calls the provider executed itself (a web search run on
 *   the provider's side): an OpenAI client that saw those as `tool_calls` would try to run them.
 * @structure
 *   - OpenAiChatBody — the request fields this module reads
 *   - toCallOptions() — OpenAI request body to LanguageModelV4CallOptions
 *   - mapFinishReason() — V4 finish reason to OpenAI's finish_reason
 *   - v4ResultToChatCompletion() — a doGenerate result as a `chat.completion` object
 *   - v4StreamToOpenAiSse() — a doStream part stream as OpenAI SSE bytes
 *   - openAiChatResponse() — the function the gateway calls: request in, OpenAI `Response` out
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V3 of the System 2 plan).
 */
import { APICallError, getErrorMessage } from '@ai-sdk/provider';
import type {
  LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4FilePart, LanguageModelV4FinishReason,
  LanguageModelV4FunctionTool, LanguageModelV4GenerateResult, LanguageModelV4Message,
  LanguageModelV4Prompt, LanguageModelV4StreamPart, LanguageModelV4TextPart, LanguageModelV4ToolCallPart,
  LanguageModelV4ToolChoice, LanguageModelV4ToolResultPart, LanguageModelV4Usage,
} from '@ai-sdk/provider';
import { randomUUID } from 'node:crypto';
import { logger } from '../../../utils/logger.js';

/** The OpenAI chat-completions request fields this module reads. Other fields are ignored. */
export interface OpenAiChatBody {
  messages: unknown[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  response_format?: unknown;
  stop?: string | string[] | null;
  stream?: boolean;
  [key: string]: unknown;
}

/** The fields every frame and the completion object share. */
export interface OpenAiChatMeta {
  id: string;
  created: number;
  model: string;
}

/** OpenAI's usage object, as callers read it from the last frame or the completion body. */
export interface OpenAiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** A tool call in OpenAI's message shape. */
export interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** OpenAI's `chat.completion` object, as far as this module fills it. */
export interface OpenAiChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    message: { role: 'assistant'; content: string | null; tool_calls?: OpenAiToolCall[] };
    finish_reason: string;
  }>;
  usage: OpenAiUsage;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** An error's own message (getErrorMessage alone would prefix an Error's class name). */
const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : getErrorMessage(e));

// ─── Request: OpenAI body to V4 call options ─────────────────────────────────

/** The text of an OpenAI content value: a string, or the `text` parts of an array joined. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((p): p is Rec => isRec(p) && p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('\n');
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
};

/**
 * An OpenAI `image_url` as a V4 file part. A `data:` URL is decoded to bytes with its own media
 * type; any other URL is passed as a URL, with the media type guessed from the path's extension or
 * left as `image/*`. Nothing is downloaded here: whether a URL is fetched is the provider
 * package's decision (Anthropic accepts an https image URL as it is).
 */
function imagePart(url: string): LanguageModelV4FilePart | null {
  const dataUrl = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(url);
  if (dataUrl) {
    const mediaType = dataUrl[1] || 'image/*';
    const isBase64 = dataUrl[2].split(';').includes('base64');
    const buf = isBase64 ? Buffer.from(dataUrl[3], 'base64') : Buffer.from(decodeURIComponent(dataUrl[3]), 'utf8');
    return { type: 'file', mediaType, data: { type: 'data', data: new Uint8Array(buf.buffer, buf.byteOffset, buf.length) } };
  }
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  const ext = /\.([a-z0-9]+)$/i.exec(parsed.pathname)?.[1]?.toLowerCase();
  return { type: 'file', mediaType: (ext && IMAGE_EXTENSIONS[ext]) || 'image/*', data: { type: 'url', url: parsed } };
}

/** The parts of an OpenAI user message. */
function userParts(content: unknown): Array<LanguageModelV4TextPart | LanguageModelV4FilePart> {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  const parts: Array<LanguageModelV4TextPart | LanguageModelV4FilePart> = [];
  for (const p of content) {
    if (!isRec(p)) continue;
    if (p.type === 'text' && typeof p.text === 'string') parts.push({ type: 'text', text: p.text });
    else if (p.type === 'image_url') {
      const raw = isRec(p.image_url) ? p.image_url.url : p.image_url;
      const part = typeof raw === 'string' ? imagePart(raw) : null;
      if (part) parts.push(part);
    }
  }
  return parts;
}

/**
 * The arguments string of an OpenAI tool call as the object V4 expects. A string that does not
 * parse is sent as `{}`: the conversation continues and the model sees an empty call, which is
 * better than refusing a whole request over one earlier turn a client stored badly.
 */
function parseArguments(raw: unknown): unknown {
  if (typeof raw !== 'string') return isRec(raw) ? raw : {};
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    logger.warn('[ai] a tool call in the conversation has arguments that are not JSON; sent as {}', { error: String(err), length: raw.length });
    return {};
  }
}

/** The OpenAI message list as a V4 prompt. Consecutive `tool` messages become one tool message. */
function toPrompt(messages: unknown[]): LanguageModelV4Prompt {
  const prompt: LanguageModelV4Prompt = [];
  const toolNames = new Map<string, string>();
  for (const m of messages) {
    if (!isRec(m)) continue;
    const role = m.role;
    if (role === 'system' || role === 'developer') {
      prompt.push({ role: 'system', content: contentText(m.content) });
    } else if (role === 'user') {
      const content = userParts(m.content);
      if (content.length > 0) prompt.push({ role: 'user', content });
    } else if (role === 'assistant') {
      const content: Array<LanguageModelV4TextPart | LanguageModelV4ToolCallPart> = [];
      const text = contentText(m.content);
      if (text) content.push({ type: 'text', text });
      for (const call of Array.isArray(m.tool_calls) ? m.tool_calls : []) {
        if (!isRec(call) || typeof call.id !== 'string' || !isRec(call.function)) continue;
        const toolName = typeof call.function.name === 'string' ? call.function.name : '';
        toolNames.set(call.id, toolName);
        content.push({ type: 'tool-call', toolCallId: call.id, toolName, input: parseArguments(call.function.arguments) });
      }
      if (content.length > 0) prompt.push({ role: 'assistant', content });
    } else if (role === 'tool' && typeof m.tool_call_id === 'string') {
      const part: LanguageModelV4ToolResultPart = {
        type: 'tool-result',
        toolCallId: m.tool_call_id,
        toolName: toolNames.get(m.tool_call_id) ?? '',
        output: { type: 'text', value: contentText(m.content) },
      };
      const last = prompt[prompt.length - 1] as LanguageModelV4Message | undefined;
      if (last?.role === 'tool') last.content.push(part);
      else prompt.push({ role: 'tool', content: [part] });
    }
  }
  return prompt;
}

/** OpenAI function tools as V4 function tools. Entries of any other type are left out. */
function toTools(tools: unknown[]): LanguageModelV4FunctionTool[] {
  const out: LanguageModelV4FunctionTool[] = [];
  for (const t of tools) {
    if (!isRec(t) || t.type !== 'function' || !isRec(t.function) || typeof t.function.name !== 'string') continue;
    const f = t.function;
    out.push({
      type: 'function',
      name: f.name as string,
      ...(typeof f.description === 'string' ? { description: f.description } : {}),
      inputSchema: (isRec(f.parameters) ? f.parameters : { type: 'object', properties: {} }) as LanguageModelV4FunctionTool['inputSchema'],
      ...(typeof f.strict === 'boolean' ? { strict: f.strict } : {}),
    });
  }
  return out;
}

/** OpenAI's tool_choice as V4's. An unrecognised value is left out, which means `auto`. */
function toToolChoice(choice: unknown): LanguageModelV4ToolChoice | undefined {
  if (choice === 'auto' || choice === 'none' || choice === 'required') return { type: choice };
  if (isRec(choice) && choice.type === 'function' && isRec(choice.function) && typeof choice.function.name === 'string') {
    return { type: 'tool', toolName: choice.function.name };
  }
  return undefined;
}

/** OpenAI's response_format as V4's. */
function toResponseFormat(format: unknown): LanguageModelV4CallOptions['responseFormat'] {
  if (!isRec(format)) return undefined;
  if (format.type === 'json_object') return { type: 'json' };
  if (format.type === 'json_schema' && isRec(format.json_schema)) {
    const js = format.json_schema;
    return {
      type: 'json',
      ...(isRec(js.schema) ? { schema: js.schema as NonNullable<LanguageModelV4FunctionTool['inputSchema']> } : {}),
      ...(typeof js.name === 'string' ? { name: js.name } : {}),
      ...(typeof js.description === 'string' ? { description: js.description } : {}),
    };
  }
  if (format.type === 'text') return { type: 'text' };
  return undefined;
}

/** An OpenAI chat-completions body as LanguageModelV4 call options. */
export function toCallOptions(body: OpenAiChatBody, signal?: AbortSignal): LanguageModelV4CallOptions {
  const options: LanguageModelV4CallOptions = { prompt: toPrompt(Array.isArray(body.messages) ? body.messages : []) };
  const temperature = num(body.temperature);
  if (temperature !== undefined) options.temperature = temperature;
  const topP = num(body.top_p);
  if (topP !== undefined) options.topP = topP;
  const maxOutputTokens = num(body.max_completion_tokens) ?? num(body.max_tokens);
  if (maxOutputTokens !== undefined) options.maxOutputTokens = maxOutputTokens;
  const stop = typeof body.stop === 'string' ? [body.stop] : Array.isArray(body.stop) ? body.stop.filter((s) => typeof s === 'string') : [];
  if (stop.length > 0) options.stopSequences = stop;
  if (Array.isArray(body.tools)) {
    const tools = toTools(body.tools);
    if (tools.length > 0) options.tools = tools;
  }
  const toolChoice = toToolChoice(body.tool_choice);
  if (toolChoice) options.toolChoice = toolChoice;
  const responseFormat = toResponseFormat(body.response_format);
  if (responseFormat) options.responseFormat = responseFormat;
  if (signal) options.abortSignal = signal;
  return options;
}

// ─── Response: V4 result and stream to OpenAI ────────────────────────────────

/** A V4 finish reason (the `{ unified, raw }` object, or a bare unified string) as OpenAI's. */
export function mapFinishReason(reason: LanguageModelV4FinishReason | LanguageModelV4FinishReason['unified'] | undefined): string {
  const unified = typeof reason === 'string' ? reason : reason?.unified;
  switch (unified) {
    case 'length': return 'length';
    case 'content-filter': return 'content_filter';
    case 'tool-calls': return 'tool_calls';
    default: return 'stop';
  }
}

/** V4 usage (nested `{ total }` counts) as OpenAI's flat usage. A count the provider left out is 0. */
function toUsage(usage: LanguageModelV4Usage | undefined): OpenAiUsage {
  const prompt = usage?.inputTokens?.total ?? 0;
  const completion = usage?.outputTokens?.total ?? 0;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
}

/** A doGenerate result as OpenAI's `chat.completion` object. Reasoning is not part of the content. */
export function v4ResultToChatCompletion(
  result: Pick<LanguageModelV4GenerateResult, 'content' | 'finishReason' | 'usage' | 'response'>,
  meta: OpenAiChatMeta,
): OpenAiChatCompletion {
  const texts: string[] = [];
  const toolCalls: OpenAiToolCall[] = [];
  for (const part of result.content) {
    if (part.type === 'text') texts.push(part.text);
    else if (part.type === 'tool-call' && !part.providerExecuted) {
      toolCalls.push({ id: part.toolCallId, type: 'function', function: { name: part.toolName, arguments: part.input } });
    }
  }
  return {
    id: meta.id,
    object: 'chat.completion',
    created: meta.created,
    model: result.response?.modelId ?? meta.model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: texts.length > 0 ? texts.join('') : null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: mapFinishReason(result.finishReason),
    }],
    usage: toUsage(result.usage),
  };
}

/** What one stream part turns into: frames to send, and whether the stream ends after them. */
interface Step {
  frames: string[];
  end?: 'done' | 'error';
}

/**
 * The per-stream state that turns V4 stream parts into OpenAI SSE frames. Kept apart from the
 * ReadableStream plumbing so the mapping reads as one switch.
 */
function createFrameMapper(meta: OpenAiChatMeta): (part: LanguageModelV4StreamPart) => Step {
  let model = meta.model;
  let roleSent = false;
  /** Tool calls by id: their OpenAI index and the arguments sent so far. */
  const calls = new Map<string, { index: number; sent: string }>();
  /** Ids of tool calls the provider runs itself; none of their parts are forwarded. */
  const providerRun = new Set<string>();

  const sse = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`;
  const chunk = (choices: unknown[], extra: Rec = {}): string => sse({
    id: meta.id, object: 'chat.completion.chunk', created: meta.created, model, choices, ...extra,
  });
  const delta = (d: Rec, finishReason: string | null = null): string[] => {
    const frames: string[] = [];
    if (!roleSent) {
      roleSent = true;
      frames.push(chunk([{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]));
    }
    frames.push(chunk([{ index: 0, delta: d, finish_reason: finishReason }]));
    return frames;
  };
  const toolDelta = (entry: Rec): string[] => delta({ tool_calls: [entry] });

  return (part) => {
    switch (part.type) {
      case 'response-metadata':
        if (part.modelId) model = part.modelId;
        return { frames: [] };
      case 'text-delta':
        return { frames: part.delta ? delta({ content: part.delta }) : [] };
      case 'tool-input-start': {
        if (part.providerExecuted) { providerRun.add(part.id); return { frames: [] }; }
        const index = calls.size;
        calls.set(part.id, { index, sent: '' });
        return { frames: toolDelta({ index, id: part.id, type: 'function', function: { name: part.toolName, arguments: '' } }) };
      }
      case 'tool-input-delta': {
        const call = calls.get(part.id);
        if (!call || !part.delta) return { frames: [] };
        call.sent += part.delta;
        return { frames: toolDelta({ index: call.index, function: { arguments: part.delta } }) };
      }
      case 'tool-call': {
        if (part.providerExecuted || providerRun.has(part.toolCallId)) return { frames: [] };
        const call = calls.get(part.toolCallId);
        if (!call) {
          // A provider that sends only the complete call: one frame with id, name and arguments.
          const index = calls.size;
          calls.set(part.toolCallId, { index, sent: part.input });
          return { frames: toolDelta({ index, id: part.toolCallId, type: 'function', function: { name: part.toolName, arguments: part.input } }) };
        }
        // The streamed arguments may fall short of the final input (Anthropic sends no delta for
        // an empty input and then `{}`); send whatever the client has not seen yet.
        if (part.input.length > call.sent.length && part.input.startsWith(call.sent)) {
          const rest = part.input.slice(call.sent.length);
          call.sent = part.input;
          return { frames: toolDelta({ index: call.index, function: { arguments: rest } }) };
        }
        return { frames: [] };
      }
      case 'finish':
        return {
          frames: [
            ...delta({}, mapFinishReason(part.finishReason)),
            chunk([], { usage: toUsage(part.usage) }),
            'data: [DONE]\n\n',
          ],
          end: 'done',
        };
      case 'error':
        return { frames: [sse({ error: { message: errorMessage(part.error), code: 502 } })], end: 'error' };
      default:
        // stream-start, reasoning, text-start/-end, tool-input-end, sources, files, raw, tool results
        // and approval requests have no place in OpenAI's chat dialect.
        return { frames: [] };
    }
  };
}

/**
 * A V4 part stream as OpenAI chat-completions SSE bytes. The stream ends with `data: [DONE]` after
 * the finish and usage frames, or right after an error frame (no `[DONE]`, so a client can tell a
 * cut answer from a finished one). Cancelling the returned stream cancels the upstream reader, and
 * so does `signal` firing, after which the returned stream errors with the signal's reason.
 */
export function v4StreamToOpenAiSse(
  stream: ReadableStream<LanguageModelV4StreamPart>,
  meta: OpenAiChatMeta,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  const encoder = new TextEncoder();
  const map = createFrameMapper(meta);
  let finished = false;
  let onAbort: (() => void) | undefined;

  const release = (reason?: unknown): void => {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    reader.cancel(reason).catch((err: unknown) => {
      // The upstream reader is being dropped; a failure to cancel it has no caller left to tell.
      logger.debug('[ai] cancelling the upstream stream failed', { error: errorMessage(err) });
    });
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (!signal) return;
      onAbort = () => {
        if (finished) return;
        finished = true;
        controller.error(signal.reason);
        release(signal.reason);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    },
    async pull(controller) {
      while (!finished) {
        let result: Awaited<ReturnType<typeof reader.read>>;
        try {
          result = await reader.read();
        } catch (err) {
          if (finished) return;
          finished = true;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: errorMessage(err), code: 502 } })}\n\n`));
          controller.close();
          release(err);
          return;
        }
        if (finished) return;
        if (result.done) {
          // The upstream ended without a finish part: close the answer the way OpenAI would.
          finished = true;
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          if (onAbort) signal?.removeEventListener('abort', onAbort);
          return;
        }
        const step = map(result.value);
        for (const frame of step.frames) controller.enqueue(encoder.encode(frame));
        if (step.end) {
          finished = true;
          controller.close();
          release();
          return;
        }
        if (step.frames.length > 0) return;
      }
    },
    cancel(reason) {
      if (finished) return;
      finished = true;
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      return reader.cancel(reason);
    },
  });
}

/** A status a `Response` accepts and a caller reads as a failure. */
function errorStatus(status: number | undefined): number {
  return status !== undefined && Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}

/**
 * Answers an OpenAI chat-completions request with a V4 model, as the `Response` an OpenAI-dialect
 * provider would have sent. A provider error before the first byte (an `APICallError`) comes back
 * as a non-ok `Response` with the provider's status and body, so a caller's `!response.ok` code path
 * reads it; any other error is thrown.
 */
export async function openAiChatResponse(model: LanguageModelV4, body: OpenAiChatBody, signal?: AbortSignal): Promise<Response> {
  const options = toCallOptions(body, signal);
  const meta: OpenAiChatMeta = {
    id: `chatcmpl-${randomUUID().replace(/-/g, '')}`,
    created: Math.floor(Date.now() / 1000),
    model: model.modelId,
  };
  try {
    if (body.stream) {
      const { stream } = await model.doStream(options);
      return new Response(v4StreamToOpenAiSse(stream, meta, signal), {
        status: 200, headers: { 'content-type': 'text/event-stream' },
      });
    }
    const result = await model.doGenerate(options);
    return new Response(JSON.stringify(v4ResultToChatCompletion(result, meta)), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    if (!APICallError.isInstance(err)) throw err;
    return new Response(err.responseBody ?? JSON.stringify({ error: { message: err.message } }), {
      status: errorStatus(err.statusCode), headers: { 'content-type': 'application/json' },
    });
  }
}
