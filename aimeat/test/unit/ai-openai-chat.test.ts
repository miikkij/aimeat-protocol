/**
 * @file test/unit/ai-openai-chat.test.ts
 * @description The OpenAI chat-completions conversion over an AI SDK LanguageModelV4
 *   (services/ai/adapters/openai-chat.ts): an OpenAI request becomes the right V4 call options, and
 *   the V4 answer becomes the exact bytes an OpenAI-dialect provider would have sent, streamed or
 *   not, so the proxy and the voice reply stream can pass it on as they pass a raw provider answer.
 *
 *   Most cases use a fake V4 model (a plain object). The last case uses the real @ai-sdk/anthropic
 *   package over a scripted Anthropic SSE body, which is what proves that the package's stream parts
 *   and this converter agree.
 * @usage pnpm test -- ai-openai-chat
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V3 of the System 2 plan).
 */
import { describe, it, expect } from 'vitest';
import { APICallError } from '@ai-sdk/provider';
import type {
  LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4FinishReason, LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart, LanguageModelV4Usage,
} from '@ai-sdk/provider';
import { createAnthropic } from '@ai-sdk/anthropic';
import {
  toCallOptions, openAiChatResponse, v4StreamToOpenAiSse, v4ResultToChatCompletion, mapFinishReason,
} from '../../src/services/ai/adapters/openai-chat.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const usage = (input: number, output: number): LanguageModelV4Usage => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});
const reason = (unified: LanguageModelV4FinishReason['unified']): LanguageModelV4FinishReason => ({ unified, raw: unified });
const finish = (unified: LanguageModelV4FinishReason['unified'], input = 10, output = 5): LanguageModelV4StreamPart =>
  ({ type: 'finish', finishReason: reason(unified), usage: usage(input, output) });

function partStream(parts: LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({ start(c) { for (const p of parts) c.enqueue(p); c.close(); } });
}

interface FakeModel extends LanguageModelV4 { calls: LanguageModelV4CallOptions[] }

function fakeModel(behaviour: {
  parts?: LanguageModelV4StreamPart[];
  stream?: ReadableStream<LanguageModelV4StreamPart>;
  generate?: LanguageModelV4GenerateResult;
  throws?: unknown;
}): FakeModel {
  const calls: LanguageModelV4CallOptions[] = [];
  return {
    specificationVersion: 'v4',
    provider: 'fake',
    modelId: 'fake-model',
    supportedUrls: {},
    calls,
    async doGenerate(options) {
      calls.push(options);
      if (behaviour.throws) throw behaviour.throws;
      return behaviour.generate!;
    },
    async doStream(options) {
      calls.push(options);
      if (behaviour.throws) throw behaviour.throws;
      return { stream: behaviour.stream ?? partStream(behaviour.parts ?? []) };
    },
  };
}

const META = { id: 'chatcmpl-test', created: 1790000000, model: 'fake-model' };

/** The SSE payloads of a body, in order: parsed JSON, or the literal `[DONE]`. */
async function frames(body: ReadableStream<Uint8Array> | Response): Promise<Array<Record<string, any> | '[DONE]'>> {
  const text = body instanceof Response ? await body.text() : await new Response(body).text();
  return text.split('\n\n').filter(Boolean).map((block) => {
    expect(block.startsWith('data: ')).toBe(true);
    const payload = block.slice('data: '.length);
    return payload === '[DONE]' ? '[DONE]' : JSON.parse(payload);
  });
}

// ─── Request conversion ──────────────────────────────────────────────────────

