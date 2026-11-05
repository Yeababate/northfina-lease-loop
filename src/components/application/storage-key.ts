// The sessionStorage key for one application. Plain code with no React, so both server pages
// (which pass it down) and client components (which read and write it) can use it.

/** One key per item and lease choice, so two applications never share answers. */
export function applicationStorageKey(
  assetId: string,
  termMonths: number,
  downPaymentCents: number,
  startOn: string,
  userId = 'anonymous'
): string {
  const lease = new URLSearchParams({
    term: String(termMonths),
    down: String(downPaymentCents),
    start: startOn,
  });
  return `lease-loop:application:${encodeURIComponent(userId)}:${assetId}:${lease}`;
}
