-- 030_invoices_and_items (down)
DROP TABLE IF EXISTS discounts;
DROP TABLE IF EXISTS invoice_items;
DROP TRIGGER IF EXISTS trg_invoices_no_delete ON invoices;
DROP TABLE IF EXISTS invoices;
