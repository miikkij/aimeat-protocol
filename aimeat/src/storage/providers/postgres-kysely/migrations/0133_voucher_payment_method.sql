-- 0133_voucher_payment_method.sql
-- How a voucher's money moved, as the person who booked it recorded it: 'cash', 'card', 'transfer' or
-- 'other' (models/finance-schemas.ts VoucherPaymentMethod, 2026-11-19). NULL when nobody recorded it,
-- which is every voucher booked before this column and every automatic booking (Stripe, checkout,
-- invoice), none of which is cash. The anti-money-laundering section of the compliance report reads the
-- cash vouchers across the node (AMLR 2024/1624 art. 80, services/aml/cash.ts), hence the partial index.
-- Mirrors safeAddColumn('finance_vouchers', 'paymentMethod') in providers/sqlite/schema.ts. This file
-- only adds.

ALTER TABLE "FinanceVoucher" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;

CREATE INDEX IF NOT EXISTS "FinanceVoucher_payment_method_idx"
  ON "FinanceVoucher"("paymentMethod", "date") WHERE "paymentMethod" IS NOT NULL;
