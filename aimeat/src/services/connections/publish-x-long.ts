/**
 * @file publish-x-long.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two long forms on X, beside the single post in publish.ts (2026-10-15):
 *   - an ARTICLE (`params.format: 'article'`): X's long-form post with a title, made as a draft by
 *     POST /2/articles/draft and published by POST /2/articles/{id}/publish. The body is the caption,
 *     turned into DraftJS blocks: `# ` and `## ` lines are headings, `- ` lines are a bulleted list,
 *     `1. ` lines a numbered one, everything else a paragraph. X lets a Premium account write
 *     Articles; another account is refused by X, and its answer is shown as it came.
 *   - a THREAD (`params.format: 'thread'`): the caption split at lines holding only `---`, or
 *     `params.parts` when given, each part posted as a reply to the one before.
 *
 *   A THREAD THAT BREAKS HALF WAY IS A PERMANENT FAILURE. Its first parts are already public; a
 *   retry would post them a second time. The reason names how many went out and where, so the
 *   person finishes it by hand. Every part is a charge on pay-per-use, which is the other reason not
 *   to retry.
 * @structure xLongForm · toDraftBlocks · splitThread
 * @usage if (format === 'article' || format === 'thread') return xLongForm(input, format);
 * @version-history
 *   v1.0.0 — 2026-10-15 — Articles and threads.
 */

import { safeFetch } from '../../utils/url-validator.js';
import { readJson, readText } from '../../utils/read-capped.js';
import { logger } from '../../utils/logger.js';
import type { PublishInput, PublishOutcome } from './publish-types.js';

/** A provider's answer here is a few kilobytes; a reply list is the largest, well under this (C6). */
const ANSWER_MAX_BYTES = 4 * 1024 * 1024;

const X_API = 'https://api.x.com/2';
const POST_MAX = 280;

/** One DraftJS block, in the shape X's Articles API takes. */
interface DraftBlock { text: string; type: string }

