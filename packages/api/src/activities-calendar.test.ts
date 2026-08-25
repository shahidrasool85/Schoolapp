import { describe, expect, it } from "vitest";
import { calendarItemsFromActivities } from "./activities-portal";

describe("calendarItemsFromActivities", () => {
  it("expands recurring clubs from pg Date values instead of Date.toString() slices", () => {
    const items = calendarItemsFromActivities(
      [
        {
          id: "club-1",
          title: "Chess Club",
          description: null,
          activity_type_key: "club",
          activity_type_name: "Club",
          status: "published",
          starts_at: new Date("2026-09-08T15:30:00.000Z"),
          ends_at: new Date("2026-09-08T16:30:00.000Z"),
          all_day: false,
          location: "Hall",
          occurrence_kind: "recurring",
          recurrence_weekdays: [2],
          recurrence_until: new Date("2026-09-22T00:00:00.000Z"),
        },
      ],
      "2026-09-01",
      "2026-09-30",
    );
    expect(items.map((row) => row.startsAt.slice(0, 10))).toEqual(["2026-09-08", "2026-09-15", "2026-09-22"]);
    expect(items.every((row) => row.source === "activity" && row.id === "club-1")).toBe(true);
  });
});
