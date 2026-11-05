// The simulated reminder email, rendered as data (subject and plain text) in the
// recipient's saved language when the reminder is generated. Nothing is sent: the text
// is stored as a preview. A real sender could later deliver the same rendered content.
import type { TimeRemaining } from '@/domain/reminder-timing';
import { intlLocale, type Locale } from '@/i18n/locales';

export type EmailPreviewInput = {
  locale: Locale;
  itemName: string;
  /** Exclusive end date; the last covered day is the day before. */
  endOn: string;
  lastCoveredDay: string;
  deadlineAt: string;
  timeZone: string;
  timing: TimeRemaining;
  catchUp: boolean;
  actionPath: string;
};

type Template = {
  subjectUpcoming: string;
  subjectEnded: string;
  days: (n: number) => string;
  hours: (n: number) => string;
  ended: (n: number) => string;
  body: string;
  bodyEnded: string;
  catchUp: string;
  action: string;
  simulated: string;
};

const templates: Record<Locale, Template> = {
  en: {
    subjectUpcoming: 'Your lease of {item} ends soon',
    subjectEnded: 'Your lease of {item} has ended',
    days: (n) => (n === 1 ? '1 day left' : `${n} days left`),
    hours: (n) => (n === 1 ? 'less than 1 hour left' : `about ${n} hours left`),
    ended: (n) =>
      n === 0 ? 'it ended today' : n === 1 ? 'it ended 1 day ago' : `it ended ${n} days ago`,
    body: 'Your lease of {item} ends at {deadline} ({timing}). The last day it covers is {lastDay}.',
    bodyEnded:
      'Your lease of {item} ended at {deadline} ({timing}). The last day it covered was {lastDay}. Please return or buy out the item.',
    catchUp:
      'This reminder was sent late and replaces the reminders you would have received earlier.',
    action: 'Choose what happens at the end of your lease: {link}',
    simulated: 'Simulated email preview. Nothing was sent outside Lease Loop.',
  },
  fi: {
    subjectUpcoming: 'Kohteen {item} leasing päättyy pian',
    subjectEnded: 'Kohteen {item} leasing on päättynyt',
    days: (n) => (n === 1 ? '1 päivä jäljellä' : `${n} päivää jäljellä`),
    hours: (n) => (n === 1 ? 'alle tunti jäljellä' : `noin ${n} tuntia jäljellä`),
    ended: (n) => (n === 0 ? 'päättyi tänään' : `päättyi ${n} päivää sitten`),
    body: 'Kohteen {item} leasing päättyy {deadline} ({timing}). Viimeinen sopimuspäivä on {lastDay}.',
    bodyEnded:
      'Kohteen {item} leasing päättyi {deadline} ({timing}). Viimeinen sopimuspäivä oli {lastDay}. Palauta tai lunasta kohde.',
    catchUp: 'Tämä muistutus lähti myöhässä ja korvaa aiemmin saamatta jääneet muistutukset.',
    action: 'Valitse, mitä leasingin päättyessä tapahtuu: {link}',
    simulated: 'Simuloitu sähköpostin esikatselu. Mitään ei lähetetty Lease Loopin ulkopuolelle.',
  },
  sv: {
    subjectUpcoming: 'Ditt leasingavtal för {item} upphör snart',
    subjectEnded: 'Ditt leasingavtal för {item} har upphört',
    days: (n) => (n === 1 ? '1 dag kvar' : `${n} dagar kvar`),
    hours: (n) => (n === 1 ? 'mindre än 1 timme kvar' : `cirka ${n} timmar kvar`),
    ended: (n) => (n === 0 ? 'upphörde i dag' : `upphörde för ${n} dagar sedan`),
    body: 'Ditt leasingavtal för {item} upphör {deadline} ({timing}). Sista avtalsdagen är {lastDay}.',
    bodyEnded:
      'Ditt leasingavtal för {item} upphörde {deadline} ({timing}). Sista avtalsdagen var {lastDay}. Lämna tillbaka eller lös ut varan.',
    catchUp:
      'Den här påminnelsen skickades sent och ersätter de påminnelser du skulle ha fått tidigare.',
    action: 'Välj vad som händer när avtalet upphör: {link}',
    simulated: 'Simulerad förhandsvisning av e-post. Inget skickades utanför Lease Loop.',
  },
  et: {
    subjectUpcoming: 'Toote {item} liisingleping lõpeb peagi',
    subjectEnded: 'Toote {item} liisingleping on lõppenud',
    days: (n) => (n === 1 ? 'jäänud 1 päev' : `jäänud ${n} päeva`),
    hours: (n) => (n === 1 ? 'jäänud alla 1 tunni' : `jäänud umbes ${n} tundi`),
    ended: (n) => (n === 0 ? 'lõppes täna' : `lõppes ${n} päeva tagasi`),
    body: 'Toote {item} liisingleping lõpeb {deadline} ({timing}). Viimane lepingupäev on {lastDay}.',
    bodyEnded:
      'Toote {item} liisingleping lõppes {deadline} ({timing}). Viimane lepingupäev oli {lastDay}. Palun tagasta või osta toode välja.',
    catchUp:
      'See meeldetuletus saadeti hilinemisega ja asendab varem saamata jäänud meeldetuletused.',
    action: 'Vali, mis lepingu lõppedes saab: {link}',
    simulated: 'Simuleeritud e-kirja eelvaade. Lease Loopist väljapoole midagi ei saadetud.',
  },
};

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

function timingText(t: Template, timing: TimeRemaining): string {
  if (timing.kind === 'days') return t.days(timing.days);
  if (timing.kind === 'hours') return t.hours(timing.hours);
  return t.ended(timing.days);
}

export function renderEmailPreview(input: EmailPreviewInput): { subject: string; text: string } {
  const t = templates[input.locale];
  const tag = intlLocale[input.locale];
  const deadline = new Intl.DateTimeFormat(tag, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: input.timeZone,
    timeZoneName: 'short',
  }).format(new Date(input.deadlineAt));
  const lastDay = new Intl.DateTimeFormat(tag, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${input.lastCoveredDay}T00:00:00Z`)
  );
  const subject = fill(input.timing.kind === 'ended' ? t.subjectEnded : t.subjectUpcoming, {
    item: input.itemName,
  });
  const lines = [
    fill(input.timing.kind === 'ended' ? t.bodyEnded : t.body, {
      item: input.itemName,
      deadline,
      timing: timingText(t, input.timing),
      lastDay,
    }),
    ...(input.catchUp ? [t.catchUp] : []),
    fill(t.action, { link: input.actionPath }),
    '',
    t.simulated,
  ];
  return { subject, text: lines.join('\n') };
}
