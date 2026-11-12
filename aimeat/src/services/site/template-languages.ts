/**
 * @file src/services/site/template-languages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The languages of the operator's front page template. The operator stores a default
 *   page and, beside it, one whole page per language (services/site.ts). This file holds the
 *   decisions that need no storage: which language code a value names, which language a document
 *   says it is in, which stored page a reader gets, and the address of each page.
 *
 *   ONE PAGE PER LANGUAGE, ONE ADDRESS PER PAGE. The default page is served at `/` and a language
 *   version at `/?lang=<code>`. A request to `/` with no `?lang` gets the page that fits the reader,
 *   and its canonical link names the address of the page it carries, so a search engine files each
 *   language under one address and finds the others through the hreflang links.
 *
 * @structure
 *   - templateLanguage(value): a two-letter language code, or undefined
 *   - documentLanguage(html): the language the document's <html lang> states
 *   - pickTemplateVersion(versions, reader): the language version a reader gets, undefined = the default page
 *   - templateAddress(baseUrl, version): the canonical address of the default page or a language version
 *   - templateAlternates(baseUrl, versions): the hreflang set, empty when the page has one language
 * @usage
 *   const version = pickTemplateVersion(versions, { lang: req.query.lang, cookie, acceptLanguage });
 *   const links = templateAlternates(config.baseUrl, versions);
 * @version-history
 *   v1.0.0 — 2026-11-12 — Initial. A template that held three languages in one document had one h1
 *     per language and no address per language.
 */
import { DEFAULT_LOCALE } from '../../i18n.js';

/** The stored pages of a custom front page: the default page's own language, and the language versions. */
export interface TemplateVersions {
  /** The language the default page states in `<html lang>`, when it states one. */
  defaultLang?: string;
  /** The language versions stored beside the default page, sorted. */
  languages: string[];
}

/** What a request says about the reader's language. */
export interface TemplateReader {
  /** The `?lang=` value as it arrived. */
  lang?: unknown;
  cookie?: string;
  acceptLanguage?: string;
}

/** A two-letter language code from `fi`, `FI` or `fi-FI`; undefined for anything else. */
export function templateLanguage(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 35) return undefined;
  const primary = value.trim().toLowerCase().split('-')[0] ?? '';
  return /^[a-z]{2}$/.test(primary) ? primary : undefined;
}

/** The language a document states in its `<html lang="…">` tag, as a two-letter code. */
export function documentLanguage(html: string): string | undefined {
  const tag = html.slice(0, 4096).match(/<html\b[^>]{0,1024}>/i)?.[0];
  if (!tag) return undefined;
  const value = tag.match(/\slang\s*=\s*(?:"([^"]{0,35})"|'([^']{0,35})'|([^\s"'>]{1,35}))/i);
  return templateLanguage(value?.[1] ?? value?.[2] ?? value?.[3]);
}

/** The language a person picked on this device: `aimeat-lang` with the mark `aimeat-lang-chosen=1`. */
function pickedLanguage(cookie: string | undefined): string | undefined {
  if (!cookie || !/(?:^|;\s*)aimeat-lang-chosen=1(?:;|$)/.test(cookie)) return undefined;
  return cookie.match(/(?:^|;\s*)aimeat-lang=([a-z]{2})(?:;|$)/)?.[1];
}

/** The languages a browser lists, in its order, without the ones it refuses (q=0). */
function listedLanguages(acceptLanguage: string | undefined): string[] {
  const out: string[] = [];
  for (const entry of (acceptLanguage ?? '').slice(0, 1024).split(',')) {
    const [tag, ...params] = entry.trim().split(';');
    if (params.some((p) => /^\s*q\s*=\s*0(?:\.0*)?\s*$/i.test(p))) continue;
    const lang = templateLanguage(tag);
    if (lang && !out.includes(lang)) out.push(lang);
  }
  return out;
}

/**
 * The language version a reader gets; undefined means the default page.
 *
 * The order is the one the static front pages use (routes/bootstrap.ts): `?lang` first, so a page's
 * own language links work; then the language picked on this device; then the browser's list. In the
 * list, the default page's language wins wherever it stands, because many browsers list English
 * first for a person who reads the node's own language (Jouni, 2.11.2026). A reader none of whose
 * languages has a page gets the English version when there is one, and the default page otherwise.
 * A request that names no language at all (most crawlers) gets the default page.
 */
export function pickTemplateVersion(versions: TemplateVersions, reader: TemplateReader): string | undefined {
  const has = (lang: string | undefined): lang is string => !!lang && versions.languages.includes(lang);

  if (typeof reader.lang === 'string' && reader.lang !== '') {
    const asked = templateLanguage(reader.lang);
    return has(asked) ? asked : undefined;
  }

  const picked = pickedLanguage(reader.cookie);
  if (has(picked)) return picked;
  if (picked && picked === versions.defaultLang) return undefined;

  const listed = listedLanguages(reader.acceptLanguage);
  if (listed.length === 0) return undefined;
  if (versions.defaultLang && listed.includes(versions.defaultLang)) {
    return has(versions.defaultLang) ? versions.defaultLang : undefined;
  }
  const first = listed.find((lang) => has(lang));
  if (first) return first;
  return has(DEFAULT_LOCALE) ? DEFAULT_LOCALE : undefined;
}

/** The canonical address of the default page (`version` undefined) or of a language version. */
export function templateAddress(baseUrl: string, version: string | undefined): string {
  const base = baseUrl.replace(/\/+$/, '');
  return version ? `${base}/?lang=${version}` : `${base}/`;
}

/**
 * The hreflang set of a front page that has language versions: one link per language version, the
 * default page under its own language when no version covers that language, and `x-default` for
 * the address that picks by reader. Empty when there is no language version, because a page in one
 * language has no alternate to name.
 */
export function templateAlternates(baseUrl: string, versions: TemplateVersions): Array<{ hreflang: string; href: string }> {
  if (versions.languages.length === 0) return [];
  const links = versions.languages.map((lang) => ({ hreflang: lang, href: templateAddress(baseUrl, lang) }));
  if (versions.defaultLang && !versions.languages.includes(versions.defaultLang)) {
    links.push({ hreflang: versions.defaultLang, href: templateAddress(baseUrl, undefined) });
  }
  links.sort((a, b) => a.hreflang.localeCompare(b.hreflang));
  links.push({ hreflang: 'x-default', href: templateAddress(baseUrl, undefined) });
  return links;
}
