/**
 * @file src/services/knowledge-overview.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one read behind the operator's Knowledge page: the packages on this node, the
 *   SHAPE of the collection, and whether anybody has already looked at each one.
 *
 *   WHY THE SHAPE IS PART OF THE READ. An operator's first question is not "which one do I open"
 *   but "what am I even looking at". A wall of cards cannot answer that: by author, by kind and by
 *   how finished are three facts about the whole collection, and every one of them is a count the
 *   server already holds. On the node this was written against, that answer is "one person's bulk
 *   import from two days in August, plus six things somebody actually wrote", and no surface said
 *   it.
 *
 *   THE TWO DEFECTS THE FACETS EXPOSE, neither of them invented here:
 *     - The author is a STRING the writer supplies (packages-core.ts defaults it only when absent),
 *       and this node produces two spellings of the same person: the agent path writes the full
 *       GHII and the operator import route writes the bare owner name. The admin list's `author`
 *       filter is an exact match, so filtering by author splits one person in half. `authors`
 *       collapses them and names the spellings rather than silently picking one.
 *     - `maturity` is declared as 'draft' | 'review' | 'published' and the live data carries
 *       'stable' on most packages. Nothing validates it on the way in. `declared: false` marks a
 *       value the node does not define, so a surface can say so instead of printing it as if it
 *       were one of ours. NOT refused here: forty-one packages already carry it, and refusing a
 *       value in use is a decision with a migration behind it, not a tidy-up.
 *
 *   THE REVIEW TRAIL IS READ. `listReviews` is per package, so it is fetched for the PAGE the
 *   caller asked for and no further — twenty indexed reads, against a node-wide scan the delete
 *   path already does. Without it the page could not say that somebody had already looked, which
 *   is the whole point of recording a review.
 * @structure
 *   - KnowledgeFilters / KnowledgeOverview
 *   - buildKnowledgeOverview(config, storage, operatorGaii, filters)
 * @usage
 *   import { buildKnowledgeOverview } from '../services/knowledge-overview.js';
 * @version-history
 *   v1.1.0 — 2026-09-12 — A page or a limit that is not a number falls back instead of becoming
 *     NaN. `?page=abc` had been answering with an empty array and paging numbers that serialise as
 *     null, which is the same silence this read was written to end.
 *   v1.0.0 — 2026-09-12 — Initial, with the Knowledge page's rebuild.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, KnowledgeManifest, OperatorReviewRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/** The maturity words this node actually defines. Anything else is reported, never silently kept. */
export const DECLARED_MATURITY = ['draft', 'review', 'published'] as const;

/** The page size the route has always used, and its ceiling. */
export const DEFAULT_PER_PAGE = 20;
export const MAX_PER_PAGE = 50;

export interface KnowledgeFilters {
  page?: number;
  perPage?: number;
  /** Only packages somebody has reported. */
  flagged?: boolean;
  /** Exact author string, as stored. Prefer `authorKey`, which collapses the spellings. */
  author?: string;
  /** An author collapsed across its spellings — the bare name before any `@node`. */
  authorKey?: string;
  contentType?: string;
  /** Free text over name, author and tags. */
  q?: string;
}

interface Row {
  key: string;
  value: KnowledgeManifest;
  ownerGaii: string;
  visibility: string;
  flagCount: number;
  createdAt: string;
  updatedAt: string;
  isSystem: boolean;
}

/**
 * The name before the node, lowercased. `alice@node-id` and `alice` are one person, and this node
 * writes both forms itself, so a surface that treats them as two is wrong about its own data.
 */
export function authorKeyOf(author: string | undefined): string {
  return String(author ?? '').trim().toLowerCase().split('@')[0] || '(unnamed)';
}

/** Count into a map, then hand back the biggest first. */
function tally<T>(rows: T[], of: (r: T) => string): Array<{ name: string; packages: number }> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = of(r);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([name, packages]) => ({ name, packages }))
    .sort((a, b) => b.packages - a.packages);
}

