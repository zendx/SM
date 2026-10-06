import express from "express";
import { createHash } from "node:crypto";
import { z, id, text } from "./validation.js";
import { rows, insert, audit } from "./db.js";
import { requirePermission, localClock } from "./security.js";
import { schoolRecord, currentSchool } from "./services.js";
import {
  validateDataset,
  evaluateRevenue,
  evaluateClassifier,
  MODEL_VERSION,
  features,
} from "./model-service.js";
export function modelRoutes(db) {
  const r = express.Router(),
    ok = (res, data) => res.json({ data, errors: [] });
  // Evaluation is a school management operation; raw data and fitted coefficients are not exposed to parents or students.
  r.get(
    "/intelligence/models",
    requirePermission("intelligence.manage"),
    async (req, res) =>
      ok(res, {
        version: MODEL_VERSION,
        features,
        datasets: await rows(
          db,
          "SELECT id,kind,name,source_note,checksum,jsonb_array_length(records) AS record_count,created_at FROM intelligence_datasets WHERE school_id=$1 ORDER BY id DESC",
          [req.user.school_id],
        ),
        runs: await rows(
          db,
          "SELECT id,dataset_id,kind,status,report,created_at FROM model_runs WHERE school_id=$1 ORDER BY id DESC LIMIT 50",
          [req.user.school_id],
        ),
      }),
  );
  r.post(
    "/intelligence/datasets",
    requirePermission("intelligence.manage"),
    async (req, res) => {
      const b = z
          .object({
            kind: z.enum(["REVENUE", "STUDENT_SUPPORT", "RETENTION"]),
            name: text,
            source_note: z.string().trim().min(20).max(2000),
            records: z.array(z.unknown()),
            historical_observations_confirmed: z.literal(true),
          })
          .parse(req.body),
        school = await currentSchool(db, req.user),
        records = validateDataset(
          b.kind,
          b.records,
          localClock(school.timezone).date,
        ),
        checksum = createHash("sha256")
          .update(JSON.stringify({ kind: b.kind, records }))
          .digest("hex");
      const d = await db.transaction(async (tx) => {
        const v = await insert(tx, "intelligence_datasets", {
          school_id: req.user.school_id,
          kind: b.kind,
          name: b.name,
          source_note: b.source_note,
          records: JSON.stringify(records),
          checksum,
          created_by: req.user.id,
        });
        await audit(
          tx,
          req.user,
          "intelligence_datasets",
          v.id,
          "IMPORT",
          null,
          {
            kind: b.kind,
            checksum,
            records: records.length,
            source_note: b.source_note,
          },
        );
        return v;
      });
      ok(res, { id: d.id, record_count: records.length, checksum });
    },
  );
  r.post(
    "/intelligence/datasets/:id/evaluate",
    requirePermission("intelligence.manage"),
    async (req, res) => {
      const d = await schoolRecord(
          db,
          req.user,
          "intelligence_datasets",
          id.parse(req.params.id),
        ),
        result =
          d.kind === "REVENUE"
            ? evaluateRevenue(d.records)
            : evaluateClassifier(d.kind, d.records);
      const run = await db.transaction(async (tx) => {
        const v = await insert(tx, "model_runs", {
          school_id: req.user.school_id,
          dataset_id: d.id,
          kind: d.kind,
          status: result.status,
          report: JSON.stringify({
            ...result.report,
            version: MODEL_VERSION,
            dataset_checksum: d.checksum,
            production_enabled: false,
          }),
          artifact: result.artifact ? JSON.stringify(result.artifact) : null,
          created_by: req.user.id,
        });
        await audit(tx, req.user, "model_runs", v.id, "EVALUATE", null, {
          dataset_id: d.id,
          status: result.status,
        });
        return v;
      });
      ok(res, { id: run.id, status: run.status, report: run.report });
    },
  );
  return r;
}
