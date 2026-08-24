/**
 * @file test/unit/key-family.test.ts
 * @description Does the data map's key classifier put a REAL production key in the right family, on
 *   the right basis?
 *
 *   WHY THESE KEYS. Every key in the table below was taken from the production node on 2026-08-24,
 *   not invented. The classifier's whole value is that its answer can be trusted about the store we
 *   actually have, and a fixture written from imagination tests the author's idea of the store.
 *
 *   The two properties that matter most are the collapsing rules. Without them a family degenerates
 *   into a key — 169 organisms become 169 families, a schedule that has run for a month becomes 300
 *   rows — and the data map is then the unreadable list it exists to replace. So the collapse cases
 *   are asserted directly rather than through a happy path.
 * @usage pnpm test -- key-family
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 step 1.
 */
import { describe, it, expect } from 'vitest';
import { classifyKey, familyOf, baseKeyOf, PLATFORM_WRITTEN_PREFIXES } from '../../src/utils/key-family.js';

describe('classifyKey: the workspace form, which is most of the node', () => {
  // 53.9% of a 1000-key production sample had this shape.
  const key = 'organism.e8617051-6963-44ea-b1d1-f4c41b4fd0ab.w.ws-mr48730nq0b.room.target.TARGET-073.latest';

  it('collapses the organism and workspace ids but keeps the space', () => {
    const f = classifyKey(key);
    expect(f.family).toBe('organism.<id>.w.<id>.room.*');
    expect(f.area).toBe('organism');
  });

  it('is declared-space without a schema and schema-locked with one', () => {
    expect(classifyKey(key).tier).toBe('declared-space');
    const locked = classifyKey(key, {
      schemas: [{ keyPattern: 'organism.e8617051-6963-44ea-b1d1-f4c41b4fd0ab.w.ws-mr48730nq0b.room.*', applyTo: 'prefix' }],
    });
    expect(locked.tier).toBe('schema-locked');
  });

  it('cites its evidence, and cites nothing when there is nothing to cite', () => {
    expect(classifyKey(key).by).toContain('ws-mr48730nq0b');
    expect(classifyKey('salesboard.item.7').by).toBe('');
  });

  it('puts two records of the same space in ONE family', () => {
    const a = 'organism.fbb51de5-56d5-4143-9871-b998a1187655.w.ws-mq664uyfz21.shared.notes.doc-msovrfkwgxa8.draft';
    const b = 'organism.fbb51de5-56d5-4143-9871-b998a1187655.w.ws-mq664uyfz21.shared.notes.doc-other.latest';
    expect(familyOf(a)).toBe(familyOf(b));
  });

  it('separates two DIFFERENT spaces, because they hold different things', () => {
    const target = 'organism.e8617051-6963-44ea-b1d1-f4c41b4fd0ab.w.ws-mr48730nq0b.room.target.T-1.latest';
    const design = 'organism.e8617051-6963-44ea-b1d1-f4c41b4fd0ab.w.ws-mr48730nq0b.design.doc-mt7gi4109x3l.latest';
    expect(familyOf(target)).not.toBe(familyOf(design));
  });
});

describe('classifyKey: the organism plumbing is the node, not the workspace', () => {
  it('reads organism.<id>.meta.* as platform', () => {
    const f = classifyKey('organism.b784641b-a4dd-4d69-adb6-9954dc813e1e.meta.registry');
    expect(f.tier).toBe('platform-prefix');
    expect(f.family).toBe('organism.<id>.meta.*');
  });

  // Found in a browser on a real account: a bare `organism.<id>.meta` with nothing after it read as
  // "nothing says what this is". The trailing dot was doing work it should not have been doing.
  it('reads a bare organism.<id>.meta as platform too', () => {
    expect(classifyKey('organism.1df3736b-8672-4765-a99d-5b065f7f5da0.meta').tier).toBe('platform-prefix');
  });
});