/** Gather every knowledge manifest on the node: the agents' and the operator's own. */
async function allManifests(storage: Storage, operatorGaii: string): Promise<Row[]> {
  const seen = new Set<string>();
  const out: Row[] = [];
  const take = (m: {
    key: string; value: unknown; ownerGaii: string; visibility: string;
    flagCount?: number; createdAt: string; updatedAt: string; tags?: string[];
  }, forceSystem: boolean) => {
    if (!m.key.endsWith('/manifest')) return;
    if ((m.value as { type?: string })?.type !== 'knowledge-package') return;
    if (seen.has(m.key)) return;
    seen.add(m.key);
    out.push({
      key: m.key,
      value: m.value as KnowledgeManifest,
      ownerGaii: m.ownerGaii,
      visibility: m.visibility,
      flagCount: m.flagCount ?? 0,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      isSystem: forceSystem || (m.tags || []).includes('system-knowledge'),
    });
  };

  const agents = await storage.listAgents();
  const fromAgents = await storage.listMemoryForOwners(agents.map(a => a.gaii), {
    prefix: 'packages/', tags: ['knowledge-package'],
  });
  for (const m of fromAgents) take(m, false);

  const fromOperator = await storage.listMemory(operatorGaii, {
    prefix: 'packages/', tags: ['knowledge-package'],
  });
  for (const m of fromOperator) take(m, true);

  return out;
}

export interface KnowledgeOverview extends Record<string, unknown> {
  packages: Array<Record<string, unknown>>;
}

/**
 * Everything the Knowledge page shows, in one read.
 *
 * The facets are computed over EVERYTHING that matches the filters, not over the page — a shape
 * drawn from twenty of forty-seven is not the shape of the collection.
 */
