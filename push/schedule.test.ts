import { describe, expect, test } from "bun:test";
import { isDue, isValidTime, isValidTimeZone, localNow } from "./schedule";

// 2026-03-10 17:30 UTC = 18:30 i Stockholm (vintertid, UTC+1).
const at1830 = new Date("2026-03-10T17:30:00Z");
const base = { time: "18:00", timeZone: "Europe/Stockholm", lastSentOn: null, practicedOn: null };

describe("localNow", () => {
  test("räknar i abonnentens tidszon", () => {
    expect(localNow("Europe/Stockholm", at1830)).toEqual({ date: "2026-03-10", minute: 18 * 60 + 30 });
    expect(localNow("America/New_York", at1830)).toEqual({ date: "2026-03-10", minute: 13 * 60 + 30 });
  });

  test("midnatt blir 00, inte 24", () => {
    expect(localNow("UTC", new Date("2026-03-10T00:05:00Z")).minute).toBe(5);
  });
});

describe("isDue", () => {
  test("skickas efter vald tid", () => {
    expect(isDue(base, at1830)).toBe(true);
  });

  test("inte före vald tid", () => {
    expect(isDue({ ...base, time: "19:00" }, at1830)).toBe(false);
  });

  test("bara en gång per dag", () => {
    expect(isDue({ ...base, lastSentOn: "2026-03-10" }, at1830)).toBe(false);
    expect(isDue({ ...base, lastSentOn: "2026-03-09" }, at1830)).toBe(true);
  });

  test("inte om man redan har övat i dag", () => {
    expect(isDue({ ...base, practicedOn: "2026-03-10" }, at1830)).toBe(false);
  });

  test("inte långt efter vald tid", () => {
    expect(isDue({ ...base, time: "08:00" }, at1830)).toBe(false);
  });
});

test("validering", () => {
  expect(isValidTime("07:05")).toBe(true);
  expect(isValidTime("24:00")).toBe(false);
  expect(isValidTime("7:05")).toBe(false);
  expect(isValidTimeZone("Europe/Stockholm")).toBe(true);
  expect(isValidTimeZone("Mars/Olympus")).toBe(false);
});
