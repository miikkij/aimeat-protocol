export default async function (ctx, input) {
  // Everything lives inside this function on purpose: a top-level const/let/function crashes the
  // sandbox. That is why the helpers below are re-declared in each action script rather than shared.
  const op = String((input && input.op) || '');
  const now = ctx.now();
  const caller = (ctx.caller && ctx.caller.gaii) || null;
  if (!caller) return { ok: false, error: 'not authenticated' };

  const MAX_RETRIES = 5;

  // ── claim ────────────────────────────────────────────────────────────────
  // Whoever installs the shop calls this once. `ifVersion: 0` is what makes it a claim rather than a
  // race: the second caller is refused by the store, not by a check that could interleave.
  if (op === 'claim') {
    const wrote = await ctx.memory.set('shop', {
      owner: caller,
      currency: String((input && input.currency) || 'EUR'),
      claimedAt: now,
    }, { ifVersion: 0 });
    if (!wrote.ok) {
      const held = await ctx.memory.get('shop');
      return { ok: false, error: 'already claimed', owner: (held && held.owner) || null };
    }
    return { ok: true, owner: caller };
  }

  const shop = await ctx.memory.get('shop');
  if (!shop) return { ok: false, error: 'this shop has not been claimed yet — call op "claim" first' };
  if (shop.owner !== caller) return { ok: false, error: 'only the shop owner may do that' };

  // ── publish_catalog ──────────────────────────────────────────────────────
  // The PUBLIC copy the storefront reads with no login. The editable truth lives in the owner's
  // workspace; this is the mirror, and it is written only when the owner publishes.
  if (op === 'publish_catalog') {
    const catalog = (input && input.catalog) || null;
    if (!catalog || typeof catalog !== 'object') return { ok: false, error: 'catalog must be an object' };
    const items = Array.isArray(catalog.items) ? catalog.items : [];
    await ctx.memory.set('catalog', {
      currency: String(catalog.currency || shop.currency || 'EUR'),
      updated: now,
      items: items,
    });
    return { ok: true, items: items.length, updated: now };
  }

  // ── set_stock ────────────────────────────────────────────────────────────
  // Absolute units per sku, not a delta: the owner is stating what is on the shelf. Written through
  // a compare-and-swap so it cannot clobber a reservation taken while the form was open.
  if (op === 'set_stock') {
    const units = (input && input.units) || null;
    if (!units || typeof units !== 'object') return { ok: false, error: 'units must be an object of sku -> count' };
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const read = await ctx.memory.getVersioned('inventory');
      const inv = read ? read.value : { stock: {}, reservations: {} };
      const stock = Object.assign({}, inv.stock || {});
      for (const sku of Object.keys(units)) {
        const n = Number(units[sku]);
        if (!(n >= 0)) return { ok: false, error: 'units must be zero or more: ' + sku };
        stock[sku] = Math.floor(n);
      }
      const next = { stock: stock, reservations: inv.reservations || {} };
      const wrote = read
        ? await ctx.memory.set('inventory', next, { ifVersion: read.version })
        : await ctx.memory.set('inventory', next, { ifVersion: 0 });
      if (wrote.ok) return { ok: true, stock: stock };
    }
    return { ok: false, error: 'too much contention on the inventory — try again' };
  }

  // ── commit ───────────────────────────────────────────────────────────────
  // The sale completed. The units were already taken out of stock when the reservation was made, so
  // committing only drops the hold; it must NOT return them.
  if (op === 'commit') {
    const id = String((input && input.reservationId) || '');
    if (!id) return { ok: false, error: 'reservationId required' };
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const read = await ctx.memory.getVersioned('inventory');
      if (!read) return { ok: false, error: 'no inventory' };
      const inv = read.value;
      const reservations = Object.assign({}, inv.reservations || {});
      if (!reservations[id]) return { ok: false, error: 'no such reservation' };
      delete reservations[id];
      const wrote = await ctx.memory.set('inventory', {
        stock: inv.stock || {}, reservations: reservations,
      }, { ifVersion: read.version });
      if (wrote.ok) return { ok: true, committed: id };
    }
    return { ok: false, error: 'too much contention on the inventory — try again' };
  }

  // ── sweep ────────────────────────────────────────────────────────────────
  // Expired holds go back on the shelf. Runs on a clock as an `extension` schedule, which costs no
  // tokens; a scheduled run arrives with the owner as its own caller, so the check above passes.
  // ISO-8601 UTC strings compare correctly as strings, which is why no Date is needed in here.
  if (op === 'sweep') {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const read = await ctx.memory.getVersioned('inventory');
      if (!read) return { ok: true, expired: 0 };
      const inv = read.value;
      const stock = Object.assign({}, inv.stock || {});
      const reservations = Object.assign({}, inv.reservations || {});
      const expired = [];
      for (const id of Object.keys(reservations)) {
        const r = reservations[id];
        if (r && typeof r.expiresAt === 'string' && r.expiresAt <= now) {
          stock[r.sku] = (Number(stock[r.sku]) || 0) + (Number(r.qty) || 0);
          expired.push(id);
          delete reservations[id];
        }
      }
      if (expired.length === 0) return { ok: true, expired: 0 };
      const wrote = await ctx.memory.set('inventory', {
        stock: stock, reservations: reservations,
      }, { ifVersion: read.version });
      if (wrote.ok) return { ok: true, expired: expired.length, ids: expired };
    }
    return { ok: false, error: 'too much contention on the inventory — try again' };
  }

  return { ok: false, error: 'unknown op: ' + op };
}
