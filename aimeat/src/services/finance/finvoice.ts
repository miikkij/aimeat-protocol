/**
 * @file src/services/finance/finvoice.ts
 * @description Finvoice 3.0 XML generation from an InvoiceRecord. The output validates
 *   against the official Finanssiala schema (vendored at resources/finvoice/Finvoice3.0.xsd;
 *   the E2E golden-file suite runs xmllint against it), so any operator or bank channel
 *   that speaks Finvoice accepts the document.
 *
 *   Format rules the schema imposes (and this file owns):
 *   - dates are CCYYMMDD with a Format attribute; timestamps ISO 8601
 *   - amounts are comma-decimal strings with an AmountCurrencyIdentifier attribute;
 *     EPI amounts require exactly two decimals
 *   - InvoiceTypeCode is INV01 for an invoice, INV02 for a credit note
 *   - the payment reference goes to EpiRemittanceInfoIdentifier with
 *     IdentificationSchemeName SPY (Finnish viite) or ISO (RF reference)
 *
 * @usage const xml = buildFinvoiceXml(invoice); // invoice must be sent (number + dates assigned)
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 1.
 */
import type { InvoiceRecord } from '../../models/finance-schemas.js';
import { FinanceError } from './errors.js';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Cents → "1234,56" (comma decimal, exactly two decimals). */
function money(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** Basis points → "25,5" (no trailing zeros beyond what the rate needs). */
function percent(rateBp: number): string {
  const whole = Math.floor(rateBp / 100);
  const frac = rateBp % 100;
  if (frac === 0) return String(whole);
  const fracStr = String(frac).padStart(2, '0').replace(/0$/, '');
  return `${whole},${fracStr}`;
}

/** Thousandths → "1,5" (comma decimal, trailing zeros trimmed). */
function quantity(quantityMilli: number): string {
  const whole = Math.floor(quantityMilli / 1000);
  const frac = quantityMilli % 1000;
  if (frac === 0) return String(whole);
  return `${whole},${String(frac).padStart(3, '0').replace(/0+$/, '')}`;
}

/** "2026-08-06" → "20260806". */
function ccyymmdd(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

/** Truncates to a schema length limit without splitting surrogate pairs. */
function clip(s: string, max: number): string {
  return [...s].slice(0, max).join('');
}

/**
 * Builds a schema-valid Finvoice 3.0 document. The invoice must have been sent: number,
 * reference, invoice date and due date assigned. Credit notes carry INV02 and reference
 * the original invoice number.
 */
export function buildFinvoiceXml(inv: InvoiceRecord, opts?: { originalInvoiceNumber?: string | null }): string {
  if (!inv.invoiceNumber || !inv.invoiceDate || !inv.dueDate || !inv.referenceNumber) {
    throw new FinanceError('NOT_SENT', 409, 'Finvoice XML can only be generated for a sent invoice (number, dates and reference assigned)');
  }
  const cur = inv.currency;
  const isCredit = inv.type === 'credit_note';
  const seller = inv.seller;
  const buyer = inv.buyer;
  if (!seller.iban) throw new FinanceError('MISSING_IBAN', 422, 'seller.iban is required for Finvoice generation (payment instructions)');

  const isRf = inv.referenceNumber.startsWith('RF');
  const lines: string[] = [];
  const push = (s: string): void => { lines.push(s); };

  push('<?xml version="1.0" encoding="UTF-8"?>');
  push('<Finvoice Version="3.0">');

  // Seller
  push('  <SellerPartyDetails>');
  if (seller.businessId) push(`    <SellerPartyIdentifier>${esc(clip(seller.businessId, 35))}</SellerPartyIdentifier>`);
  push(`    <SellerOrganisationName>${esc(clip(seller.name, 70))}</SellerOrganisationName>`);
  if (seller.vatId) push(`    <SellerOrganisationTaxCode>${esc(clip(seller.vatId, 35))}</SellerOrganisationTaxCode>`);
  if (seller.streetAddress && seller.city && seller.postalCode) {
    push('    <SellerPostalAddressDetails>');
    push(`      <SellerStreetName>${esc(clip(seller.streetAddress, 35))}</SellerStreetName>`);
    push(`      <SellerTownName>${esc(clip(seller.city, 35))}</SellerTownName>`);
    push(`      <SellerPostCodeIdentifier>${esc(clip(seller.postalCode, 35))}</SellerPostCodeIdentifier>`);
    push(`      <CountryCode>${esc(seller.country ?? 'FI')}</CountryCode>`);
    push('    </SellerPostalAddressDetails>');
  }
  push('  </SellerPartyDetails>');

  // Buyer
  push('  <BuyerPartyDetails>');
  if (buyer.businessId) push(`    <BuyerPartyIdentifier>${esc(clip(buyer.businessId, 35))}</BuyerPartyIdentifier>`);
  push(`    <BuyerOrganisationName>${esc(clip(buyer.name, 70))}</BuyerOrganisationName>`);
  if (buyer.vatId) push(`    <BuyerOrganisationTaxCode>${esc(clip(buyer.vatId, 35))}</BuyerOrganisationTaxCode>`);
  if (buyer.streetAddress && buyer.city && buyer.postalCode) {
    push('    <BuyerPostalAddressDetails>');
    push(`      <BuyerStreetName>${esc(clip(buyer.streetAddress, 35))}</BuyerStreetName>`);
    push(`      <BuyerTownName>${esc(clip(buyer.city, 35))}</BuyerTownName>`);
    push(`      <BuyerPostCodeIdentifier>${esc(clip(buyer.postalCode, 35))}</BuyerPostCodeIdentifier>`);
    push(`      <CountryCode>${esc(buyer.country ?? 'FI')}</CountryCode>`);
    push('    </BuyerPostalAddressDetails>');
  }
  push('  </BuyerPartyDetails>');

  // Invoice details
  push('  <InvoiceDetails>');
  push(`    <InvoiceTypeCode>${isCredit ? 'INV02' : 'INV01'}</InvoiceTypeCode>`);
  push(`    <InvoiceTypeText>${isCredit ? 'HYVITYSLASKU' : 'LASKU'}</InvoiceTypeText>`);
  push('    <OriginCode>Original</OriginCode>');
  push(`    <InvoiceNumber>${esc(clip(inv.invoiceNumber, 20))}</InvoiceNumber>`);
  push(`    <InvoiceDate Format="CCYYMMDD">${ccyymmdd(inv.invoiceDate)}</InvoiceDate>`);
  if (isCredit && opts?.originalInvoiceNumber) {
    push(`    <OriginalInvoiceNumber>${esc(clip(opts.originalInvoiceNumber, 20))}</OriginalInvoiceNumber>`);
  }
  push(`    <InvoiceTotalVatExcludedAmount AmountCurrencyIdentifier="${cur}">${money(inv.totalNetMinor)}</InvoiceTotalVatExcludedAmount>`);
  push(`    <InvoiceTotalVatAmount AmountCurrencyIdentifier="${cur}">${money(inv.totalVatMinor)}</InvoiceTotalVatAmount>`);
  push(`    <InvoiceTotalVatIncludedAmount AmountCurrencyIdentifier="${cur}">${money(inv.totalGrossMinor)}</InvoiceTotalVatIncludedAmount>`);
  for (const entry of inv.vatBreakdown) {
    push('    <VatSpecificationDetails>');
    push(`      <VatBaseAmount AmountCurrencyIdentifier="${cur}">${money(entry.netMinor)}</VatBaseAmount>`);
    push(`      <VatRatePercent>${percent(entry.vatRateBp)}</VatRatePercent>`);
    push(`      <VatRateAmount AmountCurrencyIdentifier="${cur}">${money(entry.vatMinor)}</VatRateAmount>`);
    push('    </VatSpecificationDetails>');
  }
  push('    <PaymentTermsDetails>');
  push(`      <PaymentTermsFreeText>${esc(`${inv.paymentTermsDays} pv netto`)}</PaymentTermsFreeText>`);
  push(`      <InvoiceDueDate Format="CCYYMMDD">${ccyymmdd(inv.dueDate)}</InvoiceDueDate>`);
  push('    </PaymentTermsDetails>');
  push('  </InvoiceDetails>');

  // Rows
  for (const line of inv.lines) {
    push('  <InvoiceRow>');
    push(`    <ArticleName>${esc(clip(line.description, 100))}</ArticleName>`);
    push(`    <DeliveredQuantity QuantityUnitCode="${esc(line.unit)}">${quantity(line.quantityMilli)}</DeliveredQuantity>`);
    push(`    <UnitPriceAmount AmountCurrencyIdentifier="${cur}">${money(line.unitPriceMinor)}</UnitPriceAmount>`);
    push(`    <RowVatRatePercent>${percent(line.vatRateBp)}</RowVatRatePercent>`);
    push(`    <RowVatAmount AmountCurrencyIdentifier="${cur}">${money(line.vatMinor)}</RowVatAmount>`);
    push(`    <RowVatExcludedAmount AmountCurrencyIdentifier="${cur}">${money(line.netMinor)}</RowVatExcludedAmount>`);
    push(`    <RowAmount AmountCurrencyIdentifier="${cur}">${money(line.grossMinor)}</RowAmount>`);
    push('  </InvoiceRow>');
  }

  // Payment instructions (EPI)
  push('  <EpiDetails>');
  push('    <EpiIdentificationDetails>');
  push(`      <EpiDate Format="CCYYMMDD">${ccyymmdd(inv.invoiceDate)}</EpiDate>`);
  push(`      <EpiReference>${esc(inv.referenceNumber)}</EpiReference>`);
  push('    </EpiIdentificationDetails>');
  push('    <EpiPartyDetails>');
  push('      <EpiBfiPartyDetails>');
  if (seller.bic) push(`        <EpiBfiIdentifier IdentificationSchemeName="BIC">${esc(seller.bic)}</EpiBfiIdentifier>`);
  push('      </EpiBfiPartyDetails>');
  push('      <EpiBeneficiaryPartyDetails>');
  push(`        <EpiNameAddressDetails>${esc(clip(seller.name, 35))}</EpiNameAddressDetails>`);
  push(`        <EpiAccountID IdentificationSchemeName="IBAN">${esc(seller.iban)}</EpiAccountID>`);
  push('      </EpiBeneficiaryPartyDetails>');
  push('    </EpiPartyDetails>');
  push('    <EpiPaymentInstructionDetails>');
  push(`      <EpiRemittanceInfoIdentifier IdentificationSchemeName="${isRf ? 'ISO' : 'SPY'}">${esc(inv.referenceNumber)}</EpiRemittanceInfoIdentifier>`);
  push(`      <EpiInstructedAmount AmountCurrencyIdentifier="${cur}">${money(inv.totalGrossMinor)}</EpiInstructedAmount>`);
  push('      <EpiCharge ChargeOption="SHA">SHA</EpiCharge>');
  push(`      <EpiDateOptionDate Format="CCYYMMDD">${ccyymmdd(inv.dueDate)}</EpiDateOptionDate>`);
  push('    </EpiPaymentInstructionDetails>');
  push('  </EpiDetails>');

  push('</Finvoice>');
  return lines.join('\n');
}
