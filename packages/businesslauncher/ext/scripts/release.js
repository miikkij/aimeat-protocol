export default async function (ctx, input) {
  // Put a hold's units back on the shelf. The person who took the hold may release it, and so may
  // the shop owner — nobody else, or one buyer could free another buyer's basket.
  const caller = (ctx.caller && ctx.caller.gaii) || null;
  if (!caller) return { ok: false, error: 'not authenticated' };

  const id = String((input && input.reservationId) || '');
  if (!id) return { ok: false, error: 'reservationId required' };

  // The owner comes from the extension's own record, not from a record a caller could have written.
  const isOwner = !!(ctx.extension && ctx.extension.owner)
    && (ctx.caller && ctx.caller.owner) === ctx.extension.owner;

  for (let attempt = 0; attempt < 5; attempt++) {
    const read = await ctx.memory.getVersioned('inventory');
    if (!read) return { ok: false, error: 'no inventory' };
    const inv = read.value;
    const reservations = Object.assign({}, inv.reservations || {});
    const held = reservations[id];
    // Already gone: released, committed or swept. Answering ok keeps a retry from reading as a
    // failure the caller has to handle.
    if (!held) return { ok: true, released: id, already: true };
    if (!isOwner && held.by !== caller) return { ok: false, error: 'that hold is not yours' };

    const stock = Object.assign({}, inv.stock || {});
    stock[held.sku] = (Number(stock[held.sku]) || 0) + (Number(held.qty) || 0);
    delete reservations[id];

    const wrote = await ctx.memory.set('inventory', {
      stock: stock, reservations: reservations,
    }, { ifVersion: read.version, visibility: 'private' });
    if (wrote.ok) {
      await ctx.memory.set('availability', { units: stock, updated: ctx.now() });
      return { ok: true, released: id, left: stock[held.sku] };
    }
  }
  return { ok: false, error: 'too much contention on the inventory — try again' };
}
