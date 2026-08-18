/**
 * @file src/services/finance/export.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Accountant-facing exports: voucher and invoice CSVs (semicolon-separated,
 *   comma decimals — the format Finnish bookkeeping software imports without a mapping
 *   step) and a ZIP bundle of Finvoice XML documents. The ZIP is a hand-rolled STORE-only
 *   (no compression) writer over node:zlib crc32 — XML this small doesn't justify a
 *   dependency, and store-only ZIPs open everywhere.
 * @structure vouchersCsv · invoicesCsv · buildZip (store-only ZIP writer)
 * @usage const csv = vouchersCsv(vouchers); const zip = buildZip([{name, data}]);
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 1.
 */
import { crc32 } from 'node:zlib';
import type { VoucherRecord, InvoiceRecord } from '../../models/finance-schemas.js';

/** Cents → "1234,56" for CSV (Finnish locale comma decimal). */
function euros(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** Escapes a CSV field (semicolon separator, quotes doubled). */
function field(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function row(cells: (string | number | null | undefined)[]): string {
  return cells.map(field).join(';');
}

/** Voucher journal CSV: one row per voucher, VAT itemized per code in packed columns. */
export function vouchersCsv(vouchers: VoucherRecord[]): string {
  const header = row([
    'tositenumero', 'paivays', 'selite', 'suunta', 'lahde', 'summa_eur', 'valuutta',
    'alv_erittely', 'vastapuoli', 'lasku_id', 'tracking_code', 'ulkoinen_viite', 'liitteet', 'korjaa_tositteen',
  ]);
  const lines = vouchers.map((v) => row([
    v.voucherNumber, v.date, v.description,
    v.direction === 'income' ? 'tulo' : (v.direction === 'transfer' ? 'siirto' : 'meno'),
    v.source, euros(v.amountMinor), v.currency,
    v.vatBreakdown.map((e) => `${(e.vatRateBp / 100).toString().replace('.', ',')}%: netto ${euros(e.netMinor)} alv ${euros(e.vatMinor)}`).join(' | '),
    v.counterparty, v.invoiceId, v.trackingCode, v.externalRef,
    v.attachments.length, v.reversesVoucherId,
  ]));
  // BOM so Excel opens UTF-8 with ä/ö intact.
  return '﻿' + [header, ...lines].join('\r\n') + '\r\n';
}

/** Invoice ledger CSV: one row per invoice. */
export function invoicesCsv(invoices: InvoiceRecord[]): string {
  const header = row([
    'laskunumero', 'tyyppi', 'tila', 'laskun_paivays', 'erapaiva', 'viitenumero',
    'ostaja', 'ostajan_ytunnus', 'netto_eur', 'alv_eur', 'brutto_eur', 'valuutta',
    'maksettu', 'toimitustapa', 'hyvittaa_laskun',
  ]);
  const lines = invoices.map((i) => row([
    i.invoiceNumber ?? `(luonnos ${i.id.slice(0, 8)})`,
    i.type === 'credit_note' ? 'hyvityslasku' : 'lasku',
    i.status, i.invoiceDate, i.dueDate, i.referenceNumber,
    i.buyer.name, i.buyer.businessId,
    euros(i.totalNetMinor), euros(i.totalVatMinor), euros(i.totalGrossMinor), i.currency,
    i.paidAt ? i.paidAt.slice(0, 10) : '', i.deliveryMethod, i.creditsInvoiceId,
  ]));
  return '﻿' + [header, ...lines].join('\r\n') + '\r\n';
}

export interface ZipEntry {
  /** Entry filename (forward slashes, UTF-8). */
  name: string;
  data: Buffer;
}

/**
 * Store-only ZIP writer (PKZIP 2.0 layout, UTF-8 filename flag). Enough for a bundle of
 * XML files; every unzip tool reads it. DOS timestamps are fixed to the build moment.
 */
export function buildZip(entries: ZipEntry[]): Buffer {
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf-8');
    const crc = crc32(entry.data) >>> 0;
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);      // local file header signature
    local.writeUInt16LE(20, 4);              // version needed
    local.writeUInt16LE(0x0800, 6);          // flags: UTF-8 filenames
    local.writeUInt16LE(0, 8);               // method: store
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);           // compressed = uncompressed (store)
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);              // extra length
    localParts.push(local, nameBuf, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);    // central directory signature
    central.writeUInt16LE(20, 4);            // version made by
    central.writeUInt16LE(20, 6);            // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    // extra(30)=0, comment(32)=0, disk(34)=0, internal attrs(36)=0, external attrs(38)=0
    central.writeUInt32LE(offset, 42);       // local header offset
    centralParts.push(central, nameBuf);

    offset += 30 + nameBuf.length + size;
  }

  const centralSize = centralParts.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);          // end of central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}
