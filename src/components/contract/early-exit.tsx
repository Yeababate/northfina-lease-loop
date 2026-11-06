'use client';

// "End the lease early" on the contract page: return the item or buy it out. Both quotes
// come from the server (previewEarlyExit in src/domain/early-exit.ts); this screen only shows
// them, asks for confirmation, and sends the exact quote back so a changed price is caught.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ExitKind, ExitPreviewFailure, ExitQuote } from '@/domain/early-exit';
import type { ExitPriceChange } from '@/domain/exit-settlement';
import { formatEuro } from '@/domain/money';
import { formatIsoDate } from '@/i18n/format';
import { getT } from '@/i18n/get-t';
import { intlLocale, type Locale } from '@/i18n/locales';
import { primaryButton, secondaryButton } from '../ui';
import { ExitExplanation } from './exit-explanation';

export type ExitQuoteResult =
  { ok: true; quote: ExitQuote } | { ok: false; reason: ExitPreviewFailure };

export type ExitRequestView = {
  id: string;
  kind: ExitKind;
  status: string;
  effectiveEndOn: string;
  revision: number;
  /** The stored quote, explained with the method it was priced with. */
  quote: ExitQuote;
  /** An open request re-priced with current data; null if it can't be priced right now. */
  currentQuote: ExitQuote | null;
  /** Why the current price differs from the one shown at request time, if it does. */
  priceChange: ExitPriceChange | null;
};

type EarlyExitProps = {
  contractId: string;
  locale: Locale;
  returnQuote: ExitQuoteResult;
  buyoutQuote: ExitQuoteResult;
  /** The signed end-of-term buyout, to show how the early buyout is built from it. */
  endOfTermBuyoutCents: number;
  /** The latest request, if any (pending, withdrawn or completed). */
  request: ExitRequestView | null;
};

type Problem = 'changed' | 'pending' | 'error' | null;