describe('toCallOptions', () => {
  it('a system, user (with a data: image), assistant tool call and tool result conversation', () => {
    const options = toCallOptions({
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: [
          { type: 'text', text: 'What is in this?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
          { type: 'image_url', image_url: { url: 'https://example.com/a/photo.JPG' } },
        ] },
        { role: 'assistant', content: null, tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"q":"png"}' } },
          { id: 'call_2', type: 'function', function: { name: 'broken', arguments: '{not json' } },
        ] },
        { role: 'tool', tool_call_id: 'call_1', content: 'a PNG header' },
        { role: 'tool', tool_call_id: 'call_2', content: [{ type: 'text', text: 'nothing' }] },
        { role: 'narrator', content: 'skipped' },
      ],
    });
    expect(options.prompt).toHaveLength(4);
    expect(options.prompt[0]).toEqual({ role: 'system', content: 'Be brief.' });

    const user = options.prompt[1];
    expect(user.role).toBe('user');
    const [text, png, jpg] = user.content as any[];
    expect(text).toEqual({ type: 'text', text: 'What is in this?' });
    expect(png.type).toBe('file');
    expect(png.mediaType).toBe('image/png');
    expect(png.data.type).toBe('data');
    expect(Array.from(png.data.data as Uint8Array)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(jpg.mediaType).toBe('image/jpeg');
    expect(jpg.data.type).toBe('url');
    expect((jpg.data.url as URL).href).toBe('https://example.com/a/photo.JPG');

    expect(options.prompt[2]).toEqual({ role: 'assistant', content: [
      { type: 'tool-call', toolCallId: 'call_1', toolName: 'lookup', input: { q: 'png' } },
      { type: 'tool-call', toolCallId: 'call_2', toolName: 'broken', input: {} },
    ] });
    // Consecutive tool messages become one, and each result carries the name looked up by id.
    expect(options.prompt[3]).toEqual({ role: 'tool', content: [
      { type: 'tool-result', toolCallId: 'call_1', toolName: 'lookup', output: { type: 'text', value: 'a PNG header' } },
      { type: 'tool-result', toolCallId: 'call_2', toolName: 'broken', output: { type: 'text', value: 'nothing' } },
    ] });
  });

  it('an https image with no known extension is image/*', () => {
    const options = toCallOptions({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/img' } }] }] });
    expect((options.prompt[0].content as any[])[0].mediaType).toBe('image/*');
  });

  it('tools, sampling, token limit, stop and the abort signal', () => {
    const signal = new AbortController().signal;
    const options = toCallOptions({
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2, top_p: 0.9, max_tokens: 100, max_completion_tokens: 50, stop: 'END',
      tools: [
        { type: 'function', function: { name: 'get_weather', description: 'Weather now', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } },
        { type: 'function', function: { name: 'ping' } },
        { type: 'retrieval' },
      ],
    }, signal);
    expect(options).toEqual({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      temperature: 0.2, topP: 0.9, maxOutputTokens: 50, stopSequences: ['END'],
      tools: [
        { type: 'function', name: 'get_weather', description: 'Weather now', inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } },
        { type: 'function', name: 'ping', inputSchema: { type: 'object', properties: {} } },
      ],
      abortSignal: signal,
    });
    expect(toCallOptions({ messages: [], max_tokens: 70, stop: ['a', 'b'] })).toMatchObject({ maxOutputTokens: 70, stopSequences: ['a', 'b'] });
  });

  it('tool_choice in all four forms', () => {
    const choice = (tool_choice: unknown) => toCallOptions({ messages: [], tool_choice }).toolChoice;
    expect(choice('auto')).toEqual({ type: 'auto' });
    expect(choice('none')).toEqual({ type: 'none' });
    expect(choice('required')).toEqual({ type: 'required' });
    expect(choice({ type: 'function', function: { name: 'get_weather' } })).toEqual({ type: 'tool', toolName: 'get_weather' });
  });

  it('response_format json_object and json_schema', () => {
    expect(toCallOptions({ messages: [], response_format: { type: 'json_object' } }).responseFormat).toEqual({ type: 'json' });
    const schema = { type: 'object', properties: { n: { type: 'number' } } };
    expect(toCallOptions({ messages: [], response_format: { type: 'json_schema', json_schema: { name: 'count', description: 'A count', schema } } }).responseFormat)
      .toEqual({ type: 'json', schema, name: 'count', description: 'A count' });
  });
});

