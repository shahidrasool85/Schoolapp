-- Additive term lifecycle support.
-- Recurring timetable definitions already have effective_from, effective_until
-- and is_active. Terms already have name, academic year, dates and sort_order.
-- Fee schedules already support the required create state.
-- Hard delete of an unused term needs DELETE, matching academic-year unused
-- deletes in 0045. No cascade is added. Do not rewrite 0001–0046.

grant delete on terms to schoolapp_app;
