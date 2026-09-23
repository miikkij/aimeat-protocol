/**
 * @file page-body-live.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The part of a public page's server-rendered body that comes from live data: the
 *   apps published here, the change log, the members, the help page's questions. It is appended to
 *   the page's authored registry text (utils/page-body.ts), so a reader that does not run
 *   JavaScript gets what the page actually shows rather than a two-paragraph summary of it.
 *
 *   Measured 2026-09-23 with Bingbot's user agent: the SPA pages answered 81 kB of HTML carrying
 *   100 to 230 words of text, and Bing had the front page at "Discovered but not crawled" with the
 *   recommendation "too many pages with insufficient content". Bing renders JavaScript only in
 *   part and says so; it asks for the content in the HTML as sent.
 *
 *   SAME CONTENT, NOT A SECOND DOCUMENT. Everything here is on the page a person sees once the view
 *   draws, and the SPA removes this block at that moment (public/spa.html), exactly as it removes
 *   the authored text. Nothing is shown to a crawler that a visitor cannot see, and nothing
 *   switches on the user agent.
 *
 *   OWNERSHIP DECIDES WHO IS NAMED. An app appears only when its owner asked for it to be findable
 *   in a search engine (appSeoIndexable), and a member only when their portfolio says the same
 *   (listSearchableMembers). This block exists for search engines, so it follows the switch that
 *   answers "may a search engine list this", not the one that answers "is it published".
 *
 *   Owner-written text (app names, descriptions, bios) goes through mdText(), which folds it onto one
 *   line and drops the characters the markdown subset reacts to. The renderer escapes everything
 *   anyway; this only keeps someone's asterisks from becoming somebody else's bold.
 *
 * @structure
 *   - mdText(s, max)            — owner text made safe for one markdown line
 *   - livePageMarkdown(path, …) — the markdown to append for a path, or undefined
 * @usage
 *   const live = await livePageMarkdown('/', config, storage);
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial: front page, app store, change log, members, help.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { appSeoIndexable } from './app-seo.js';
import { listSearchableMembers } from './portfolio-members.js';
import { createT } from '../i18n.js';
import { logger } from '../utils/logger.js';

/** Owner text on one markdown line: whitespace folded, markdown syntax dropped, length capped. */
export function mdText(s: unknown, max = 300): string {
  const flat = String(s ?? '').replace(/[`*[\]<>\\]/g, '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

interface ChangelogEntry {
  date: string;
  kind?: string;
  title: Record<string, string>;
  body?: Record<string, string>;
}

const here = dirname(fileURLToPath(import.meta.url));

/** The change log ships with the build and does not change while the process runs: read once. */
let changelog: ChangelogEntry[] | null = null;
function readChangelog(): ChangelogEntry[] {
  if (changelog) return changelog;
  changelog = [];
  for (const p of [join(here, '..', '..', 'public', 'changelog.json'), join(here, '..', '..', '..', 'public', 'changelog.json')]) {
    if (!existsSync(p)) continue;
    const parsed = JSON.parse(readFileSync(p, 'utf-8')) as { entries?: ChangelogEntry[] };
    changelog = Array.isArray(parsed.entries) ? parsed.entries : [];
    break;
  }
  return changelog;
}

/** The apps a search engine may list, newest first. */
async function searchableApps(config: AimeatConfig, storage: Storage, limit: number) {
  const { apps } = await storage.listApps({ limit: 1000, sort: 'newest' });
  return apps.filter(a => appSeoIndexable(a, config)).slice(0, limit);
}

function appLines(config: AimeatConfig, apps: Awaited<ReturnType<typeof searchableApps>>): string[] {
  const b = config.baseUrl.replace(/\/$/, '');
  return apps.map(a => {
    const m = a.manifest ?? ({} as typeof a.manifest);
    const name = mdText(m.name || a.filename, 80);
    const by = mdText(m.authorDisplay || a.ownerName, 60);
    const desc = mdText(m.description, 300);
    const href = `${b}/v1/apps/${encodeURIComponent(a.ownerName)}/${encodeURIComponent(a.filename)}?mode=inline`;
    return `- [${name}](${href}), by ${by}${desc ? `: ${desc}` : ''}`;
  });
}

function changelogLines(entries: ChangelogEntry[], withBody: boolean): string[] {
  const out: string[] = [];
  for (const e of entries) {
    const title = mdText(e.title?.en, 200);
    if (!title) continue;
    if (!withBody) { out.push(`- ${e.date}: ${title}`); continue; }
    out.push(`### ${e.date}: ${title}`, '', mdText(e.body?.en, 1500), '');
  }
  return out;
}

async function build(path: string, config: AimeatConfig, storage: Storage): Promise<string | undefined> {
  const b = config.baseUrl.replace(/\/$/, '');
  switch (path) {
    case '/': {
      const apps = await searchableApps(config, storage, 24);
      const log = readChangelog().slice(0, 5);
      const parts: string[] = [];
      if (apps.length) {
        parts.push('## Applications people built here', '',
          'Each one was made by a person describing it to their own AI. Open any of them without an account.', '',
          ...appLines(config, apps), '', `[Every application in the store](${b}/v1/app-store)`, '');
      }
      if (log.length) {
        parts.push('## What changed recently', '', ...changelogLines(log, false), '',
          `[The whole change log](${b}/v1/changelog)`, '');
      }
      return parts.length ? parts.join('\n') : undefined;
    }
    case '/v1/app-store': {
      const apps = await searchableApps(config, storage, 500);
      if (!apps.length) return undefined;
      return ['## The applications', '', ...appLines(config, apps), ''].join('\n');
    }
    case '/v1/changelog': {
      const log = readChangelog();
      if (!log.length) return undefined;
      return ['## Every change, newest first', '', ...changelogLines(log, true)].join('\n');
    }
    case '/v1/members': {
      const members = await listSearchableMembers(storage, config);
      if (!members.length) return undefined;
      return ['## Members', '', ...members.map(m => {
        const name = mdText(m.display_name || m.username, 80);
        const bio = mdText(m.bio, 300);
        return `- [${name}](${b}/v1/portfolio/${encodeURIComponent(m.username)})${bio ? `: ${bio}` : ''}`;
      }), ''].join('\n');
    }
    case '/v1/help': {
      // The questions the help page answers, in its own words and order (public/views/help.js).
      const t = createT('en');
      const qs = ['cost', 'privacy', 'agent', 'organism', 'connect', 'broken'];
      const lines = ['## ' + t('help.startTitle'), '',
        `1. ${t('help.start1')}`, `2. ${t('help.start2')}`, `3. ${t('help.start3')}`, '',
        '## ' + t('help.qTitle'), ''];
      for (const q of qs) {
        const question = t(`help.q.${q}.q`);
        const answer = t(`help.q.${q}.a`);
        if (question === `help.q.${q}.q` || answer === `help.q.${q}.a`) continue;
        lines.push(`### ${question}`, '', answer, '');
      }
      return lines.join('\n');
    }
    default:
      return undefined;
  }
}

/**
 * The live markdown to append to a page's authored body, or undefined when the page has none.
 * A failure here is logged and answered with undefined: the page is still served with its authored
 * text, which is what it had before this existed.
 *
 * Not cached per path. An owner who turns search visibility off expects their app gone from the
 * next page anyone loads, and the app list is one query the wall on the same page makes anyway.
 */
export async function livePageMarkdown(path: string, config: AimeatConfig, storage: Storage): Promise<string | undefined> {
  try {
    return await build(path, config, storage);
  } catch (err) {
    logger.warn('page-body-live: could not build the live page body', { path, error: String(err) });
    return undefined;
  }
}