/** The caption as DraftJS blocks. Blank lines separate paragraphs and produce no block. */
export function toDraftBlocks(text: string): DraftBlock[] {
  const blocks: DraftBlock[] = [];
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    let m: RegExpExecArray | null;
    if ((m = /^##\s+(.*)$/.exec(line))) blocks.push({ text: m[1]!, type: 'header-two' });
    else if ((m = /^#\s+(.*)$/.exec(line))) blocks.push({ text: m[1]!, type: 'header-one' });
    else if ((m = /^[-*]\s+(.*)$/.exec(line))) blocks.push({ text: m[1]!, type: 'unordered-list-item' });
    else if ((m = /^\d+[.)]\s+(.*)$/.exec(line))) blocks.push({ text: m[1]!, type: 'ordered-list-item' });
    else blocks.push({ text: line, type: 'unstyled' });
  }
  return blocks;
}

/** The parts of a thread: `params.parts` when given, else the caption split at `---` lines. */
export function splitThread(caption: string, params: Record<string, unknown>): string[] {
  const given = Array.isArray(params.parts) ? params.parts.filter((p): p is string => typeof p === 'string') : [];
  const parts = given.length ? given : caption.split(/\n\s*---\s*\n/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

async function said(res: Response): Promise<string> {
  try {
    const t = await readText(res, ANSWER_MAX_BYTES);
    return t.slice(0, 300).replace(/\s+/g, ' ').trim();
  } catch (err) {
    logger.warn('connections: an X refusal carried no readable body', { status: res.status, error: String(err) });
    return '';
  }
}

/** The outcome of an X refusal, by the same rules as the single post. */
async function refusal(res: Response, what: string): Promise<PublishOutcome> {
  if (res.status === 401) return { ok: false, permanent: true, reason: 'X no longer accepts this token; the connection needs reconnecting' };
  if (res.status === 402) return { ok: false, permanent: false, reason: 'X declined for billing: the prepaid credit balance is spent' };
  if (res.status === 429) return { ok: false, permanent: false, reason: 'X is rate limiting this app; try later' };
  return { ok: false, permanent: res.status < 500, reason: `${what} (HTTP ${res.status}): ${await said(res)}` };
}

export async function xLongForm(input: PublishInput, format: 'article' | 'thread'): Promise<PublishOutcome> {
  const { credential, connection, caption, params } = input;
  const headers = { Authorization: `Bearer ${credential.accessToken}`, 'Content-Type': 'application/json' };
  const handle = (connection.accountLabel || '').replace(/^@/, '') || 'i';
  if (input.file) {
    return { ok: false, permanent: true, reason: `an X ${format} is sent as text through this connection; the attached file is not sent` };
  }

  if (format === 'article') {
    const title = typeof params.title === 'string' ? params.title.trim() : '';
    if (!title) return { ok: false, permanent: true, reason: 'an X article needs a title (params.title)' };
    const blocks = toDraftBlocks(caption);
    if (!blocks.length) return { ok: false, permanent: true, reason: 'an X article needs a body' };
    try {
      const draft = await safeFetch(`${X_API}/articles/draft`, {
        method: 'POST', headers,
        body: JSON.stringify({ title, content_state: { blocks, entities: [] } }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!draft.ok) return refusal(draft, 'X would not make the article draft');
      const dj = await readJson(draft, ANSWER_MAX_BYTES) as { data?: { id?: unknown } };
      const id = typeof dj.data?.id === 'string' ? dj.data.id : '';
      if (!id) return { ok: false, permanent: false, reason: 'X made no article draft' };
      const pub = await safeFetch(`${X_API}/articles/${encodeURIComponent(id)}/publish`, {
        method: 'POST', headers: { Authorization: headers.Authorization }, signal: AbortSignal.timeout(60_000),
      });
      // The draft exists at X now; a failed publish leaves it in the account's drafts, and saying
      // so tells the person where to finish it.
      if (!pub.ok) {
        const out = await refusal(pub, 'X kept the article as a draft and would not publish it');
        return out;
      }
      const pj = await readJson(pub, ANSWER_MAX_BYTES) as { data?: { post_id?: unknown } };
      const postId = typeof pj.data?.post_id === 'string' ? pj.data.post_id : '';
      return { ok: true, externalRef: postId ? `https://x.com/${handle}/status/${postId}` : '' };
    } catch (err) {
      return { ok: false, permanent: false, reason: `could not reach X: ${(err as Error).message}` };
    }
  }

  const parts = splitThread(caption, params);
  if (!parts.length) return { ok: false, permanent: true, reason: 'X will not accept an empty thread' };
  const long = parts.findIndex((p) => [...p].length > POST_MAX);
  if (long >= 0) {
    return { ok: false, permanent: true, reason: `part ${long + 1} of the thread is over ${POST_MAX} characters` };
  }
  let firstId = '';
  let previous = '';
  for (let i = 0; i < parts.length; i++) {
    try {
      const res = await safeFetch(`${X_API}/tweets`, {
        method: 'POST', headers,
        body: JSON.stringify({ text: parts[i], ...(previous ? { reply: { in_reply_to_tweet_id: previous } } : {}) }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const out = await refusal(res, `X refused part ${i + 1} of ${parts.length}`);
        if (i === 0 || out.ok) return out;
        return { ok: false, permanent: true, reason: `${out.reason}. Parts 1-${i} are public from https://x.com/${handle}/status/${firstId}; finish the thread there, a retry would post them again.` };
      }
      const j = await readJson(res, ANSWER_MAX_BYTES) as { data?: { id?: unknown } };
      const id = typeof j.data?.id === 'string' ? j.data.id : '';
      if (!id) {
        return { ok: false, permanent: true, reason: `X posted part ${i + 1} and named no id, so the thread could not continue` };
      }
      if (!firstId) firstId = id;
      previous = id;
    } catch (err) {
      if (i === 0) return { ok: false, permanent: false, reason: `could not reach X: ${(err as Error).message}` };
      return { ok: false, permanent: true, reason: `X stopped answering after part ${i} of ${parts.length}; the thread starts at https://x.com/${handle}/status/${firstId}` };
    }
  }
  return { ok: true, externalRef: `https://x.com/${handle}/status/${firstId}` };
}
