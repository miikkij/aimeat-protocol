export default async function (ctx, input) {
  // Everything lives inside this function on purpose: a top-level const/let/function crashes the
  // sandbox. That is why the helpers below are re-declared in each action script rather than shared.
  const op = String((input && input.op) || '');
  const now = ctx.now();
  const caller = (ctx.caller && ctx.caller.gaii) || null;
  if (!caller) return { ok: false, error: 'not authenticated' };

  const MAX_RETRIES = 5;

  // WHO OWNS THIS SHOP IS NOT A RACE. `ctx.extension.owner` is resolved by the node from the
  // extension's own record and cannot be reached by anything a caller sends, so the shop belongs to
  // whoever installed it from the first second. A "whoever calls first claims it" step would mean a
  // shop somebody else can take between the install and the owner opening the back office.
  // Absent means the road did not know the record, and that reads as "not the owner", never as
  // permission.
  const shopOwner = (ctx.extension && ctx.extension.owner) || null;
  if (!shopOwner) return { ok: false, error: 'this shop cannot tell who owns it' };
  if ((ctx.caller && ctx.caller.owner) !== shopOwner) {
    return { ok: false, error: 'only the shop owner may do that' };
  }

  let shop = await ctx.memory.get('shop');

  // ── configure ────────────────────────────────────────────────────────────
  // The shop's own details. Not a claim: it changes nothing about who owns this.
  if (op === 'configure') {
    shop = {
      owner: shopOwner,
      name: String((input && input.name) || (shop && shop.name) || 'Shop'),
      currency: String((input && input.currency) || (shop && shop.currency) || 'EUR'),
      updated: now,
    };
    await ctx.memory.set('shop', shop);
    return { ok: true, shop: shop };
  }

  if (!shop) shop = { owner: shopOwner, currency: 'EUR' };

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

  // ── publish_pages ────────────────────────────────────────────────────────
  // Privacy, terms and delivery, as the storefront shows them. Public for the same reason the
  // catalogue is: a visitor must be able to read the terms before they buy, without an account.
  // Who wrote the text travels with it, because a skeleton the operator filled in is a starting
  // point they own and not advice from us.
  if (op === 'publish_pages') {
    const pages = (input && input.pages) || null;
    if (!pages || typeof pages !== 'object') return { ok: false, error: 'pages must be an object' };
    const clean = {};
    const allowed = ['privacy', 'terms', 'delivery'];
    for (const name of allowed) {
      const page = pages[name];
      if (!page) continue;
      if (typeof page.markdown !== 'string' || !page.markdown.trim()) {
        return { ok: false, error: 'page "' + name + '" needs markdown' };
      }
      clean[name] = {
        title: String(page.title || name),
        markdown: page.markdown,
        writtenBy: String(page.writtenBy || shop.owner),
        updated: now,
      };
    }
    if (Object.keys(clean).length === 0) return { ok: false, error: 'nothing to publish' };
    await ctx.memory.set('pages', clean);
    return { ok: true, pages: Object.keys(clean) };
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
      // PRIVATE: this record names who holds what, and an ext namespace is world-readable by
      // default. The public shelf number goes in `availability`, counts only, no identities.
      const wrote = read
        ? await ctx.memory.set('inventory', next, { ifVersion: read.version, visibility: 'private' })
        : await ctx.memory.set('inventory', next, { ifVersion: 0, visibility: 'private' });
      if (wrote.ok) {
        await ctx.memory.set('availability', { units: stock, updated: now });
        return { ok: true, stock: stock };
      }
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
      }, { ifVersion: read.version, visibility: 'private' });
      // No availability mirror here on purpose: committing a sale drops the hold and returns
      // nothing to the shelf, so the public number did not move.
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
      }, { ifVersion: read.version, visibility: 'private' });
      if (wrote.ok) {
        await ctx.memory.set('availability', { units: stock, updated: now });
        return { ok: true, expired: expired.length, ids: expired };
      }
    }
    return { ok: false, error: 'too much contention on the inventory — try again' };
  }

  return { ok: false, error: 'unknown op: ' + op };
}
