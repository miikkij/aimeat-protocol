/**
 * @file public/views/profile/offers/model.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Offers cover shows, derived once from the offer feed and the deliverables:
 *   every offer as one item, the production lines (offers that are steps of a workflow, and the ones
 *   a schedule runs on its own), what can be asked, whose agent is away, what came back and when,
 *   and the counts the strip and the chips carry. Grouping honours the need an offer declares for
 *   itself; the keyword guess is the fallback. Pure functions over plain data.
 * @structure buildModel · needOf · groupItems · runsOf
 * @usage import { buildModel, groupItems } from './model.js';
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial, for the Offers page in the poster face.
 */
import { classifyNeed, isAuto, sortOffers, NEED_DISPLAY_ORDER } from '/js/services/offers-grouping.js';

const DAY = 864e5;
export const keyOf = (it) => it.agent + '/' + it.offer.id;
const WAITING = new Set(['queued', 'active', 'paused', 'stalled', 'revision_requested']);

/** The need an offer belongs to: its own word when it declares one, the keyword guess otherwise. */
export function needOf(offer) {
  const own = typeof offer?.need === 'string' ? offer.need.trim().toLowerCase() : '';
  if (own && NEED_DISPLAY_ORDER.includes(own)) return own;
  return classifyNeed(offer);
}

/** A localised title: a plain string or a { locale: text } map. */
export const locTitle = (title) => {
  if (!title) return '';
  if (typeof title === 'string') return title;
  return title.en_US || title.fi_FI || Object.values(title)[0] || '';
};

/**
 * @param {object} p
 * @param {object[]} p.feed   the /v1/offers agents, each with its offers
 * @param {object[]} p.deliverables  the /v1/deliverables list, newest first
 * @param {Date} p.now
 */
export function buildModel({ feed = [], deliverables = [], now }) {
  const items = [];
  for (const entry of feed) {
    for (const offer of entry.offers || []) {
      items.push({ entry, offer, agent: entry.agent, key: entry.agent + '/' + offer.id, auto: isAuto(offer), need: needOf(offer), online: !!entry.online });
    }
  }
  const byKey = new Map(items.map(it => [it.key, it]));

  // What came back, newest first, and the latest state per agent (a chain step's colour).
  const latest = [...deliverables].sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
  const latestByAgent = new Map();
  for (const d of latest) if (d.agent && !latestByAgent.has(d.agent)) latestByAgent.set(d.agent, d);

  // The production lines: one chain per workflow an offer names itself a step of.
  const chains = new Map();
  for (const it of items) {
    for (const wf of it.offer.workflows || []) {
      let ch = chains.get(wf.id);
      if (!ch) { ch = { id: wf.id, title: locTitle(wf.title) || wf.id, steps: [] }; chains.set(wf.id, ch); }
      ch.steps.push(it);
    }
  }
  const chainList = [...chains.values()];
  for (const ch of chainList) {
    ch.last = ch.steps.map(s => latestByAgent.get(s.agent)).filter(Boolean).sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime())[0] || null;
    ch.failed = ch.steps.filter(s => ['failed', 'stalled'].includes(latestByAgent.get(s.agent)?.status)).length;
  }
  const inChain = new Set(chainList.flatMap(ch => ch.steps.map(s => s.key)));
  const autoSingles = items.filter(it => it.auto && !inChain.has(it.key));
  const askable = items.filter(it => !it.auto);
  const offline = items.filter(it => !it.online);
  const offlineAgents = new Set(offline.map(it => it.agent));
  const selling = items.filter(it => (it.offer.visibility && it.offer.visibility !== 'private') || it.offer.price?.morsels > 0 || it.offer.priceMoney);

  const nowMs = now.getTime();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const todayN = latest.filter(d => new Date(d.updated_at || 0).getTime() >= today.getTime()).length;
  const waiting = latest.filter(d => WAITING.has(d.status));
  const failed7 = latest.filter(d => d.status === 'failed' && nowMs - new Date(d.updated_at || 0).getTime() < 7 * DAY).length;
  const rated = latest.filter(d => d.rating).length;
  const unrated = latest.filter(d => d.status === 'done' && !d.rating);
  const failed = latest.filter(d => d.status === 'failed' || d.status === 'stalled');
  const agents = feed.length;
  const onlineAgents = feed.filter(e => e.online).length;

  // Who delivered most, for the inbox rail.
  const perAgent = new Map();
  for (const d of latest) perAgent.set(d.agent, (perAgent.get(d.agent) || 0) + 1);
  const mostDelivered = [...perAgent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return {
    items, byKey, latest, latestByAgent, chains: chainList, autoSingles, askable, offline, offlineAgents, selling,
    todayN, waiting, failed7, rated, unrated, failed, agents, onlineAgents, mostDelivered,
    autoN: items.filter(it => it.auto).length, stepsN: inChain.size,
  };
}

/** This offer's own runs: the deliverables the ask flow stamped with its id. */
export function runsOf(model, it, limit = 10) {
  return model.latest.filter(d => d.offer_id === it.offer.id && d.agent === it.agent).slice(0, limit);
}

/** Groups for the catalogue: by need (declared or guessed), by agent, or one flat A–Ö list. */
export function groupItems(items, axis, sortMode = 'standing') {
  if (axis === 'name') return [{ key: 'all', items: sortOffers(items, 'name') }];
  const buckets = new Map();
  for (const it of items) {
    const k = axis === 'agent' ? it.agent : it.need;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(it);
  }
  const keys = [...buckets.keys()];
  if (axis === 'need') keys.sort((a, b) => NEED_DISPLAY_ORDER.indexOf(a) - NEED_DISPLAY_ORDER.indexOf(b));
  else keys.sort((a, b) => a.localeCompare(b));
  return keys.map(k => ({ key: k, items: sortOffers(buckets.get(k), sortMode) }));
}