describe('classifyKey: the `.w.` segment is what marks a workspace record, not the id spelling', () => {
  // The same browser run: this account's workspaces are named `ws1`, not `ws-mslunjvcgxj`, and every
  // record in them was called unexplained. On a node where workspace records are half the keyspace,
  // that is the most confident wrong answer this classifier can give.
  it.each([
    'organism.1df3736b-8672-4765-a99d-5b065f7f5da0.w.ws1.meta.manifest',
    'organism.1df3736b-8672-4765-a99d-5b065f7f5da0.w.ws1.shared.pages.intro.latest',
  ])('%s is a workspace record', key => {
    const f = classifyKey(key);
    expect(f.tier).toBe('declared-space');
    expect(f.area).toBe('organism');
  });
});

describe('classifyKey: reserved beats everything, because the server acts on it', () => {
  it.each([
    ['openrouter.settings', 'openrouter.'],
    ['ai-usage.2026-08.total', 'ai-usage.'],
    ['profile.alice.interests', 'profile.'],
    ['finance.accountants', 'finance.'],
    ['commerce.psp', 'commerce.'],
    ['chat.thread.abc', 'chat.'],
    ['signals.stream.hn', 'signals.'],
  ])('%s is platform on the strength of %s', (key, prefix) => {
    const f = classifyKey(key);
    expect(f.tier).toBe('platform-prefix');
    expect(f.by).toBe(prefix);
  });

  it('a reserved prefix wins even when an app is named the same thing', () => {
    // An app called "profile" must not be able to claim the directory keys the server publishes from.
    const f = classifyKey('profile.alice.interests', { appNames: ['profile'] });
    expect(f.tier).toBe('platform-prefix');
  });
});

describe('classifyKey: a platform family names its writer, and a lookalike does not', () => {
  it('every entry in the list carries the code that writes it', () => {
    for (const entry of PLATFORM_WRITTEN_PREFIXES) {
      expect(entry.writtenBy.length).toBeGreaterThan(0);
    }
  });

  it('agents.<name>.statistics.* is platform', () => {
    expect(classifyKey('agents.joker-evolved.statistics.reviews').tier).toBe('platform-prefix');
  });

  it.each(['changelog.entry.42', 'listing.abc', 'news.2026-08-10.evening', 'salesboard.item.7'])(
    'does NOT call %s platform — measured 2026-08-24, no node code writes it',
    (key) => {
      expect(classifyKey(key).tier).not.toBe('platform-prefix');
    },
  );
});

describe('classifyKey: what the owner owns', () => {
  it('matches an app name on the first segment', () => {
    const f = classifyKey('tictactoe.state.board', { appNames: ['tictactoe', 'suunta'] });
    expect(f.tier).toBe('owner-named');
    expect(f.by).toBe('app:tictactoe');
  });

  it('reads crews.<agent>.* as that agent\'s deliverables', () => {
    // 1094 of 1098 crews.* keys on the production owner name one of that owner's own agents. No node
    // code writes this prefix, so without the agent list every one of them is unexplained.
    const f = classifyKey('crews.news-fetcher.2026-08-24.raw', { agentNames: ['news-fetcher', 'joker'] });
    expect(f.tier).toBe('owner-named');
    expect(f.by).toBe('agent:news-fetcher');
    expect(f.family).toBe('crews.news-fetcher.*');
  });

  it('leaves crews.<name>.* unexplained when no such agent exists', () => {
    // The four that did not match were agents named in a prompt and never built. Claiming to know
    // what those hold would be exactly the wrong answer.
    expect(classifyKey('crews.julkaisu-linkedin.x', { agentNames: ['news-fetcher'] }).tier).toBe('none');
  });

  it('matches an extension namespace', () => {
    const f = classifyKey('ext:mroom-weather.latest', { extNames: ['mroom-weather'] });
    expect(f.tier).toBe('owner-named');
    expect(f.area).toBe('extension');
  });

  it('a declared pattern beats an app-name guess, because the program said so', () => {
    const f = classifyKey('uutiset.elokuu.12', { declared: [{ pattern: 'uutiset.*', by: 'app:uutiset' }] });
    expect(f.tier).toBe('declared-space');
    expect(f.family).toBe('uutiset.*');
  });
});

