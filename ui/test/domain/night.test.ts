import { describe, expect, it } from "vitest";

import { intoWeeks, isoWeek, nightIndex, nightsIn } from "../../src/domain/night";

describe("nightIndex", () => {
  it("names a night by the day you arrive", () => {
    // A booking runs 12:00 to 11:00 the next day, so a Friday date is the
    // fri–sat night — index 4, not 5.
    expect(nightIndex("2026-09-11")).toBe(4);
  });

  it("puts Sunday last, not first", () => {
    expect(nightIndex("2026-09-13")).toBe(6);
  });

  it("puts Monday first", () => {
    expect(nightIndex("2026-09-07")).toBe(0);
  });
});

describe("isoWeek", () => {
  it("counts from the week containing the first Thursday", () => {
    expect(isoWeek("2026-01-01")).toBe(1); // a Thursday
  });

  it("keeps a whole Mon-Sun week on one number", () => {
    const week = [
      "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10",
      "2026-09-11", "2026-09-12", "2026-09-13",
    ].map(isoWeek);
    expect(new Set(week).size).toBe(1);
  });

  it("assigns an early-January date to the previous year's last week", () => {
    // 2027-01-01 is a Friday, so it belongs to 2026's week 53. This is the case
    // a naive implementation gets wrong.
    expect(isoWeek("2027-01-01")).toBe(53);
    expect(isoWeek("2026-12-28")).toBe(53);
  });
});

describe("nightsIn", () => {
  it("is inclusive of both ends", () => {
    expect(nightsIn({ start: "2026-09-07", end: "2026-09-09" })).toEqual([
      "2026-09-07", "2026-09-08", "2026-09-09",
    ]);
  });

  it("crosses a month boundary", () => {
    const nights = nightsIn({ start: "2026-09-29", end: "2026-10-02" });
    expect(nights).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  });
});

describe("intoWeeks", () => {
  it("pads the first row so a night lands under its own weekday", () => {
    // 2026-09-09 is a Wednesday, so two blanks precede it.
    const [first] = intoWeeks(nightsIn({ start: "2026-09-09", end: "2026-09-13" }));
    expect(first!.slice(0, 2)).toEqual([null, null]);
    expect(first![2]).toBe("2026-09-09");
  });

  it("pads the last row to a full week", () => {
    const weeks = intoWeeks(nightsIn({ start: "2026-09-07", end: "2026-09-09" }));
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toHaveLength(7);
    expect(weeks[0]!.slice(3)).toEqual([null, null, null, null]);
  });

  it("has no weeks at all for no nights", () => {
    expect(intoWeeks([])).toEqual([]);
  });
});
