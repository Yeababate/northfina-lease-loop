// The "Download PDF" of a lease's monthly invoices: every issued invoice in one table, with
// totals. Made on request from the stored invoice rows (the amounts are never recalculated
// here), with the same Unicode font as the contract PDF so all four languages print.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatEuro } from '@/domain/money';
import { formatNumber } from '@/i18n/format';
import { getT } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';

export type InvoicePdfInput = {
  contractId: string;
  itemName: string;
  renterName: string;
  locale: Locale;
  invoices: readonly {
    period: number;
    invoiceDate: string;
    dueDate: string;
    netCents: number;
    vatPercent: number;
    vatCents: number;
    grossCents: number;
  }[];
};

const PAGE: [number, number] = [595, 842];
const LEFT = 50;
const RIGHT = 545;
const SIZE = 10;
const ROW = 16;
/** Column positions: text columns start at x; money columns end at x (right-aligned). */
const COLUMNS = [
  { key: 'period', x: LEFT, align: 'left' },
  { key: 'date', x: 90, align: 'left' },
  { key: 'due', x: 175, align: 'left' },
  { key: 'net', x: 335, align: 'right' },
  { key: 'vat', x: 445, align: 'right' },
  { key: 'gross', x: RIGHT, align: 'right' },
] as const;

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const t = getT(input.locale);
  const euro = (cents: number) => formatEuro(cents, intlLocale[input.locale]);
  // Short numeric dates (6.11.2026, 2026-11-06 …) so the table columns stay narrow.
  const shortDate = new Intl.DateTimeFormat(intlLocale[input.locale], {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const date = (iso: string) => shortDate.format(new Date(`${iso}T00:00:00Z`));

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    await readFile(path.join(process.cwd(), 'assets/fonts/DejaVuSans.ttf')),
    { subset: true }
  );
  pdf.setTitle(`${t('invoices.title')} ${input.contractId}`);
  pdf.setLanguage(input.locale);

  let page = pdf.addPage(PAGE);
  let y = 790;
  const text = (value: string, x: number, size = SIZE, align: 'left' | 'right' = 'left') =>
    drawText(page, font, value, x, y, size, align);

  text(t('invoices.title'), LEFT, 16);
  y -= 26;
  for (const line of [
    `${t('profile.item')}: ${input.itemName}`,
    `${t('profile.renter')}: ${input.renterName}`,
    `${t('profile.contractId')}: ${input.contractId}`,
  ]) {
    text(line, LEFT);
    y -= ROW;
  }
  y -= 8;

  const header = () => {
    for (const column of COLUMNS) text(t(`invoices.${column.key}`), column.x, 9, column.align);
    y -= 6;
    page.drawLine({
      start: { x: LEFT, y },
      end: { x: RIGHT, y },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
    y -= ROW;
  };
  header();

  const totals = { net: 0, vat: 0, gross: 0 };
  for (const row of input.invoices) {
    if (y < 70) {
      page = pdf.addPage(PAGE);
      y = 790;
      header();
    }
    const cells = {
      period: String(row.period),
      date: date(row.invoiceDate),
      due: date(row.dueDate),
      net: euro(row.netCents),
      vat: `${euro(row.vatCents)} (${formatNumber(row.vatPercent, input.locale)} %)`,
      gross: euro(row.grossCents),
    };
    for (const column of COLUMNS) text(cells[column.key], column.x, SIZE, column.align);
    totals.net += row.netCents;
    totals.vat += row.vatCents;
    totals.gross += row.grossCents;
    y -= ROW;
  }

  if (y < 110) {
    page = pdf.addPage(PAGE);
    y = 790;
  }
  page.drawLine({ start: { x: LEFT, y: y + 10 }, end: { x: RIGHT, y: y + 10 }, thickness: 0.5 });
  text(t('invoices.total'), LEFT);
  text(euro(totals.net), 335, SIZE, 'right');
  text(euro(totals.vat), 445, SIZE, 'right');
  text(euro(totals.gross), RIGHT, SIZE, 'right');
  y -= ROW * 2;
  for (const note of [t('invoices.policy'), t('invoices.separate')]) {
    for (const line of wrap(note, font, 9, RIGHT - LEFT)) {
      if (y < 50) {
        page = pdf.addPage(PAGE);
        y = 790;
      }
      text(line, LEFT, 9);
      y -= 13;
    }
    y -= 6;
  }

  return new Uint8Array(await pdf.save());
}

function drawText(
  page: PDFPage,
  font: PDFFont,
  value: string,
  x: number,
  y: number,
  size: number,
  align: 'left' | 'right'
) {
  const left = align === 'right' ? x - font.widthOfTextAtSize(value, size) : x;
  page.drawText(value, { x: left, y, size, font });
}

/** Splits a paragraph into lines that fit `width` at `size`. */
function wrap(paragraph: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of paragraph.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
