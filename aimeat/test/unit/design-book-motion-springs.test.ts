/**
 * @file test/unit/design-book-motion-springs.test.ts
 * @description The spring hand in the Design Book and the signature (atelier 0.55.0): a motion
 *   recipe may carry --ak-spring-stiffness, -damping and -mass, each a plain number inside its
 *   bounds and refused in words otherwise, and a fresh node seeds the three spring recipes
 *   published.
 * @usage cd aimeat && pnpm exec vitest run test/unit/design-book-motion-springs.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (the ten motion parts).
 */
import { describe, expect, it } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { seedDesignBook } from '../../src/services/design-book/lifecycle.js';
import { DesignBookService } from '../../src/services/design-book/service.js';
import { validatePartInput } from '../../src/services/design-book/validate.js';
import { validateSignatureTokens } from '../../src/services/app-ui/validate.js';
import { MOTION_RECIPES } from '../../src/data/atelier-motions.js';

const config = { nodeId: 'aimeat-test-001-dev', baseUrl: 'http://localhost', aiProvenance: false } as unknown as AimeatConfig;

function motionPart(tokens: Record<string, string>) {
  return { id: 'motion-test-hand', kind: 'motion', title: 'A hand', summary: 'A test recipe for the spring hand.', body: { tokens }, tags: [] };
}

describe('the spring hand in a motion recipe', () => {
  it('is accepted, and the numbers come back as numbers', () => {
    const part = validatePartInput(motionPart({ '--ak-spring-stiffness': '320', '--ak-spring-damping': '30.0', '--ak-spring-mass': '1.2' }));
    expect(part.body).toEqual({ tokens: { '--ak-spring-stiffness': '320', '--ak-spring-damping': '30', '--ak-spring-mass': '1.2' } });
  });

  it('refuses a number outside its bounds, naming them', () => {
    expect(() => validatePartInput(motionPart({ '--ak-spring-stiffness': '5000' })))
      .toThrow(/from 60 to 600/);
    expect(() => validatePartInput(motionPart({ '--ak-spring-damping': '2' })))
      .toThrow(/from 8 to 60/);
  });

  it('refuses a unit or an expression where a plain number belongs', () => {
    expect(() => validateSignatureTokens({ '--ak-spring-mass': '1px' })).toThrow(/plain number/);
    expect(() => validateSignatureTokens({ '--ak-spring-stiffness': 'calc(100 + 20)' })).toThrow(/plain number/);
  });
});

describe('the seeded spring recipes', () => {
  it('a fresh node has all three, published, with the numbers from the registry', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    await seedDesignBook(storage, config);
    const book = new DesignBookService(storage, config);
    for (const recipe of MOTION_RECIPES) {
      const { part } = await book.get(recipe.id);
      expect(part.kind).toBe('motion');
      expect(part.status).toBe('published');
      expect((part.body as any).tokens['--ak-spring-stiffness']).toBe(recipe.tokens['--ak-spring-stiffness']);
    }
  });
});
