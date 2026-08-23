export default async function (ctx, input) {
  // Take units off the shelf and hold them under an id, in ONE compare-and-swap. Stock and holds
  // live in the same record precisely so that the two halves cannot land separately: a decrement
  // that survived while its hold was lost would sell a unit nobody can claim.
  const caller = (ctx.caller && ctx.caller.gaii) || null;
  if (!caller) return { ok: false, error: 'not authenticated' };

  const sku = String((input && input.sku) || '');
  const qty = Math.floor(Number((input && input.qty) || 1));
  const id = String((input && input.reservationId) || '');
  const expiresAt = String((input && input.expiresAt) || '');
  if (!sku) return { ok: false, error: 'sku required' };
  if (!(qty >= 1)) return { ok: false, error: 'qty must be at least 1' };
  if (!id) return { ok: false, error: 'reservationId required — the caller generates it' };
  if (!expiresAt) return { ok: false, error: 'expiresAt required (ISO-8601 UTC)' };
  // A hold that never expires is a unit taken off the shelf for good, so the sweep must be able to
  // reach it. Refusing a past date keeps a caller from "reserving" something already released.
  if (expiresAt <= ctx.now()) return { ok: false, error: 'expiresAt is already in the past' };

  for (let attempt = 0; attempt < 5; attempt++) {
    const read = await ctx.memory.getVersioned('inventory');
    if (!read) return { ok: false, error: 'nothing is stocked yet' };
    const inv = read.value;
    const stock = Object.assign({}, inv.stock || {});
    const reservations = Object.assign({}, inv.reservations || {});

    // Idempotent: the same id twice is the same hold, not a second one. A retry after a dropped
    // response must not take a second unit.
    if (reservations[id]) return { ok: true, reservationId: id, already: true, left: Number(stock[sku]) || 0 };

    const have = Number(stock[sku]) || 0;
    if (have < qty) return { ok: false, error: 'not enough left', left: have };

    stock[sku] = have - qty;
    reservations[id] = { sku: sku, qty: qty, expiresAt: expiresAt, by: caller, at: ctx.now() };

    // PRIVATE: this record names who holds what, and an ext namespace is world-readable by default.
    const wrote = await ctx.memory.set('inventory', {
      stock: stock, reservations: reservations,
    }, { ifVersion: read.version, visibility: 'private' });
    if (wrote.ok) {
      // The public shelf number, carrying counts and no identities. A display value: the binding
      // refusal happens above, against the private record, so a stale mirror cannot oversell.
      await ctx.memory.set('availability', { units: stock, updated: ctx.now() });
      return { ok: true, reservationId: id, left: stock[sku], expiresAt: expiresAt };
    }
    // Somebody else moved the inventory. Read it again and decide against what is really there.
  }
  return { ok: false, error: 'too much contention on the inventory — try again' };
}
