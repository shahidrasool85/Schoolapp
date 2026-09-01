"use client";

import { addIsoDays, startOfIsoWeek } from "../lib/dates";

export function TimetableWeekNav({
  weekFrom,
  today,
  inputId,
  onWeekChange,
}: {
  weekFrom: string;
  today: string;
  inputId: string;
  onWeekChange: (nextMonday: string) => void;
}) {
  const thisWeek = startOfIsoWeek(today);
  return (
    <>
      <div className="page-header-actions" role="group" aria-label="Week navigation">
        <button type="button" className="secondary" onClick={() => onWeekChange(addIsoDays(weekFrom, -7))}>
          ← Previous week
        </button>
        <button type="button" className="secondary" onClick={() => onWeekChange(thisWeek)}>
          This week
        </button>
        <button type="button" className="secondary" onClick={() => onWeekChange(addIsoDays(weekFrom, 7))}>
          Next week →
        </button>
      </div>
      <label htmlFor={inputId}>
        Week commencing
        <input
          id={inputId}
          type="date"
          value={weekFrom}
          onChange={(event) => onWeekChange(startOfIsoWeek(event.target.value))}
        />
      </label>
    </>
  );
}
