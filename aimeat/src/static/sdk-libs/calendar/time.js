/**
 * @file calendar/time.js
 * @description Civil dates and IANA zones. Authored gaps are refused; repeated hours use the first instant.
 * @version-history v1.0.0 - 2026-09-18 - Shared browser and server calendar arithmetic.
 */
import { Temporal } from '@js-temporal/polyfill';
export { Temporal };

export function local(value, allDay = false) {
  if (typeof value !== 'string') throw new TypeError('A date must be an ISO string');
  if (allDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('All-day dates use YYYY-MM-DD');
    return Temporal.PlainDate.from(value).toString();
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) throw new RangeError('Local times use YYYY-MM-DDTHH:mm:ss without an offset');
  return Temporal.PlainDateTime.from(value).toString({smallestUnit:'second'});
}

export function zoned(value, timeZone = 'UTC') {
  const plain = Temporal.PlainDateTime.from(value.length === 10 ? value + 'T00:00:00' : local(value));
  const date = plain.toZonedDateTime(timeZone, {disambiguation:'earlier'});
  if (!date.toPlainDateTime().equals(plain)) throw new RangeError('Local time does not exist in ' + timeZone + ': ' + value);
  return date;
}
export function toInstant(value, timeZone = 'UTC') { return zoned(value,timeZone).toInstant().toString(); }
export function fromInstant(value, timeZone = 'UTC') {
  return Temporal.Instant.from(value).toZonedDateTimeISO(timeZone).toPlainDateTime().toString({smallestUnit:'second'});
}
export function instantMs(value) { return Temporal.Instant.from(value).epochMilliseconds; }
export function iso(ms) { return Temporal.Instant.fromEpochMilliseconds(ms).toString(); }
export function wallMs(value) { return Date.parse(value.length === 10 ? value + 'T00:00:00Z' : value + 'Z'); }
export function wallString(ms, allDay = false) { return new Date(ms).toISOString().slice(0,allDay ? 10 : 19); }
export function week(value) {
  const d = Temporal.PlainDate.from(value);
  return {year:d.yearOfWeek,week:d.weekOfYear};
}
export function rangeMs(options) {
  const from = instantMs(options.from), to = instantMs(options.to);
  if (to <= from) throw new RangeError('Range end must be after its start');
  return {from,to};
}