describe('mapFinishReason', () => {
  it('maps the unified reason, object or string', () => {
    expect(mapFinishReason(reason('stop'))).toBe('stop');
    expect(mapFinishReason(reason('length'))).toBe('length');
    expect(mapFinishReason(reason('content-filter'))).toBe('content_filter');
    expect(mapFinishReason('tool-calls')).toBe('tool_calls');
    expect(mapFinishReason(reason('error'))).toBe('stop');
    expect(mapFinishReason(undefined)).toBe('stop');
  });
});

// ─── Streamed answers ────────────────────────────────────────────────────────

describe('a streamed answer', () => {
  it('text only: role frame, content frames, finish, usage, [DONE], one id', async () => {
    const out = await frames(v4StreamToOpenAiSse(partStream([
      { type: 'stream-start', warnings: [] },
      { type: 'response-metadata', modelId: 'fake-model-2026' },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'Hel' },
      { type: 'reasoning-delta', id: 'r', delta: 'thinking' },
      { type: 'text-delta', id: 't', delta: 'lo' },
      { type: 'text-end', id: 't' },
      finish('stop', 12, 3),
    ]), META));
    const base = { id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1790000000, model: 'fake-model-2026' };
    expect(out).toEqual([
      { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: { content: 'Hel' }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      { ...base, choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } },
      '[DONE]',
    ]);
  });

  it('a streamed tool call: index 0, id and name first, arguments concatenating, tool_calls', async () => {
    const out = await frames(v4StreamToOpenAiSse(partStream([
      { type: 'tool-input-start', id: 'toolu_1', toolName: 'get_weather' },
      { type: 'tool-input-delta', id: 'toolu_1', delta: '{"city":' },
      { type: 'tool-input-delta', id: 'toolu_1', delta: '"Oulu"}' },
      { type: 'tool-input-end', id: 'toolu_1' },
      { type: 'tool-call', toolCallId: 'toolu_1', toolName: 'get_weather', input: '{"city":"Oulu"}' },
      finish('tool-calls'),
    ]), META)) as any[];
    expect(out[0].choices[0].delta).toEqual({ role: 'assistant', content: '' });
    expect(out[1].choices[0].delta).toEqual({ tool_calls: [{ index: 0, id: 'toolu_1', type: 'function', function: { name: 'get_weather', arguments: '' } }] });
    expect(out[2].choices[0].delta).toEqual({ tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] });
    expect(out[3].choices[0].delta).toEqual({ tool_calls: [{ index: 0, function: { arguments: '"Oulu"}' } }] });
    expect(out[4].choices[0]).toEqual({ index: 0, delta: {}, finish_reason: 'tool_calls' });
    expect(out[5].usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    expect(out[6]).toBe('[DONE]');
    expect(out).toHaveLength(7);
    const args = out.slice(1, 4).map((f) => f.choices[0].delta.tool_calls[0].function.arguments).join('');
    expect(JSON.parse(args)).toEqual({ city: 'Oulu' });
  });

  it('two tool calls get indexes 0 and 1', async () => {
    const out = await frames(v4StreamToOpenAiSse(partStream([
      { type: 'tool-input-start', id: 'a', toolName: 'one' },
      { type: 'tool-input-delta', id: 'a', delta: '{}' },
      { type: 'tool-input-start', id: 'b', toolName: 'two' },
      { type: 'tool-input-delta', id: 'b', delta: '{"x":1}' },
      { type: 'tool-call', toolCallId: 'a', toolName: 'one', input: '{}' },
      { type: 'tool-call', toolCallId: 'b', toolName: 'two', input: '{"x":1}' },
      finish('tool-calls'),
    ]), META)) as any[];
    const calls = out.flatMap((f) => (f === '[DONE]' ? [] : f.choices[0]?.delta?.tool_calls ?? []));
    expect(calls).toEqual([
      { index: 0, id: 'a', type: 'function', function: { name: 'one', arguments: '' } },
      { index: 0, function: { arguments: '{}' } },
      { index: 1, id: 'b', type: 'function', function: { name: 'two', arguments: '' } },
      { index: 1, function: { arguments: '{"x":1}' } },
    ]);
  });

  it('a complete tool-call with no input-start is one frame with the whole arguments', async () => {
    const out = await frames(v4StreamToOpenAiSse(partStream([
      { type: 'tool-call', toolCallId: 'call_9', toolName: 'lookup', input: '{"q":"x"}' },
      finish('tool-calls'),
    ]), META)) as any[];
    expect(out[1].choices[0].delta).toEqual({
      tool_calls: [{ index: 0, id: 'call_9', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }],
    });
    expect(out[2].choices[0].finish_reason).toBe('tool_calls');
  });

  it('a started call whose input arrived only in tool-call sends the missing arguments', async () => {
    const out = await frames(v4StreamToOpenAiSse(partStream([
      { type: 'tool-input-start', id: 'e', toolName: 'noargs' },
      { type: 'tool-input-end', id: 'e' },
      { type: 'tool-call', toolCallId: 'e', toolName: 'noargs', input: '{}' },
      finish('tool-calls'),
    ]), META)) as any[];
    expect(out[2].choices[0].delta).toEqual({ tool_calls: [{ index: 0, function: { arguments: '{}' } }] });
  });

  it('a provider-executed tool call is not forwarded', async () => {
    const out = await frames(v4StreamToOpenAiSse(partStream([
      { type: 'tool-input-start', id: 's', toolName: 'web_search', providerExecuted: true },
      { type: 'tool-input-delta', id: 's', delta: '{"query":"x"}' },
      { type: 'tool-call', toolCallId: 's', toolName: 'web_search', input: '{"query":"x"}', providerExecuted: true },
      { type: 'text-delta', id: 't', delta: 'done' },
      finish('stop'),
    ]), META)) as any[];
    expect(out.some((f) => f !== '[DONE]' && f.choices[0]?.delta?.tool_calls)).toBe(false);
    expect(out[1].choices[0].delta).toEqual({ content: 'done' });
  });

  it('an error part is one error frame and no [DONE]', async () => {
    const out = await frames(v4StreamToOpenAiSse(partStream([
      { type: 'text-delta', id: 't', delta: 'par' },
      { type: 'error', error: new Error('overloaded') },
      { type: 'text-delta', id: 't', delta: 'never' },
    ]), META));
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ error: { message: 'overloaded', code: 502 } });
    expect(out).not.toContain('[DONE]');
  });

  it('cancelling the Response body cancels the upstream stream', async () => {
    let cancelled: unknown = 'not cancelled';
    let n = 0;
    const upstream = new ReadableStream<LanguageModelV4StreamPart>({
      pull(c) { c.enqueue({ type: 'text-delta', id: 't', delta: `w${n++} ` }); },
      cancel(r) { cancelled = r; },
    });
    const response = await openAiChatResponse(fakeModel({ stream: upstream }), { messages: [{ role: 'user', content: 'hi' }], stream: true });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel('client went away');
    expect(cancelled).toBe('client went away');
  });

  it('the abort signal cancels the upstream stream', async () => {
    let cancelled = false;
    const upstream = new ReadableStream<LanguageModelV4StreamPart>({
      pull(c) { c.enqueue({ type: 'text-delta', id: 't', delta: 'x' }); },
      cancel() { cancelled = true; },
    });
    const ac = new AbortController();
    const model = fakeModel({ stream: upstream });
    const response = await openAiChatResponse(model, { messages: [{ role: 'user', content: 'hi' }], stream: true }, ac.signal);
    expect(model.calls[0].abortSignal).toBe(ac.signal);
    const reader = response.body!.getReader();
    await reader.read();
    ac.abort(new Error('stop'));
    await expect(reader.read()).rejects.toThrow('stop');
    expect(cancelled).toBe(true);
  });
});

