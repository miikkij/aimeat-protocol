/**
 * @file e2e-auth-log-isolation.test.ts
 * @description A5: each runner target owns a log independently of inherited settings.
 * @version-history
 *  - 1.0.0 (2026-09-08): assert isolation of suite log paths.
 */
import { expect, it } from 'vitest';
import { suiteAuthLog, type RunnerTarget } from '../run-e2e-server.js';

it('keeps one log per target and never reuses the old shared test log', () => {
  const target = { port: '40791' } as RunnerTarget;
  const other = { port: '40791' } as RunnerTarget;
  expect(suiteAuthLog(target)).toBe(suiteAuthLog(target));
  expect(suiteAuthLog(target)).not.toBe(suiteAuthLog(other));
  expect(suiteAuthLog(target)).not.toContain('.auth-failures.log');
});
