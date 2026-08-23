export default async function (ctx, input) {
  // Everything lives inside this function on purpose: a top-level const/let/function crashes the
  // sandbox. That is why the small helpers below are re-declared rather than shared.
  const op = String((input && input.op) || '');
  const now = ctx.now();

  // WHO OWNS THIS BRAIN IS NOT A RACE. `ctx.extension.owner` is resolved by the node from the
  // extension's own record and cannot be reached by anything a caller sends, so the brain belongs
  // to whoever installed it from the first second. Absent means the road did not know the record,
  // and that reads as "not the owner", never as permission.
  const brainOwner = (ctx.extension && ctx.extension.owner) || null;
  if (!brainOwner) return { ok: false, error: 'this brain cannot tell who owns it' };
  if ((ctx.caller && ctx.caller.owner) !== brainOwner) {
    return { ok: false, error: 'only the owner of this brain may do that' };
  }

  const MAX_RETRIES = 5;

  /** One source, cleaned. Unknown fields are dropped: the register is a contract, not a bag. */
  function cleanSource(raw, previous) {
    const prev = previous || {};
    const kinds = ['company', 'connection', 'extension', 'upload', 'web', 'chat'];
    const kind = String((raw && raw.kind) || prev.kind || 'chat');
    const days = Number((raw && raw.cadence_days) != null ? raw.cadence_days : prev.cadence_days);
    return {
      id: String((raw && raw.id) || prev.id || ''),
      kind: kinds.indexOf(kind) >= 0 ? kind : 'chat',
      // What it points at: a company id, a connection id, a URL, a filename. Free text on purpose,
      // because the six kinds above name six different address spaces.
      ref: String((raw && raw.ref) != null ? raw.ref : (prev.ref || '')),
      feeds: String((raw && raw.feeds) != null ? raw.feeds : (prev.feeds || '')),
      // Zero means "this one does not repeat" — a one-off import is a real source and it should not
      // be nagged about forever. The sweep leaves those alone.
      cadence_days: days >= 0 ? Math.floor(days) : 0,
      // WHAT IT DOES NOT COVER. The register keeps this whether or not it is filled in, because a
      // source whose limits are unwritten is the one that quietly becomes "everything we know".
      coverage_note: String((raw && raw.coverage_note) != null ? raw.coverage_note : (prev.coverage_note || '')),
      last_ok_at: (raw && raw.last_ok_at) || prev.last_ok_at || null,
      last_error: (raw && raw.last_error) != null ? raw.last_error : (prev.last_error || null),
      status: String((raw && raw.status) || prev.status || 'ok'),
      added_at: prev.added_at || now,
    };
  }

  /** Read-modify-write the register under compare-and-swap. `mutate` returns the next items array. */
  async function withRegister(mutate) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const read = await ctx.memory.getVersioned('sources');
      const current = read ? (read.value || {}) : {};
      const items = Array.isArray(current.items) ? current.items : [];
      const next = mutate(items.slice());
      if (next && next.error) return next;
      // PRIVATE. An ext namespace is world-readable by default, and a company's list of what it
      // does not know is not a public document.
      const wrote = await ctx.memory.set('sources', { updated: now, items: next },
        { ifVersion: read ? read.version : 0, visibility: 'private' });
      if (wrote.ok) return { ok: true, sources: next };
    }
    return { ok: false, error: 'too much contention on the register — try again' };
  }

  // ── state ────────────────────────────────────────────────────────────────
  // Everything the page needs in one read: which company this brain is for, what feeds it, and what
  // the caretaker said last time. Three round trips would be three chances to render half a page.
  if (op === 'state') {
    const brain = await ctx.memory.get('brain');
    const sources = await ctx.memory.get('sources');
    const report = await ctx.memory.get('report');
    return {
      ok: true,
      brain: brain || null,
      sources: (sources && sources.items) || [],
      report: report || null,
    };
  }

  // ── configure ────────────────────────────────────────────────────────────
  // Which company this brain is for and which workspace holds its knowledge. The extension never
  // reads that workspace — it cannot, and does not need to — but the caretaker's report says which
  // brain it is about, and a report that names no company is one more thing to work out.
  if (op === 'configure') {
    const prev = (await ctx.memory.get('brain')) || {};
    const brain = {
      owner: brainOwner,
      company: String((input && input.company) != null ? input.company : (prev.company || '')),
      org: String((input && input.org) != null ? input.org : (prev.org || '')),
      ws: String((input && input.ws) != null ? input.ws : (prev.ws || '')),
      updated: now,
    };
    await ctx.memory.set('brain', brain, { visibility: 'private' });
    return { ok: true, brain: brain };
  }

  // ── put_source ───────────────────────────────────────────────────────────
  if (op === 'put_source') {
    const raw = (input && input.source) || null;
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'source must be an object' };
    if (!raw.id) return { ok: false, error: 'source.id required' };
    return await withRegister(function (items) {
      const at = items.findIndex(function (s) { return s && s.id === raw.id; });
      const merged = cleanSource(raw, at >= 0 ? items[at] : null);
      if (at >= 0) items[at] = merged; else items.push(merged);
      return items;
    });
  }

  // ── remove_source ────────────────────────────────────────────────────────
  if (op === 'remove_source') {
    const id = String((input && input.id) || '');
    if (!id) return { ok: false, error: 'id required' };
    return await withRegister(function (items) {
      return items.filter(function (s) { return !s || s.id !== id; });
    });
  }

  // ── touch_source ─────────────────────────────────────────────────────────
  // This feed just delivered, so its clock restarts. Passing an error instead records the failure
  // without moving the clock, which is what makes the next sweep call it broken rather than late.
  if (op === 'touch_source') {
    const id = String((input && input.id) || '');
    if (!id) return { ok: false, error: 'id required' };
    const failure = (input && input.error) ? String(input.error) : null;
    return await withRegister(function (items) {
      const at = items.findIndex(function (s) { return s && s.id === id; });
      if (at < 0) return { error: 'no such source: ' + id };
      const s = Object.assign({}, items[at]);
      if (failure) { s.last_error = failure; s.status = 'broken'; }
      else { s.last_ok_at = now; s.last_error = null; s.status = 'ok'; }
      items[at] = s;
      return items;
    });
  }

  // ── sweep ────────────────────────────────────────────────────────────────
  // The caretaker. Runs weekly as an `extension` schedule, which costs no tokens and needs no key
  // of the owner's; a scheduled run arrives with the installer as its own caller, so the owner
  // check at the top passes.
  //
  // WHAT IT DOES NOT DO, and why that is the design rather than a shortfall: it does not age facts.
  // A fact's review_after is compared with today at the moment the page renders, which costs
  // nothing, cannot drift and cannot be wrong. Nothing needs to sweep for that. What DOES need a
  // clock is the feed that has gone quiet, because silence leaves no record of itself.
  if (op === 'sweep') {
    // ctx.now() is one instant supplied by the host for the whole run, so the arithmetic below is
    // replayable — the sandbox is not reading a clock of its own.
    const today = new Date(now).getTime();
    const outcome = await withRegister(function (items) {
      return items.map(function (s) {
        if (!s) return s;
        if (s.status === 'paused') return s;
        const next = Object.assign({}, s);
        if (s.last_error) { next.status = 'broken'; return next; }
        // A one-off import does not repeat, so it can never be late.
        if (!(Number(s.cadence_days) > 0)) { next.status = 'ok'; return next; }
        if (!s.last_ok_at) { next.status = 'late'; return next; }
        // Two cadences, not one: a daily feed that missed today is not yet a problem worth a word.
        const overdueAfter = new Date(s.last_ok_at).getTime() + Number(s.cadence_days) * 2 * 86400000;
        next.status = today > overdueAfter ? 'late' : 'ok';
        return next;
      });
    });
    if (!outcome.ok) return outcome;

    const items = outcome.sources;
    const broken = items.filter(function (s) { return s && s.status === 'broken'; });
    const late = items.filter(function (s) { return s && s.status === 'late'; });
    const uncovered = items.filter(function (s) { return s && !s.coverage_note; });

    const lines = [];
    for (const s of broken) lines.push('broken: ' + s.id + (s.last_error ? ' — ' + s.last_error : ''));
    for (const s of late) lines.push('quiet: ' + s.id + (s.last_ok_at ? ' — last delivered ' + s.last_ok_at.slice(0, 10) : ' — has never delivered'));
    // Named, not counted: a source whose limits are unwritten is the one that quietly becomes
    // "everything we know", and it will not announce itself.
    for (const s of uncovered) lines.push('no coverage note: ' + s.id);

    const report = {
      generatedAt: now,
      checked: items.length,
      ok: items.length - broken.length - late.length,
      late: late.length,
      broken: broken.length,
      lines: lines,
    };
    await ctx.memory.set('report', report, { visibility: 'private' });

    // SPEAKS ONLY WHEN SOMETHING IS BROKEN. A weekly "all fine" is a message the owner learns to
    // delete unread, and once they do that, the one that matters goes with it. Late is written into
    // the report and shown on the page; broken interrupts.
    if (broken.length && ctx.notify) {
      await ctx.notify(
        broken.length === 1
          ? 'One thing that feeds your company brain has stopped: ' + broken[0].id
          : broken.length + ' things that feed your company brain have stopped',
        { title: 'Company brain', priority: 'high' },
      );
    }
    return { ok: true, report: report };
  }

  return { ok: false, error: 'unknown op: ' + op };
}
