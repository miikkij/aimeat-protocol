/**
 * @file science/live.js
 * @description A cell that follows a memory key. The node already carries a live-update channel, so
 *   this adds no protocol of its own: a device or an agent writes a reading into a key, the channel
 *   says that key's family changed, and the cell reads it and moves. That is the whole IoT story —
 *   `AIMEAT.data.set('sensors.mokki.ulko', -12)` from anywhere is a meter moving on a page.
 *
 *   A READING IS A NUMBER SOMEWHERE IN A RECORD. A key may hold the number itself, or a record with
 *   the number under a name (`{ value: -12, at: '…' }`, `{ celsius: -12 }`). `numberIn()` looks in
 *   the obvious places and takes the first number it finds, so a device that writes what devices
 *   write does not have to be taught our shape first.
 *
 *   ONE POLL, NOT ONE PER CELL. Every followed key is read in one pass on every tick, and the tick
 *   is the channel's own — floored at four seconds where the channel is not available, which is the
 *   same floor the mosaic's live binding uses.
 * @structure followKeys · numberIn · readKeys
 * @usage
 *   const stop = followKeys({ T_ulko: 'sensors.mokki.ulko' }, (cellId, value) => …);
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (wish-tyokirja-tieteellinen-laskenta, stage 2).
 */
import { makeSession } from '../_core/session.js';
const { authFetch } = makeSession('aimeat-science.js');

/** The floor the mosaic's own live binding uses; nothing here asks the node more often. */
const MIN_INTERVAL_MS = 4000;

/**
 * Follow every key a sheet's cells name, and report each reading as it changes.
 * @param {Record<string,string>} keysByCell cell id → memory key
 * @param {(cellId: string, value: number) => void} onReading
 * @param {{ owner?: string, intervalMs?: number }} [opts]
 * @returns {() => void} stop following
 */
export function followKeys(keysByCell, onReading, opts) {
  const entries = Object.entries(keysByCell || {});
  if (!entries.length) return () => {};
  const o = opts || {};
  const last = new Map();
  let stopped = false;
  let timer = null;
  let unsubscribe = null;

  const pass = async () => {
    if (stopped) return;
    const readings = await readKeys(entries.map(([, key]) => key), o.owner);
    if (stopped) return;
    for (const [cellId, key] of entries) {
      const value = readings.get(key);
      if (value === undefined) continue;
      if (last.get(cellId) === value) continue;
      last.set(cellId, value);
      onReading(cellId, value);
    }
  };

  pass();

  // The node's own channel where a page has it; a timer where it does not. Either way the pass
  // above is what reads, so there is one path through the data and one place a reading is shaped.
  const live = typeof window !== 'undefined' && window.AIMEAT && window.AIMEAT.live;
  if (live && typeof live.subscribe === 'function') {
    unsubscribe = live.subscribe('memory', () => pass());
  } else {
    timer = setInterval(pass, Math.max(MIN_INTERVAL_MS, Number(o.intervalMs) || MIN_INTERVAL_MS));
  }

  return function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    if (typeof unsubscribe === 'function') unsubscribe();
  };
}

/** Read a set of keys and hand back the number each one currently holds. */
export async function readKeys(keys, owner) {
  const out = new Map();
  const unique = [...new Set(keys.filter(Boolean))];
  await Promise.all(unique.map(async (key) => {
    const path = owner
      ? '/v1/memory/' + encodeURIComponent(owner) + '/' + encodeURIComponent(key)
      : '/v1/memory/' + encodeURIComponent(key) + '?owner_scope=true';
    const res = await readOne(path);
    if (!res || !res.ok) return;
    const value = numberIn(res.data?.value);
    if (value !== null) out.set(key, value);
  }));
  return out;
}

/**
 * One key's record, or null. A key that cannot be read right now leaves its cell on the last reading
 * it had, saying it is waiting: a page must not fall over because one sensor's key is missing, not
 * yet shared, or written by somebody who has since withdrawn the permission.
 */
async function readOne(path) {
  try {
    return await authFetch(path);
  } catch {
    return null;
  }
}

/** Names a device is likely to write a reading under, in the order they are looked for. */
const READING_NAMES = ['value', 'reading', 'v', 'n', 'celsius', 'temp', 'temperature', 'amount', 'level'];

/**
 * The number a record holds. A bare number is the number; a record is looked at under the names a
 * device tends to use, then at its newest row if it holds a series.
 */
export function numberIn(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  if (Array.isArray(value)) return value.length ? numberIn(value[value.length - 1]) : null;
  if (value && typeof value === 'object') {
    for (const name of READING_NAMES) {
      if (name in value) {
        const found = numberIn(value[name]);
        if (found !== null) return found;
      }
    }
  }
  return null;
}
