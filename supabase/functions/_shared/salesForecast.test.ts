import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { projectMonth } from "./salesForecast.ts";

Deno.test("projection blends run-rate and expected renewals", () => {
  const p = projectMonth({
    days_elapsed: 10, days_in_month: 30, collected_mtd: 100000, avg_membership_value: 10000,
    renewal: { this_month_due: 4, this_month_renewed: 2, last_month_due: 6, last_month_renewed: 3, remaining_due: 10 },
  });
  assertEquals(p.renewal_ratio, 0.5);
  assertEquals(p.daily_pace, 10000);
  assertEquals(p.expected_renewals, 50000);
  assertEquals(p.likely, 100000 + 120000 + 50000);
  assertEquals(p.low, 100000 + 80000 + 35000);
  assertEquals(p.high, 100000 + 200000 + 50000);
});

Deno.test("no due memberships means no renewal upside", () => {
  const p = projectMonth({
    days_elapsed: 30, days_in_month: 30, collected_mtd: 5000, avg_membership_value: 9000,
    renewal: { this_month_due: 0, this_month_renewed: 0, last_month_due: 0, last_month_renewed: 0, remaining_due: 3 },
  });
  assertEquals(p.likely, 5000);
  assertEquals(p.high, 5000);
});