export function EarlyExit({
  contractId,
  locale,
  returnQuote,
  buyoutQuote,
  endOfTermBuyoutCents,
  request,
}: EarlyExitProps) {
  const t = getT(locale);
  const router = useRouter();
  const euro = (cents: number) => formatEuro(cents, intlLocale[locale]);
  const date = (iso: string) => formatIsoDate(iso, locale);
  const [chosen, setChosen] = useState<ExitKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);

  async function send(body: object, onOk?: () => void) {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/exit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        onOk?.();
        router.refresh();
        return;
      }
      const code = await errorCode(response);
      setProblem(
        code === 'QUOTE_CHANGED' ? 'changed' : code === 'EXIT_PENDING' ? 'pending' : 'error'
      );
      if (code === 'QUOTE_CHANGED') router.refresh();
    } catch {
      setProblem('error');
    } finally {
      setBusy(false);
    }
  }

  const problemText = problem ? (
    <p role="alert" className="font-medium text-red-700 dark:text-red-400">
      {t(`exit.problem.${problem}`)}
    </p>
  ) : null;

  // An open request (waiting for the provider, or the item received): show its current price,
  // which stays indicative until completion, and let the customer withdraw while pending.
  if (request?.status === 'pending' || request?.status === 'received') {
    const shown = request.currentQuote ?? request.quote;
    return (
      <div className="space-y-3">
        <div className="rounded-xl bg-orange-50 px-4 py-3 dark:bg-orange-950/50">
          <p className="font-semibold">{t(`exit.pending.${request.kind}`)}</p>
          <p className="mt-0.5 text-sm">
            {t(request.status === 'pending' ? 'exit.pending.detail' : 'exit.received.detail', {
              date: date(request.effectiveEndOn),
              amount: euro(shown.amountNetCents),
            })}
          </p>
          {request.priceChange ? (
            <p className="mt-1 text-sm font-medium">
              {t(`exit.changed.${request.priceChange.reason}`, {
                before: euro(request.priceChange.previousNetCents),
              })}
            </p>
          ) : null}
          <ExitExplanation
            quote={shown}
            endOfTermBuyoutCents={endOfTermBuyoutCents}
            locale={locale}
          />
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{t('exit.priceNote')}</p>
        </div>
        {problemText}
        {request.status === 'pending' ? (
          <button
            type="button"
            disabled={busy}
            className={secondaryButton}
            onClick={() =>
              send({ action: 'withdraw', exitId: request.id, expectedRevision: request.revision })
            }
          >
            {t('exit.withdraw')}
          </button>
        ) : null}
      </div>
    );
  }

  const options = [
    { kind: 'return' as const, result: returnQuote },
    { kind: 'buyout' as const, result: buyoutQuote },
  ];
  const unavailable = options.find((option) => !option.result.ok)?.result;
  if (unavailable && !unavailable.ok && options.every((option) => !option.result.ok)) {
    return <p>{t(`exit.unavailable.${unavailable.reason}`)}</p>;
  }

  const chosenQuote = options.find((option) => option.kind === chosen)?.result;
  if (chosen && chosenQuote?.ok) {
    const { quote } = chosenQuote;
    return (
      <div className="space-y-3 rounded-xl border border-stone-300 p-5 dark:border-stone-700">
        <h3 className="text-lg font-semibold">{t(`exit.${chosen}.title`)}</h3>
        <p>
          {t(`exit.confirm.${chosen}`, {
            date: date(quote.effectiveEndOn),
            amount: euro(quote.amountNetCents),
          })}
        </p>
        <ExitExplanation
          quote={quote}
          endOfTermBuyoutCents={endOfTermBuyoutCents}
          locale={locale}
        />
        <p className="text-sm text-stone-600 dark:text-stone-400">{t('exit.rentNote')}</p>
        <p className="text-sm text-stone-600 dark:text-stone-400">{t('exit.priceNote')}</p>
        {problemText}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            className={primaryButton}
            onClick={() =>
              send(
                {
                  action: 'request',
                  requestId: crypto.randomUUID(),
                  kind: chosen,
                  expectedQuote: quote,
                },
                () => setChosen(null)
              )
            }
          >
            {t('exit.confirm.button')}
          </button>
          <button
            type="button"
            disabled={busy}
            className={secondaryButton}
            onClick={() => setChosen(null)}
          >
            {t('exit.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {request?.status === 'withdrawn' ? (
        <p className="text-sm text-stone-600 dark:text-stone-400">{t('exit.withdrawn')}</p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {options.map(({ kind, result }) => (
          <div
            key={kind}
            className="flex flex-col rounded-xl border border-stone-300 p-5 dark:border-stone-700"
          >
            <h3 className="text-lg font-semibold">{t(`exit.${kind}.title`)}</h3>
            <p className="mt-1 text-sm text-stone-700 dark:text-stone-300">
              {t(`exit.${kind}.what`)}
            </p>
            {result.ok ? (
              <>
                <p className="mt-3 text-2xl font-semibold tabular-nums">
                  {euro(result.quote.amountNetCents)}
                </p>
                <p className="text-sm text-stone-600 dark:text-stone-400">
                  {t(`exit.${kind}.priceLabel`)}
                </p>
                <p className="mt-2 text-sm">
                  {t('exit.endsOn', { date: date(result.quote.effectiveEndOn) })}
                </p>
                {/* How the amount is worked out (fair-exit.ts), line by line. */}
                <ExitExplanation
                  quote={result.quote}
                  endOfTermBuyoutCents={endOfTermBuyoutCents}
                  locale={locale}
                />
                <div className="mt-auto pt-4">
                  <button
                    type="button"
                    className={`${secondaryButton} w-full`}
                    onClick={() => {
                      setProblem(null);
                      setChosen(kind);
                    }}
                  >
                    {t('exit.choose')}
                  </button>
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm">{t(`exit.unavailable.${result.reason}`)}</p>
            )}
          </div>
        ))}
      </div>
      {problemText}
      <p className="text-sm text-stone-600 dark:text-stone-400">{t('exit.rentNote')}</p>
      <p className="text-sm text-stone-600 dark:text-stone-400">{t('exit.priceNote')}</p>
    </div>
  );
}

async function errorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'error' in body) {
      const error = (body as { error: unknown }).error;
      if (error && typeof error === 'object' && 'code' in error) {
        const code = (error as { code: unknown }).code;
        return typeof code === 'string' ? code : null;
      }
    }
  } catch {
    // Not JSON: treat as a general error.
  }
  return null;
}