// ─── Non-streamed answers and errors ─────────────────────────────────────────

describe('a non-streamed answer', () => {
  const result: LanguageModelV4GenerateResult = {
    content: [
      { type: 'reasoning', text: 'hidden' },
      { type: 'text', text: 'Checking.' },
      { type: 'tool-call', toolCallId: 'call_1', toolName: 'get_weather', input: '{"city":"Oulu"}' },
    ],
    finishReason: reason('tool-calls'),
    usage: usage(20, 8),
    response: { modelId: 'fake-model-2026' },
    warnings: [],
  };

  it('becomes a chat.completion with tool_calls, finish_reason and usage', () => {
    expect(v4ResultToChatCompletion(result, META)).toEqual({
      id: 'chatcmpl-test', object: 'chat.completion', created: 1790000000, model: 'fake-model-2026',
      choices: [{
        index: 0,
        message: {
          role: 'assistant', content: 'Checking.',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Oulu"}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    });
  });

  it('through openAiChatResponse: a 200 JSON Response with a chatcmpl- id', async () => {
    const response = await openAiChatResponse(fakeModel({ generate: { ...result, content: [{ type: 'tool-call', toolCallId: 'c', toolName: 't', input: '{}' }] } }), { messages: [{ role: 'user', content: 'hi' }] });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    const body = await response.json() as any;
    expect(body.id).toMatch(/^chatcmpl-[0-9a-f]{32}$/);
    expect(body.choices[0].message.content).toBeNull();
    expect(body.choices[0].message.tool_calls).toHaveLength(1);
  });

  it('an APICallError before the first byte is a Response with its status and body', async () => {
    const err = new APICallError({ message: 'rate limited', url: 'http://stub.invalid/v1/messages', requestBodyValues: {}, statusCode: 429, responseBody: '{"error":"x"}' });
    const response = await openAiChatResponse(fakeModel({ throws: err }), { messages: [{ role: 'user', content: 'hi' }], stream: true });
    expect(response.ok).toBe(false);
    expect(response.status).toBe(429);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.text()).toBe('{"error":"x"}');
  });

  it('any other error is thrown', async () => {
    await expect(openAiChatResponse(fakeModel({ throws: new TypeError('bug') }), { messages: [] })).rejects.toThrow('bug');
  });
});

// ─── The real Anthropic package ──────────────────────────────────────────────

describe('with the real @ai-sdk/anthropic package', () => {
  it('a scripted Anthropic tool_use stream becomes OpenAI tool_calls frames', async () => {
    const events: Array<[string, unknown]> = [
      ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-test-20260901', content: [], stop_reason: null, usage: { input_tokens: 21, output_tokens: 1 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_01', name: 'get_weather', input: {} } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"city":' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"Oulu"}' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 9 } }],
      ['message_stop', { type: 'message_stop' }],
    ];
    const sse = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
    const requests: Array<{ url: string; body: any }> = [];
    const fetchStub = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const model = createAnthropic({ apiKey: 'test', baseURL: 'http://stub.invalid/v1', fetch: fetchStub as typeof fetch }).languageModel('claude-test');

    const response = await openAiChatResponse(model, {
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'get_weather', description: 'Weather now', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }],
      stream: true,
    });

    expect(requests[0].url).toBe('http://stub.invalid/v1/messages');
    expect(requests[0].body).toMatchObject({
      model: 'claude-test', stream: true,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      tools: [{ name: 'get_weather', description: 'Weather now', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }],
    });

    const out = await frames(response) as any[];
    const chunks = out.filter((f) => f !== '[DONE]');
    expect(new Set(chunks.map((f) => f.id)).size).toBe(1);
    expect(chunks.every((f) => f.model === 'claude-test-20260901')).toBe(true);
    expect(chunks.map((f) => f.choices[0]?.delta ?? null)).toEqual([
      { role: 'assistant', content: '' },
      { tool_calls: [{ index: 0, id: 'toolu_01', type: 'function', function: { name: 'get_weather', arguments: '' } }] },
      { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] },
      { tool_calls: [{ index: 0, function: { arguments: '"Oulu"}' } }] },
      {},
      null,
    ]);
    expect(chunks[4].choices[0].finish_reason).toBe('tool_calls');
    expect(chunks[5].usage).toEqual({ prompt_tokens: 21, completion_tokens: 9, total_tokens: 30 });
    expect(out[out.length - 1]).toBe('[DONE]');
  });
});
