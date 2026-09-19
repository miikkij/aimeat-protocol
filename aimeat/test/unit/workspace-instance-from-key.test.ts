/**
 * @file test/unit/workspace-instance-from-key.test.ts
 * @description A workspace batch-open takes a full memory key, because that is the id
 *   aimeat_discover gives a workspace record and an agent hands it on unchanged. The key must
 *   resolve ONLY inside the workspace being read: a key from another workspace or organism is a
 *   question about somewhere else, and answering it here would read across a boundary.
 * @usage cd aimeat && pnpm vitest run test/unit/workspace-instance-from-key.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial, with the cold-agent measurement that found the hand-off.
 */
import { describe, it, expect } from 'vitest';
import { instanceFromKey } from '../../src/services/workspace-tool-ops.js';

const ROOT = 'organism.org-1.w.ws-1';
const SPACES = ['shared.notes', 'shared.notes-old', 'shared.tasks'];

describe('a full key inside this workspace', () => {
  it('names its space and its instance, whatever role the key ends in', () => {
    for (const tail of ['', '.latest', '.draft', '.version.3']) {
      expect(instanceFromKey(ROOT, SPACES, `${ROOT}.shared.notes.spring-meeting${tail}`))
        .toEqual({ namespace: 'shared.notes', instance: 'spring-meeting' });
    }
  });

  it('takes the longest namespace when one begins another', () => {
    expect(instanceFromKey(ROOT, SPACES, `${ROOT}.shared.notes-old.n1.latest`))
      .toEqual({ namespace: 'shared.notes-old', instance: 'n1' });
  });
});

describe('anything else is not a key of this workspace', () => {
  it('a plain instance id', () => expect(instanceFromKey(ROOT, SPACES, 'spring-meeting')).toBeNull());
  it('another workspace', () => expect(instanceFromKey(ROOT, SPACES, 'organism.org-1.w.ws-2.shared.notes.n1.latest')).toBeNull());
  it('another organism', () => expect(instanceFromKey(ROOT, SPACES, 'organism.org-2.w.ws-1.shared.notes.n1.latest')).toBeNull());
  it('a workspace whose id only BEGINS like this one', () => expect(instanceFromKey(ROOT, SPACES, 'organism.org-1.w.ws-10.shared.notes.n1')).toBeNull());
  it('a space this workspace does not declare', () => expect(instanceFromKey(ROOT, SPACES, `${ROOT}.shared.secrets.n1.latest`)).toBeNull());
  it('the workspace meta, which is not a record', () => expect(instanceFromKey(ROOT, SPACES, `${ROOT}.meta.manifest`)).toBeNull());
  it('a namespace with nothing after it', () => expect(instanceFromKey(ROOT, SPACES, `${ROOT}.shared.notes.`)).toBeNull());
});
