# Automatic Invoice Generation — Test Report

**Status: COMPLETE.** Full backend regression: **1031 passed / 1 skipped / 0 failed**
(34 files). `tsc --noEmit` and `oxlint` clean.

## What was tested

### PDF generation (unit — `tests/unit/invoice-generator.test.ts`, 6 tests)
- A4 media box (`595.28 × 841.89`), valid `%PDF-` header, single page for a small invoice.
- **Every required field is present in the rendered PDF**, extracted back with a
  dependency-free parser (`tests/integration/helpers/pdf-inspect.ts`) that inflates
  the Flate-compressed content streams and decodes PDFKit's hex `TJ` runs:
  - business identity + logo (embedded image XObject), FSSAI/GSTIN, address;
  - invoice number, order number, date, payment method + status;
  - customer name/email/phone and full delivery address;
  - each line item: name, unit, price, quantity, subtotal;
  - financial summary: subtotal, discount, delivery, GST, grand total.
- Discount row is shown only when `discount > 0`; delivery shows `FREE` when waived.
- **Pagination:** a 60-item invoice renders across multiple pages with every item
  exactly once, a single grand total, a footer + `Page X of Y` on *every* page, and
  no text drawn outside the page area (clipping guard).
- **No significant text-box overlaps** on the page.
- Writes real, openable sample invoices to `tests/output/invoices/`
  (`sample-single.pdf`, `sample-no-discount-free-shipping.pdf`, `sample-many-items.pdf`).

### Workflow (integration — `tests/integration/invoice-workflow.test.ts`, 23 tests)
- **Automatic generation** for a paid order: `INV-YYYY-NNNNNN` numbering, `ISSUED`,
  `PAID`, exact amount snapshot, `s3PdfKey = invoices/{userId}/{invoiceNumber}.pdf`,
  order → `CONFIRMED`.
- **Refuses to invoice** unpaid/failed/cancelled orders and writes nothing; unknown
  order id → 404.
- **Duplicate confirmation is idempotent** → exactly one invoice.
- **Retrieval:** by id and by order-id, owner + admin; 404 when no invoice.
- **Ownership:** another customer gets 403 (read and download); anonymous 401.
- **Admin access:** platform search across customers; `limit=1000000` clamped to ≤100,
  `limit=abc` falls back to 20.
- **Download:** presigned URL to the owner with correct filename/expiry (3600s) and to
  an admin; 403 for a different customer; 404 for a missing invoice.
- **Regeneration (admin):** same object key, refreshed URL; 403 for a customer.
- **Cancellation (void):** reason required (400), sets `CANCELLED`, double-cancel → 400.
- **Historical immutability:** after the source product's price changes, the issued
  invoice and its **regenerated PDF** still show the original line price and total.
- **S3 integration:** upload key/content-type/metadata asserted; the captured PDF
  buffer is valid and contains the logo, invoice number, customer and grand total;
  presigned download URL generated from the stored key.

## Defects found & fixed

| ID | Severity | Defect | Fix |
|----|----------|--------|-----|
| BUG-INV-1 | High | Invoice had **no business logo** — text-only header, despite a logo being a stated invoice requirement. | Added a dependency-free PNG rasteriser (`src/integrations/pdf/brand-logo.ts`) and embed it as a real image; asserted via image-XObject detection. |
| BUG-INV-2 | High | **No pagination.** Line items and the summary were drawn from a fixed `y` toward a fixed footer (`y=740`); a long order ran off the page / overlapped the footer (clipping). | Added page-break handling with a continuation header, summary relocation to a fresh page when needed, and a footer + page numbers stamped on every buffered page. |
| BUG-INV-3 | Medium | The **rupee sign `₹` printed as a corrupted glyph** (`0xB9`): PDFKit's built-in Helvetica is WinAnsi-encoded and has no U+20B9 glyph. | Switched amounts to the ASCII `Rs.` prefix (no Unicode TTF asset exists in the repo to register instead). |
| BUG-INV-4 | Medium | An admin could **read** any invoice but `GET /invoices/:id/download` returned **403**: the controller authorised the admin, then `InvoiceService.getInvoiceDownloadUrl` re-checked ownership against the admin's own id. | Threaded the controller's `isAdmin` decision into the service; ownership is skipped only for an already-authorised admin. |

## Test-harness notes
- PDF inspection is dependency-free (Node `zlib` + a small content-stream parser); no
  PDF/native library was added.
- Under `NODE_ENV=test` S3 uploads/presigned URLs are simulated and emails are
  suppressed, so no external services are required.
- Fixtures (orders/invoices/products) are created directly via Prisma and fully
  cleaned up; invoices are deleted before orders to respect the restrictive FK.

## Not automatable here
- Actual S3 object bytes / real presigned GET against a live bucket require production
  AWS credentials — the storage call is asserted and the PDF buffer verified locally.
