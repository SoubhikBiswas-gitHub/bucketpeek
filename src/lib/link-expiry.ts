import { EXPIRY_OPTIONS } from "./format";

export const DEFAULT_LINK_LIFETIME: number = EXPIRY_OPTIONS[0].seconds;

const LIFETIMES: readonly number[] = EXPIRY_OPTIONS.map((o) => o.seconds);

export function isLinkLifetime(seconds: unknown): seconds is number {
  return typeof seconds === "number" && LIFETIMES.includes(seconds);
}

export const LINK_LIFETIME_MESSAGE = `Links can work for ${EXPIRY_OPTIONS.map((o) => o.label).join(", ").replace(/, ([^,]*)$/, " or $1")}.`;

const IST = "Asia/Kolkata";

function partsIn(d: Date, timeZone: string, hour12: boolean) {
  // en-US keeps "Sep" (en-GB says "Sept" in newer ICU); the parts are assembled in day-month order.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12,
    ...(hour12 ? {} : { hourCycle: "h23" as const }),
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("day")} ${get("month")} ${get("year")}`,
    dayMonth: `${get("day")} ${get("month")}`,
    time: hour12 ? `${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}` : `${get("hour")}:${get("minute")}`,
  };
}

export interface WorksUntil {
  utc: string;
  ist: string;
  both: string;
  // "5:00 PM IST" on the same Indian day as `now`, else "26 Sep, 5:00 PM IST".
  short: string;
}

export function worksUntil(d: Date, now: Date = new Date()): WorksUntil {
  const u = partsIn(d, "UTC", false);
  const i = partsIn(d, IST, true);
  const utc = `${u.date}, ${u.time} UTC`;
  const ist = `${i.date}, ${i.time} IST`;
  const sameDay = partsIn(now, IST, true).date === i.date;
  return { utc, ist, both: `${utc} · ${ist}`, short: sameDay ? `${i.time} IST` : `${i.dayMonth}, ${i.time} IST` };
}
