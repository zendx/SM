import { z, date, text } from "./validation.js";
import { fail } from "./security.js";
export const MODEL_VERSION = "smpis-evaluation-1";
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const features = {
  STUDENT_SUPPORT: ["attendance_rate", "average_score", "prior_failures"],
  RETENTION: ["attendance_rate", "overdue_ratio", "satisfaction_score"],
};
export function validateDataset(kind, input, today) {
  let records;
  if (kind === "REVENUE") {
    records = z
      .array(
        z.object({ month, value: z.number().int().min(0).max(1e12) }).strict(),
      )
      .min(1)
      .max(120)
      .parse(input)
      .sort((a, b) => a.month.localeCompare(b.month));
    for (let i = 0; i < records.length; i++) {
      if (records[i].month >= today.slice(0, 7))
        fail(422, "Use complete past calendar months only.");
      if (i) {
        const prev = new Date(records[i - 1].month + "-01T12:00:00Z");
        prev.setUTCMonth(prev.getUTCMonth() + 1);
        if (prev.toISOString().slice(0, 7) !== records[i].month)
          fail(
            422,
            "Revenue months must be unique and consecutive. Include verified zero months explicitly.",
          );
      }
    }
  } else {
    const common = {
      entity_key: text.regex(/^[a-zA-Z0-9_-]+$/).max(80),
      snapshot_date: date,
      outcome_date: date,
      outcome: z.number().int().min(0).max(1),
      attendance_rate: z.number().min(0).max(100),
    };
    const schema = z
      .object({
        ...common,
        ...(kind === "STUDENT_SUPPORT"
          ? {
              average_score: z.number().min(0).max(100),
              prior_failures: z.number().int().min(0).max(10),
            }
          : {
              overdue_ratio: z.number().min(0).max(1),
              satisfaction_score: z.number().min(1).max(5),
            }),
      })
      .strict();
    records = z
      .array(schema)
      .min(1)
      .max(2000)
      .parse(input)
      .sort(
        (a, b) =>
          a.snapshot_date.localeCompare(b.snapshot_date) ||
          a.entity_key.localeCompare(b.entity_key),
      );
    if (new Set(records.map((r) => r.entity_key)).size !== records.length)
      fail(
        422,
        "Use one observation per pseudonymous student or family to prevent entity leakage.",
      );
    for (const r of records)
      if (r.outcome_date <= r.snapshot_date || r.outcome_date >= today)
        fail(
          422,
          "Outcomes must be observed after the feature snapshot and before today.",
        );
  }
  return records;
}
const mean = (a) => a.reduce((n, v) => n + v, 0) / a.length;
const mse = (actual, pred) => mean(actual.map((v, i) => (v - pred[i]) ** 2));
const mae = (actual, pred) => mean(actual.map((v, i) => Math.abs(v - pred[i])));
const clamp = (v) => Math.max(0, Math.min(1e12, Math.round(v)));
const revenueMethods = {
  MEAN_3: (a) => mean(a.slice(-3)),
  SEASONAL_12: (a) => a[a.length - 12],
  DAMPED_TREND_12: (a) => {
    const y = a.slice(-12),
      n = y.length,
      xmean = (n - 1) / 2,
      ymean = mean(y);
    let top = 0,
      bottom = 0;
    for (let i = 0; i < n; i++) {
      top += (i - xmean) * (y[i] - ymean);
      bottom += (i - xmean) ** 2;
    }
    return ymean + (top / bottom) * (n - 1 - xmean + 0.5);
  },
};
export function evaluateRevenue(records) {
  if (records.length < 24)
    return {
      status: "INSUFFICIENT_DATA",
      report: {
        required_months: 24,
        available_months: records.length,
        reason:
          "Need 12 initial months, at least six tuning months and six untouched test months.",
      },
      artifact: null,
    };
  const values = records.map((r) => r.value),
    testStart = records.length - 6;
  const rolling = (name, start, end) =>
    Array.from({ length: end - start }, (_, i) => {
      const at = start + i;
      return {
        month: records[at].month,
        actual: values[at],
        predicted: clamp(revenueMethods[name](values.slice(0, at))),
      };
    });
  const tuning = Object.keys(revenueMethods)
    .map((method) => {
      const p = rolling(method, 12, testStart);
      return {
        method,
        mae_cents: mae(
          p.map((r) => r.actual),
          p.map((r) => r.predicted),
        ),
      };
    })
    .sort((a, b) => a.mae_cents - b.mae_cents);
  const selected = tuning[0].method,
    backtest = rolling(selected, testStart, records.length),
    baseline = rolling("MEAN_3", testStart, records.length),
    score = mae(
      backtest.map((r) => r.actual),
      backtest.map((r) => r.predicted),
    ),
    baseScore = mae(
      baseline.map((r) => r.actual),
      baseline.map((r) => r.predicted),
    );
  const passed =
    selected !== "MEAN_3" && baseScore > 0 && score <= baseScore * 0.95;
  return {
    status: passed ? "REVIEW_REQUIRED" : "BASELINE_NOT_BEATEN",
    report: {
      method: selected,
      tuning,
      test_start: records[testStart].month,
      test_months: 6,
      mae_cents: score,
      baseline_mae_cents: baseScore,
      backtest,
      gate: "At least 5% lower test MAE than the three-month mean baseline.",
      experimental_forecast_cents: passed
        ? clamp(revenueMethods[selected](values))
        : null,
      reason: passed
        ? "Historical gate passed; source quality and live performance still need review."
        : "No advanced forecast released because the held-out baseline improvement gate failed.",
    },
    artifact: { method: selected, version: MODEL_VERSION },
  };
}
const sigmoid = (x) => 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, x))));
function fit(records, keys, lambda) {
  const means = keys.map((k) => mean(records.map((r) => r[k]))),
    scales = keys.map(
      (k, j) =>
        Math.sqrt(mean(records.map((r) => (r[k] - means[j]) ** 2))) || 1,
    ),
    x = records.map((r) => [
      1,
      ...keys.map((k, j) => (r[k] - means[j]) / scales[j]),
    ]);
  const weights = Array(keys.length + 1).fill(0);
  for (let step = 0; step < 800; step++) {
    const gradient = weights.map(() => 0);
    for (let i = 0; i < x.length; i++) {
      const diff =
        sigmoid(x[i].reduce((s, v, j) => s + v * weights[j], 0)) -
        records[i].outcome;
      for (let j = 0; j < weights.length; j++)
        gradient[j] += (diff * x[i][j]) / x.length;
    }
    for (let j = 0; j < weights.length; j++)
      weights[j] -= 0.1 * (gradient[j] + (j ? lambda * weights[j] : 0));
  }
  return {
    features: keys,
    means,
    scales,
    weights,
    lambda,
    version: MODEL_VERSION,
  };
}
function predict(model, r) {
  return sigmoid(
    model.weights[0] +
      model.features.reduce(
        (s, k, j) =>
          s +
          ((r[k] - model.means[j]) / model.scales[j]) * model.weights[j + 1],
        0,
      ),
  );
}
export function evaluateClassifier(kind, records) {
  const periods = [...new Set(records.map((r) => r.snapshot_date))],
    validStart = periods[Math.floor(periods.length * 0.6)],
    testStart = periods[Math.floor(periods.length * 0.8)];
  const train = records.filter(
      (r) => r.snapshot_date < validStart && r.outcome_date < validStart,
    ),
    valid = records.filter(
      (r) =>
        r.snapshot_date >= validStart &&
        r.snapshot_date < testStart &&
        r.outcome_date < testStart,
    ),
    test = records.filter((r) => r.snapshot_date >= testStart);
  const counts = {
    training: train.length,
    tuning: valid.length,
    test: test.length,
    purged: records.length - train.length - valid.length - test.length,
  };
  const balanced = (set, min) =>
    [0, 1].every(
      (label) => set.filter((r) => r.outcome === label).length >= min,
    );
  if (
    periods.length < 5 ||
    train.length < 100 ||
    valid.length < 30 ||
    test.length < 30 ||
    !balanced(train, 10) ||
    !balanced(valid, 5) ||
    !balanced(test, 5)
  )
    return {
      status: "INSUFFICIENT_DATA",
      report: {
        counts,
        reason:
          "Need at least five snapshot dates, 100 training, 30 tuning and 30 test records after temporal purging; each class needs 10 training and 5 tuning/test examples. Each entity may appear once.",
      },
      artifact: null,
    };
  const tuned = [0.01, 0.1, 1]
      .map((lambda) => {
        const model = fit(train, features[kind], lambda);
        return {
          model,
          brier: mse(
            valid.map((r) => r.outcome),
            valid.map((r) => predict(model, r)),
          ),
        };
      })
      .sort((a, b) => a.brier - b.brier),
    model = tuned[0].model,
    p = test.map((r) => predict(model, r)),
    y = test.map((r) => r.outcome),
    prior = mean(train.map((r) => r.outcome)),
    score = mse(y, p),
    baseline = mse(
      y,
      y.map(() => prior),
    );
  let tp = 0,
    fp = 0,
    fn = 0,
    tn = 0;
  y.forEach((v, i) => {
    if (p[i] >= 0.5) {
      if (v) tp++;
      else fp++;
    } else if (v) fn++;
    else tn++;
  });
  const calibration = Array.from({ length: 5 }, (_, bin) => {
    const ix = p
      .map((v, i) => ({ v, i }))
      .filter(({ v }) => Math.min(4, Math.floor(v * 5)) === bin);
    return {
      range: `${bin * 0.2}-${(bin + 1) * 0.2}`,
      count: ix.length,
      mean_probability: ix.length ? mean(ix.map(({ v }) => v)) : null,
      observed_rate: ix.length ? mean(ix.map(({ i }) => y[i])) : null,
    };
  });
  const passed = baseline > 0 && score <= baseline * 0.95;
  return {
    status: passed ? "REVIEW_REQUIRED" : "BASELINE_NOT_BEATEN",
    report: {
      counts,
      method: "L2 logistic regression",
      test_start: testStart,
      validation_start: validStart,
      brier: score,
      baseline_brier: baseline,
      threshold: 0.5,
      confusion: { tp, fp, fn, tn },
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
      calibration,
      coefficients: features[kind].map((feature, j) => ({
        feature,
        standardized_weight: model.weights[j + 1],
      })),
      tuning: tuned.map((t) => ({ lambda: t.model.lambda, brier: t.brier })),
      gate: "At least 5% lower test Brier score than training prevalence baseline.",
      reason: passed
        ? "Historical gate passed. Review data representativeness, calibration and prospective performance before use."
        : "The candidate did not improve sufficiently on the held-out baseline.",
    },
    artifact: model,
  };
}
