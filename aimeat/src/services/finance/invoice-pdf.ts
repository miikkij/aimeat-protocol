/**
 * @file src/services/finance/invoice-pdf.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Invoice PDF rendering (pdfkit): the human-readable A4 document attached to
 *   invoice emails and downloadable from the API. Layout is a conventional Finnish
 *   invoice: parties top, line table middle, totals right-aligned, and the payment box
 *   (IBAN/BIC, viite, due date, amount) at the bottom where a payer's eye looks for it.
 *   Standard Helvetica covers ä/ö (WinAnsi); money and dates render in Finnish locale.
 * @usage const pdf = await renderInvoicePdf(invoice); // Buffer
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 2.
 */
import PDFDocument from 'pdfkit';
import type { InvoiceRecord } from '../../models/finance-schemas.js';
import { FinanceError } from './errors.js';

function euros(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${whole},${String(abs % 100).padStart(2, '0')} €`;
}

function percentLabel(rateBp: number): string {
  const whole = Math.floor(rateBp / 100);
  const frac = rateBp % 100;
  return frac === 0 ? `${whole} %` : `${whole},${String(frac).padStart(2, '0').replace(/0$/, '')} %`;
}

function quantityLabel(quantityMilli: number): string {
  const whole = Math.floor(quantityMilli / 1000);
  const frac = quantityMilli % 1000;
  return frac === 0 ? String(whole) : `${whole},${String(frac).padStart(3, '0').replace(/0+$/, '')}`;
}

function finDate(isoDate: string | null): string {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
}

const M = 50;          // page margin
const W = 495;         // usable width (A4 595 − 2×50)

/** Renders the invoice as an A4 PDF. The invoice must be sent (number + dates assigned). */
export function renderInvoicePdf(inv: InvoiceRecord): Promise<Buffer> {
  if (!inv.invoiceNumber || !inv.invoiceDate || !inv.referenceNumber) {
    throw new FinanceError('NOT_SENT', 409, 'A PDF can only be rendered for a sent invoice');
  }
  const invoiceNumber = inv.invoiceNumber;
  const referenceNumber = inv.referenceNumber;
  return new Promise((resolvePdf, rejectPdf) => {
    const doc = new PDFDocument({ size: 'A4', margin: M, info: { Title: `${inv.type === 'credit_note' ? 'Hyvityslasku' : 'Lasku'} ${inv.invoiceNumber}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolvePdf(Buffer.concat(chunks)));
    doc.on('error', rejectPdf);

    const title = inv.type === 'credit_note' ? 'HYVITYSLASKU' : 'LASKU';

    // Header: seller name left, document title + number right.
    doc.font('Helvetica-Bold').fontSize(16).text(inv.seller.name, M, M);
    doc.fontSize(14).text(title, M, M, { width: W, align: 'right' });
    doc.font('Helvetica').fontSize(10).text(invoiceNumber, M, M + 18, { width: W, align: 'right' });
    let y = M + 30;
    doc.fontSize(8).fillColor('#555555');
    const sellerMeta = [
      inv.seller.businessId ? `Y-tunnus ${inv.seller.businessId}` : null,
      inv.seller.vatId ? `ALV-tunnus ${inv.seller.vatId}` : null,
      [inv.seller.streetAddress, inv.seller.postalCode, inv.seller.city].filter(Boolean).join(', ') || null,
      inv.seller.email ?? null,
    ].filter(Boolean) as string[];
    for (const line of sellerMeta) { doc.text(line, M, y); y += 11; }
    doc.fillColor('#000000');

    // Meta block right: dates and terms.
    const metaX = 330;
    let metaY = M + 34;
    const meta: [string, string][] = [
      ['Laskun päivämäärä', finDate(inv.invoiceDate)],
      ['Eräpäivä', finDate(inv.dueDate)],
      ['Maksuehto', `${inv.paymentTermsDays} pv netto`],
      ['Viitenumero', referenceNumber],
    ];
    doc.fontSize(9);
    for (const [label, value] of meta) {
      doc.font('Helvetica').text(label, metaX, metaY, { width: 110 });
      doc.font('Helvetica-Bold').text(value, metaX + 115, metaY, { width: W + M - metaX - 115, align: 'right' });
      metaY += 14;
    }

    // Buyer block.
    y = Math.max(y, metaY) + 18;
    doc.font('Helvetica').fontSize(8).fillColor('#555555').text('LASKUN SAAJA', M, y);
    y += 12;
    doc.fillColor('#000000').font('Helvetica-Bold').fontSize(10).text(inv.buyer.name, M, y);
    y += 13;
    doc.font('Helvetica').fontSize(9);
    const buyerMeta = [
      inv.buyer.businessId ? `Y-tunnus ${inv.buyer.businessId}` : null,
      [inv.buyer.streetAddress, inv.buyer.postalCode, inv.buyer.city].filter(Boolean).join(', ') || null,
      inv.buyer.email ?? null,
    ].filter(Boolean) as string[];
    for (const line of buyerMeta) { doc.text(line, M, y); y += 12; }

    // Line table.
    y += 16;
    const cols = { desc: M, qty: 300, unit: 345, price: 380, vat: 440, net: 480 };
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#555555');
    doc.text('SELITE', cols.desc, y, { width: cols.qty - cols.desc - 8 });
    doc.text('MÄÄRÄ', cols.qty, y, { width: 40, align: 'right' });
    doc.text('YKS.', cols.unit, y, { width: 30 });
    doc.text('A-HINTA', cols.price, y, { width: 55, align: 'right' });
    doc.text('ALV', cols.vat, y, { width: 35, align: 'right' });
    doc.text('NETTO', cols.net, y, { width: M + W - cols.net, align: 'right' });
    y += 11;
    doc.moveTo(M, y).lineTo(M + W, y).lineWidth(0.5).strokeColor('#999999').stroke();
    y += 6;
    doc.font('Helvetica').fontSize(9).fillColor('#000000');
    for (const line of inv.lines) {
      const descHeight = doc.heightOfString(line.description, { width: cols.qty - cols.desc - 8 });
      if (y + descHeight > 700) { doc.addPage(); y = M; }
      doc.text(line.description, cols.desc, y, { width: cols.qty - cols.desc - 8 });
      doc.text(quantityLabel(line.quantityMilli), cols.qty, y, { width: 40, align: 'right' });
      doc.text(line.unit, cols.unit, y, { width: 30 });
      doc.text(euros(line.unitPriceMinor), cols.price, y, { width: 55, align: 'right' });
      doc.text(percentLabel(line.vatRateBp), cols.vat, y, { width: 35, align: 'right' });
      doc.text(euros(line.netMinor), cols.net, y, { width: M + W - cols.net, align: 'right' });
      y += Math.max(descHeight, 12) + 4;
    }
    doc.moveTo(M, y).lineTo(M + W, y).stroke();
    y += 8;

    // Totals, right-aligned; VAT itemized per rate.
    const totX = 330;
    const totW = M + W - totX;
    doc.fontSize(9);
    doc.font('Helvetica').text('Veroton yhteensä', totX, y, { width: totW - 90 });
    doc.text(euros(inv.totalNetMinor), totX, y, { width: totW, align: 'right' });
    y += 13;
    for (const entry of inv.vatBreakdown) {
      doc.text(`ALV ${percentLabel(entry.vatRateBp)}`, totX, y, { width: totW - 90 });
      doc.text(euros(entry.vatMinor), totX, y, { width: totW, align: 'right' });
      y += 13;
    }
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text('YHTEENSÄ', totX, y, { width: totW - 90 });
    doc.text(euros(inv.totalGrossMinor), totX, y, { width: totW, align: 'right' });
    y += 26;

    // Payment box.
    if (y > 640) { doc.addPage(); y = M; }
    const boxH = 16 + (inv.seller.iban ? 15 : 0) + (inv.seller.bic ? 15 : 0) + 45;
    doc.rect(M, y, W, boxH).lineWidth(0.75).strokeColor('#333333').stroke();
    let py = y + 8;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#555555').text('MAKSUTIEDOT', M + 10, py);
    py += 13;
    doc.fillColor('#000000').fontSize(9);
    const pay: [string, string][] = [];
    if (inv.seller.iban) pay.push(['IBAN', inv.seller.iban]);
    if (inv.seller.bic) pay.push(['BIC', inv.seller.bic]);
    pay.push(['Viitenumero', referenceNumber]);
    pay.push(['Eräpäivä', finDate(inv.dueDate)]);
    pay.push(['Maksettava', euros(inv.totalGrossMinor)]);
    for (const [label, value] of pay) {
      doc.font('Helvetica').text(label, M + 10, py, { width: 100 });
      doc.font('Helvetica-Bold').text(value, M + 115, py);
      py += 15;
    }

    if (inv.notes) {
      py += 10;
      doc.font('Helvetica').fontSize(8).fillColor('#555555').text(inv.notes, M, py, { width: W });
    }

    doc.end();
  });
}
