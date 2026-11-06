import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { renderInvoicePdf, type InvoicePdfInput } from './invoice-pdf';

const invoice = (period: number) => ({
  period,
  invoiceDate: '2026-11-06',
  dueDate: '2026-11-06',
  netCents: 8857,
  vatPercent: 25.5,
  vatCents: 2259,
  grossCents: 11116,
});
const input = (count: number, locale: InvoicePdfInput['locale'] = 'en'): InvoicePdfInput => ({
  contractId: 'contract-1',
  itemName: 'Saimaa Systems Studio 15',
  renterName: 'Õie Ääkkönen',
  locale,
  invoices: Array.from({ length: count }, (_, index) => invoice(index + 1)),
});

describe('renderInvoicePdf', () => {
  it.each(['en', 'fi', 'sv', 'et'] as const)('makes a PDF in %s', async (locale) => {
    const bytes = await renderInvoicePdf(input(3, locale));
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toContain('contract-1');
  });

  it('continues on new pages for a long schedule', async () => {
    const pdf = await PDFDocument.load(await renderInvoicePdf(input(80)));
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });
});
