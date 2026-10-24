/**
 * @file test/unit/app-intake-forms.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The intake forms an app declares in <meta name="aimeat-intake"> and the ones its code
 *   calls (services/app-intake-forms.ts), and the intake routes the content-access gate opens for an
 *   opened form (services/internet-opening/opening-registry.ts isOpenedIntakeRoute, with nothing open).
 * @version-history
 *   v1.0.0 - 2026-10-25 - Initial.
 */
import { describe, it, expect } from 'vitest';
import { parseDeclaredIntakeForms, scanCalledIntakeForms, undeclaredCalledForms } from '../../src/services/app-intake-forms.js';
import { INTAKE_ROUTE, isOpenedIntakeRoute } from '../../src/services/internet-opening/opening-registry.js';

const ORG = '1f0c2c3e-1111-4222-8333-944455556666';

describe('parseDeclaredIntakeForms', () => {
  it('reads every org/ws/formId the meta names, space or comma separated, without duplicates', () => {
    const html = `<html><head><meta name="aimeat-intake" content="${ORG}/ws-abc/consent, ${ORG}/ws-abc/frm_x1 ${ORG}/ws-abc/consent"></head></html>`;
    const { forms, invalid } = parseDeclaredIntakeForms(html);
    expect(invalid).toEqual([]);
    expect(forms).toEqual([{ org: ORG, ws: 'ws-abc', formId: 'consent' }, { org: ORG, ws: 'ws-abc', formId: 'frm_x1' }]);
  });

  it('names a token that is not three ids, so the publish can refuse it', () => {
    const { forms, invalid } = parseDeclaredIntakeForms('<meta name="aimeat-intake" content="only/two ../../etc/passwd">');
    expect(forms).toEqual([]);
    expect(invalid).toEqual(['only/two', '../../etc/passwd']);
  });

  it('declares nothing for a page without the meta', () => {
    expect(parseDeclaredIntakeForms('<html><body>no forms</body></html>')).toEqual({ forms: [], invalid: [] });
  });
});

describe('scanCalledIntakeForms', () => {
  it('finds the library calls and the literal addresses with three literal ids', () => {
    const html = `<script>
      AIMEAT.intake.submit('${ORG}', 'ws-abc', "consent", v);
      AIMEAT.intake.thread.start(\`${ORG}\`, 'ws-abc', 'chat', 'hi');
      fetch('/v1/intake/${ORG}/ws-abc/raw-form', { method: 'POST' });
      fetch('/v1/intake/forms');
      AIMEAT.intake.submit(org, ws, form, v);
    </script>`;
    const called = scanCalledIntakeForms(html).map(f => f.formId);
    expect(called).toEqual(['consent', 'chat', 'raw-form']);
  });

  it('leaves out what the meta declares', () => {
    const declared = [{ org: ORG, ws: 'ws-abc', formId: 'consent' }];
    const called = [{ org: ORG, ws: 'ws-abc', formId: 'consent' }, { org: ORG, ws: 'ws-abc', formId: 'feedback' }];
    expect(undeclaredCalledForms(declared, called).map(f => f.formId)).toEqual(['feedback']);
  });
});

describe('isOpenedIntakeRoute', () => {
  it('matches the descriptor, the submit and the conversation steps, and not the form list', () => {
    expect(INTAKE_ROUTE.test(`/v1/intake/${ORG}/ws-abc/consent`)).toBe(true);
    expect(INTAKE_ROUTE.test(`/v1/intake/${ORG}/ws-abc/consent/thread/read`)).toBe(true);
    expect(INTAKE_ROUTE.test('/v1/intake/forms')).toBe(false);
  });

  it('opens nothing while no app is open to the internet', () => {
    expect(isOpenedIntakeRoute('POST', `/v1/intake/${ORG}/ws-abc/consent`)).toBe(false);
  });
});