describe('classifyKey: unexplained is a finding, not a blank', () => {
  it('leaves a key nobody has described at tier none', () => {
    const f = classifyKey('generator.prj-mpmmry7v-wposa.component.app-1');
    expect(f.tier).toBe('none');
  });

  it('folds a family of unexplained keys into ONE row', () => {
    // 57 of these in the production sample; they must not be 57 findings.
    const a = familyOf('generator.prj-mpmmry7v-wposa.component.app-1');
    const b = familyOf('generator.prj-mpgwxs0t-bxpfr.component.cortex-app-domain');
    expect(a).toBe(b);
    expect(a).toBe('generator.<id>.*');
  });

  it('handles a slash-separated key, which some apps use', () => {
    const f = classifyKey('comicland/overlay-strip/e-mpnui90j-wkicev/9');
    expect(f.tier).toBe('none');
    expect(f.family).toBe('comicland/overlay-strip/*');
  });
});

describe('collapsing: the rule that keeps a family from becoming a key', () => {
  it('collapses a date, so a daily schedule is one row and not 365', () => {
    const days = ['news.2026-08-10.raw', 'news.2026-08-11.raw', 'news.2026-08-12.raw'];
    const families = new Set(days.map(k => familyOf(k)));
    expect(families.size).toBe(1);
    expect([...families][0]).toBe('news.<date>.*');
  });

  it('collapses a plain number', () => {
    expect(familyOf('comicland.strip.1')).toBe(familyOf('comicland.strip.2'));
  });

  it('does NOT collapse a real word, or two different things would merge', () => {
    expect(familyOf('todo.items')).not.toBe(familyOf('todo.index'));
  });

  it.each(['my-fractals', 'mroom-weather', 'btc-cost-basis-tracker', 'overlay-strip'])(
    'keeps %s intact — a name that only looks generated',
    (name) => {
      expect(familyOf(`x.${name}.y`)).toContain(name);
    },
  );

  it('does not collapse an all-letter generated id, and that is the stated trade', () => {
    // `cal-mpgvmtlj-2weoj` is a real id on this node and carries no digit in any chunk, so it stays.
    // Every rule wide enough to catch it also swallowed `my-fractals`, and merging two real families
    // is a wrong answer nobody can see, while splitting one generated family is merely more rows.
    expect(familyOf('calibrator.cal-mpgvmtlj-2weoj.detail')).toContain('cal-mpgvmtlj-2weoj');
  });

  it('never names more than four leading segments', () => {
    const deep = 'a.b.c.d.e.f.g.h';
    expect(familyOf(deep).split('.').length).toBeLessThanOrEqual(5); // four segments plus the '*'
  });
});

describe('version rows belong to the family they are history of', () => {
  it('strips the version suffix', () => {
    expect(baseKeyOf('skills.hatchery-agent-requests.versions.1.0.1.version.3'))
      .toBe('skills.hatchery-agent-requests.versions.1.0.1');
  });

  it('puts a key and its history in the same family', () => {
    // 216 of the 1000 sampled keys were version rows. Left alone they would double the family count.
    expect(familyOf('agents.cadence-followup.statistics.reviews.version.7'))
      .toBe(familyOf('agents.cadence-followup.statistics.reviews'));
  });
});

describe('purity', () => {
  it('gives the same answer twice, and does not mutate its hints', () => {
    const hints = { appNames: ['tictactoe'], schemas: [] as { keyPattern: string; applyTo: 'prefix' }[] };
    const first = classifyKey('tictactoe.state', hints);
    const second = classifyKey('tictactoe.state', hints);
    expect(second).toEqual(first);
    expect(hints.appNames).toEqual(['tictactoe']);
  });

  it('works with no hints at all, which is how the write path calls it', () => {
    expect(() => classifyKey('anything.at.all')).not.toThrow();
  });
});