export async function buildKnowledgeOverview(
  config: AimeatConfig,
  storage: Storage,
  operatorGaii: string,
  filters: KnowledgeFilters = {},
): Promise<KnowledgeOverview> {
  void config;
  const all = await allManifests(storage, operatorGaii);

  // ── Filters ──
  //
  // A FACET DOES NOT NARROW ITS OWN COUNTS. Applied to everything, choosing `dataset` leaves one
  // kind standing and the others vanish from the chip row, so a reader cannot move sideways from
  // one kind to the next — only off and back on. Each facet is therefore counted over the set
  // narrowed by every filter EXCEPT its own, which is what makes the alternatives stay visible
  // with the counts they would give.
  const q = (filters.q ?? '').trim().toLowerCase();
  const narrow = (rows: Row[], skip?: 'kind' | 'author') => {
    let out = rows;
    if (filters.flagged) out = out.filter(m => m.flagCount > 0);
    if (skip !== 'author') {
      if (filters.author) out = out.filter(m => m.value.author === filters.author);
      if (filters.authorKey) out = out.filter(m => authorKeyOf(m.value.author) === filters.authorKey);
    }
    if (skip !== 'kind' && filters.contentType) {
      out = out.filter(m => m.value.content_type === filters.contentType);
    }
    if (q) {
      out = out.filter(m =>
        String(m.value.name ?? '').toLowerCase().includes(q)
        || String(m.value.author ?? '').toLowerCase().includes(q)
        || (m.value.tags || []).some(t => String(t).toLowerCase().includes(q)));
    }
    return out;
  };

  let matched = narrow(all);

  // ── The shape ──
  const authorGroups = new Map<string, { key: string; display: string; spellings: Set<string>; packages: number }>();
  for (const m of narrow(all, 'author')) {
    const key = authorKeyOf(m.value.author);
    const g = authorGroups.get(key) ?? { key, display: key, spellings: new Set<string>(), packages: 0 };
    g.spellings.add(String(m.value.author ?? '').trim() || '(unnamed)');
    g.packages++;
    authorGroups.set(key, g);
  }
  const authors = [...authorGroups.values()]
    .map(g => ({ key: g.key, display: g.display, packages: g.packages, spellings: [...g.spellings].sort() }))
    .sort((a, b) => b.packages - a.packages);

  const maturity = tally(matched, m => String(m.value.maturity ?? 'draft'))
    .map(x => ({ ...x, declared: (DECLARED_MATURITY as readonly string[]).includes(x.name) }));

  const facets = {
    authors,
    // Counted without its own filter, so the other kinds stay on the chip row.
    kinds: tally(narrow(all, 'kind'), m => String(m.value.content_type ?? 'document')),
    maturity,
    visibility: tally(matched, m => m.visibility),
  };

  // ── The page ──
  // Flagged first, then newest: the sort was already right and only the presentation threw it away.
  matched = [...matched].sort((a, b) => {
    if (a.flagCount !== b.flagCount) return b.flagCount - a.flagCount;
    return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt);
  });

  // A NUMBER THAT IS NOT A NUMBER FALLS BACK, it does not propagate. The route parses these out of
  // a query string, and `Math.max(1, NaN)` is NaN: `?page=abc` sliced with NaN, returned an empty
  // array and paging numbers that serialise as null, so a moderator reading "0 packages" on a node
  // holding two hundred had no way to tell a typo from an empty store. That is the exact failure
  // this whole read exists to end, and it does not get to survive in the read itself.
  const num = (v: number | undefined, fallback: number) => (Number.isFinite(v) ? (v as number) : fallback);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Math.floor(num(filters.perPage, DEFAULT_PER_PAGE))));
  const total = matched.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(pages, Math.max(1, Math.floor(num(filters.page, 1))));
  const paged = matched.slice((page - 1) * perPage, page * perPage);

  // ── Has anybody looked? ──
  // Bounded to the page on purpose: listReviews is per package, and the shape of the answer does
  // not justify a node-wide read on every render.
  const reviews = new Map<string, OperatorReviewRecord[]>();
  await Promise.all(paged.map(async (m) => {
    try {
      reviews.set(m.key, await storage.listReviews(m.key));
    } catch (err) {
      logger.warn('knowledge-overview: could not read the review trail', { key: m.key, error: String(err) });
      reviews.set(m.key, []);
    }
  }));

  const packages = paged.map(m => {
    const trail = (reviews.get(m.key) ?? [])
      .slice()
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const last = trail[0];
    return {
      key: m.key,
      package_id: m.key.replace('packages/', '').replace('/manifest', ''),
      name: m.value.name,
      author: m.value.author,
      author_key: authorKeyOf(m.value.author),
      content_type: m.value.content_type,
      tags: m.value.tags || [],
      visibility: m.visibility,
      flag_count: m.flagCount,
      maturity: m.value.maturity,
      // The page prints the word either way; this says whether it is one of ours.
      maturity_declared: (DECLARED_MATURITY as readonly string[]).includes(String(m.value.maturity ?? '')),
      entries_count: (m.value.entries || []).length,
      is_system: m.isSystem,
      created: m.value.created || m.createdAt,
      updated: m.updatedAt,
      reviews: trail.length,
      last_review: last
        ? { action: last.action, reason: last.reason, at: last.timestamp, by: last.operatorGaii }
        : null,
    };
  });

  const reviewedOnPage = packages.filter(p => p.reviews > 0).length;

  return {
    summary: {
      total: all.length,
      matching: total,
      flagged: all.filter(m => m.flagCount > 0).length,
      system: all.filter(m => m.isSystem).length,
      public: all.filter(m => m.visibility === 'public').length,
      authors: authors.length,
      // The tell that a collection is an import rather than something somebody built.
      one_entry: all.filter(m => (m.value.entries || []).length === 1).length,
      // Values outside the declared set, counted so a surface can say how much of the data is
      // carrying a word this node does not define.
      undeclared_maturity: maturity.filter(x => !x.declared).reduce((a, x) => a + x.packages, 0),
      reviewed_on_page: reviewedOnPage,
    },
    facets,
    paging: { number: page, per_page: perPage, total, pages },
    packages,
  };
}
