import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateDataset,
  evaluateRevenue,
  evaluateClassifier,
} from "../server/model-service.js";
test("revenue candidates use earlier observations, tune before testing and fail closed without improvement", () => {
  const series = Array.from({ length: 36 }, (_, i) => ({
    month: `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`,
    value: 100000 + (i % 12) * 30000,
  }));
  const result = evaluateRevenue(series);
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.report.method, "SEASONAL_12");
  assert.equal(result.report.mae_cents, 0);
  assert.equal(result.report.backtest.length, 6);
  assert.equal(result.report.experimental_forecast_cents, 100000);
  const perturbed = structuredClone(series);
  perturbed.at(-1).value *= 20;
  const changed = evaluateRevenue(perturbed);
  assert.deepEqual(changed.report.tuning, result.report.tuning);
  assert.equal(
    changed.report.backtest.at(-1).predicted,
    result.report.backtest.at(-1).predicted,
  );
  const constant = evaluateRevenue(series.map((r) => ({ ...r, value: 10000 })));
  assert.equal(constant.status, "BASELINE_NOT_BEATEN");
  assert.equal(constant.report.experimental_forecast_cents, null);
  assert.equal(
    evaluateRevenue(series.slice(0, 23)).status,
    "INSUFFICIENT_DATA",
  );
});
test("historical imports reject gaps, duplicates, future observations, identity columns and temporal leakage", () => {
  assert.throws(() =>
    validateDataset(
      "REVENUE",
      [{ month: "2026-10", value: 100 }],
      "2026-10-02",
    ),
  );
  const record = {
    entity_key: "anon_1",
    snapshot_date: "2020-01-01",
    outcome_date: "2020-02-01",
    outcome: 1,
    attendance_rate: 50,
    average_score: 20,
    prior_failures: 1,
  };
  assert.throws(() =>
    validateDataset("STUDENT_SUPPORT", [record, record], "2026-10-02"),
  );
  assert.throws(() =>
    validateDataset(
      "STUDENT_SUPPORT",
      [{ ...record, outcome_date: record.snapshot_date }],
      "2026-10-02",
    ),
  );
  assert.throws(() =>
    validateDataset(
      "STUDENT_SUPPORT",
      [{ ...record, name: "Student name" }],
      "2026-10-02",
    ),
  );
  assert.equal(
    validateDataset("STUDENT_SUPPORT", [record], "2026-10-02").length,
    1,
  );
});
test("classification training excludes later labels, measures calibration and records reproducible held-out evidence", () => {
  // Synthetic fixtures only: these records are never inserted into school history.
  const records = Array.from({ length: 300 }, (_, i) => {
    const period = Math.floor(i / 30),
      positive = i % 2;
    return {
      entity_key: `fixture_${i}`,
      snapshot_date: `2020-${String(period + 1).padStart(2, "0")}-01`,
      outcome_date: `2020-${String(period + 1).padStart(2, "0")}-20`,
      outcome: positive,
      attendance_rate: positive ? 45 : 95,
      average_score: positive ? 25 : 85,
      prior_failures: positive ? 3 : 0,
    };
  });
  const result = evaluateClassifier("STUDENT_SUPPORT", records);
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.report.counts.training, 180);
  assert.equal(result.report.counts.test, 60);
  assert.equal(result.report.recall, 1);
  assert.ok(result.report.brier < result.report.baseline_brier);
  assert.equal(
    result.report.calibration.reduce((n, r) => n + r.count, 0),
    60,
  );
  const changed = structuredClone(records);
  for (const r of changed.slice(240)) r.outcome = 1 - r.outcome;
  const second = evaluateClassifier("STUDENT_SUPPORT", changed);
  assert.deepEqual(second.artifact, result.artifact);
  assert.equal(second.status, "BASELINE_NOT_BEATEN");
  const leaking = records.map((r) => ({ ...r, outcome_date: "2021-01-01" }));
  assert.equal(
    evaluateClassifier("STUDENT_SUPPORT", leaking).status,
    "INSUFFICIENT_DATA",
  );
  const retention = records.map(({ average_score, prior_failures, ...r }) => ({
    ...r,
    overdue_ratio: r.outcome ? 0.9 : 0.1,
    satisfaction_score: r.outcome ? 1 : 5,
  }));
  assert.equal(
    evaluateClassifier("RETENTION", retention).status,
    "REVIEW_REQUIRED",
  );
});
