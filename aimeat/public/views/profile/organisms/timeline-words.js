/**
 * @file public/views/profile/organisms/timeline-words.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A structure history entry in the reader's language. The node writes each entry as
 *   one English line for an AI and a log, "<what happened>: <what changed>" (services/structure/
 *   snapshot.ts: `${event}: ${diff}`): the event from a short list ("workspace created", "content
 *   published (batch)", "viewed", "deleted 3 record(s) in shared.x", "workspace archived") and the
 *   diff as comma-separated parts ('+workspace "Name"', '+space "s" in Name', '+2 docs in Name',
 *   '-1 record in Name', '+1 member', '+1 agent', 'structure changed'). This module reads that
 *   grammar and says it with the locale's words; a part it does not know is left out, and an entry
 *   with nothing known says "a change" rather than the English line.
 * @structure timelineWords(event) · totalsWords(totals)
 * @usage import { timelineWords } from './timeline-words.js'; timelineWords(row.event)
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial: the Shared places strip and history showed the node's English
 *     log line ("content published (batch): +2 docs in Laskutus") to a person.
 */
import { t } from '/js/i18n.js';

const w = (key, vars) => { const v = t('organisms.ev.' + key, vars); return v && v !== 'organisms.ev.' + key ? v : ''; };

/** The event half: what happened. 'viewed' is the node noticing a change on a read, so it says nothing itself. */
function eventPart(ev) {
  const e = String(ev || '').trim();
  const fixed = {
    'workspace created': 'workspaceCreated', 'workspace updated': 'workspaceUpdated', 'workspace deleted': 'workspaceDeleted',
    'content published': 'published', 'content published (batch)': 'published', 'organism created': 'placeCreated',
  };
  if (e === 'viewed' || !e) return '';
  if (fixed[e]) return w(fixed[e]);
  let m = e.match(/^deleted (\d+) record\(s\) in (.+)$/);
  if (m) return w('recordsDeleted', { n: m[1] });
  if (/^deleted record /.test(e)) return w('recordsDeleted', { n: '1' });
  m = e.match(/^\S+ (archive|unarchive)d$/);
  if (m) return w(m[1] === 'archive' ? 'archived' : 'restored');
  return '';
}

/** One part of the diff, or '' for a part this reader does not know. */
function diffPart(part) {
  const p = part.trim();
  let m = p.match(/^\+workspace "(.+)"$/);
  if (m) return w('newWorkspace', { name: m[1] });
  m = p.match(/^[−-]workspace "(.+)"$/);
  if (m) return w('workspaceGone', { name: m[1] });
  m = p.match(/^\+space "(.+)" in (.+)$/);
  if (m) return w('newSpace', { space: m[1], name: m[2] });
  m = p.match(/^([+-]?\d+) (doc|record|member|agent)s?(?: in (.+))?$/);
  if (m) {
    const n = Number(m[1]);
    const key = `${m[2]}${n > 0 ? 'Added' : 'Removed'}`;
    return w(key, { n: String(Math.abs(n)), name: m[3] || '' });
  }
  return '';
}

/** The whole entry in words: what happened, then what changed. */
export function timelineWords(event) {
  const s = String(event || '');
  const at = s.indexOf(': ');
  const head = at >= 0 ? s.slice(0, at) : s;
  const diff = at >= 0 ? s.slice(at + 2) : (eventPart(s) ? '' : s);
  const parts = [eventPart(head), ...diff.split(', ').map(diffPart)].filter(Boolean);
  return parts.length ? parts.join(' · ') : w('change');
}

/** A shape's totals in words ({ workspaces, documents, records, members }). */
export function totalsWords(tt) {
  if (!tt) return null;
  return w('totals', { ws: String(tt.workspaces), docs: String(tt.documents), recs: String(tt.records), members: String(tt.members) });
}
