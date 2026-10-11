/**
 * @file test/unit/portal-policy-not-set.test.ts
 * @description The page /v1/privacy and /v1/terms answer with while the operator fields are not
 *   filled in (routes/portal-policy-not-set.ts): it says what is missing by the name the Config
 *   page shows, links to that page, and says that saving is enough.
 * @usage pnpm test -- portal-policy-not-set
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { renderPolicyNotSetPage } from '../../src/routes/portal-policy-not-set.js';

describe('renderPolicyNotSetPage', () => {
  it('names each missing field as the Config page names it, with its environment variable', () => {
    const page = renderPolicyNotSetPage(['name', 'hostingName', 'effectiveDate'], 'en', 'privacy');
    expect(page).toContain('<title>This service has no privacy policy yet</title>');
    expect(page).toContain('Operator name');
    expect(page).toContain('AIMEAT_OPERATOR_NAME');
    expect(page).toContain('Hosting provider');
    expect(page).toContain('AIMEAT_OPERATOR_HOSTING_NAME');
    expect(page).toContain('Policies take effect');
    expect(page).toContain('AIMEAT_OPERATOR_EFFECTIVE_DATE');
    // A field that is filled in is not listed.
    expect(page).not.toContain('AIMEAT_OPERATOR_ADDRESS');
  });

  it('sends the operator to the Config page and says that saving is enough', () => {
    const page = renderPolicyNotSetPage(['name'], 'en', 'privacy');
    expect(page).toContain('<a href="/v1/admin?tab=config">Config</a>');
    expect(page).toContain('Operator identity');
    expect(page).toContain('no restart');
    // The fields were environment-only once, and the page told the operator to restart.
    expect(page).not.toContain('restart the node');
  });

  it('is in Finnish and in Spanish, in the words the Config page uses', () => {
    const fi = renderPolicyNotSetPage(['name'], 'fi', 'privacy');
    expect(fi).toContain('<html lang="fi">');
    expect(fi).toContain('Tällä palvelulla ei ole vielä tietosuojaselostetta');
    expect(fi).toContain('<a href="/v1/admin?tab=config">Asetukset</a>');
    expect(fi).toContain('Operaattorin tiedot');
    expect(fi).toContain('Operaattorin nimi');
    expect(fi).not.toMatch(/solmu|konfiguroi/i);
    const es = renderPolicyNotSetPage(['name'], 'es', 'privacy');
    expect(es).toContain('Este servicio aún no tiene política de privacidad');
    expect(es).toContain('Nombre del operador');
  });

  it('names the terms when the terms page asked for it', () => {
    expect(renderPolicyNotSetPage(['name'], 'en', 'terms')).toContain('<title>This service has no terms of service yet</title>');
    expect(renderPolicyNotSetPage(['name'], 'fi', 'terms')).toContain('Tällä palvelulla ei ole vielä käyttöehtoja');
  });

  it('writes a field name it does not know as text, never as markup', () => {
    const page = renderPolicyNotSetPage(['<img src=x>'], 'en', 'privacy');
    expect(page).not.toContain('<img');
  });
});
