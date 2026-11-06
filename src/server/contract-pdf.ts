import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { getT } from '@/i18n/get-t';
import { formatNumber } from '@/i18n/format';
import { intlLocale, type Locale } from '@/i18n/locales';
import { formatEuro } from '@/domain/money';

export type ContractPdfInput = {
  id: string;
  actor: string;
  providerName: string;
  assetName: string;
  serialNumber: string;
  signedOn: string;
  startOn: string;
  endOn: string;
  termMonths: number;
  originalMonthlyNetCents: number;
  monthlyDiscountCents: number;
  discountBps: number;
  monthlyNetCents: number;
  buyoutNetCents: number;
  listPriceCents: number;
  downPaymentCents: number;
  financedCents: number;
  priceListVersion: number;
  priceSource?: string;
  band: string;
  factor: number;
  locale: Locale;
  generatedAt: string;
};

/** Render before committing signing. The saved bytes, never a later re-render, are original. */
export async function renderContractPdf(input: ContractPdfInput) {
  const t = getT(input.locale);
  const euro = (value: number) => formatEuro(value, intlLocale[input.locale]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    await readFile(path.join(process.cwd(), 'assets/fonts/DejaVuSans.ttf')),
    { subset: true }
  );
  pdf.setTitle(`${t('contract.title')} ${input.id}`);
  pdf.setLanguage(input.locale);
  pdf.setCreationDate(new Date(input.generatedAt));
  const content = [
    t('contract.title'),
    `${t('profile.contractId')}: ${input.id}`,
    `${t('profile.renter')}: ${input.actor}`,
    `${t('profile.provider')}: ${input.providerName}`,
    `${t('profile.item')}: ${input.assetName}`,
    `${t('profile.serial')}: ${input.serialNumber}`,
    `${t('profile.signedOn')}: ${input.signedOn}`,
    `${t('profile.generatedAt')}: ${input.generatedAt}`,
    t('contract.period', { start: input.startOn, end: input.endOn }),
    t('term.months', { months: input.termMonths }),
    `${t('explain.listPrice')}: ${euro(input.listPriceCents)}`,
    `${t('explain.downPayment')}: ${euro(input.downPaymentCents)}`,
    `${t('explain.financed')}: ${euro(input.financedCents)}`,
    `${t('discount.original')}: ${euro(input.originalMonthlyNetCents)}`,
    `${t('discount.amount')} (${formatNumber(input.discountBps / 100, input.locale)}%): −${euro(input.monthlyDiscountCents)}`,
    `${t('discount.final')}: ${euro(input.monthlyNetCents)}`,
    `${t('explain.buyout')}: ${euro(input.buyoutNetCents)}`,
    input.priceSource === 'next_life'
      ? t('asset.nextLifePrice')
      : t('asset.priceListVersion', { version: input.priceListVersion }),
    `${t('explain.factor', { band: input.band, months: input.termMonths })}: ${input.factor}`,
    t('contract.rule'),
    t('contract.tax'),
    t('profile.mockSigning'),
  ];
  let page = pdf.addPage([595, 842]);
  let y = 790;
  for (const paragraph of content) {
    let line = '';
    const words = paragraph
      .replace(/\s+/g, ' ')
      .split(' ')
      .flatMap((word) => {
        const chunks: string[] = [];
        let chunk = '';
        for (const character of word) {
          if (chunk && font.widthOfTextAtSize(chunk + character, 11) > 490) {
            chunks.push(chunk);
            chunk = '';
          }
          chunk += character;
        }
        if (chunk) chunks.push(chunk);
        return chunks;
      });
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, 11) > 490) {
        if (y < 50) {
          page = pdf.addPage([595, 842]);
          y = 790;
        }
        page.drawText(line, { x: 50, y, size: 11, font });
        y -= 17;
        line = word;
      } else line = next;
    }
    if (y < 50) {
      page = pdf.addPage([595, 842]);
      y = 790;
    }
    page.drawText(line, { x: 50, y, size: 11, font });
    y -= 24;
  }
  const bytes = new Uint8Array(await pdf.save());
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    locale: input.locale,
    templateVersion: 'contract-v1',
    generatedAt: input.generatedAt,
  };
}

export function documentIntegrityMatches(document: { bytes: Uint8Array; sha256: string }): boolean {
  return createHash('sha256').update(document.bytes).digest('hex') === document.sha256;
}
