import express from "express";
import { one, rows, audit } from "./db.js";
import { fail, requirePermission } from "./security.js";
import { z, id } from "./validation.js";

export const assignmentFields = {
  class_ids: z.array(id).max(5000).optional(),
  student_ids: z.array(id).max(5000).optional(),
};

// This runs inside the account transaction. Lock both the selected records and
// existing links so a stale form cannot take another account's assignments.
export async function assignAccountRecords(tx, actor, account, values) {
  const classIds = [...new Set(values.class_ids || [])];
  const studentIds = [...new Set(values.student_ids || [])];
  if (
    (classIds.length && account.role !== "TEACHER") ||
    (studentIds.length && account.role !== "PARENT")
  )
    fail(
      422,
      "Only teachers can be assigned classes and only parents can be linked to children.",
    );
  const teacher = account.role === "TEACHER";
  if (!teacher && account.role !== "PARENT") return;
  const field = teacher ? "class_ids" : "student_ids";
  if (values[field] === undefined) return;
  const ids = teacher ? classIds : studentIds;
  const table = teacher ? "classes" : "students";
  const column = teacher ? "teacher_user_id" : "parent_user_id";
  const records = await rows(
    tx,
    `SELECT id,${column} FROM ${table}
    WHERE school_id=$1 AND (id=ANY($2::int[]) OR ${column}=$3) ORDER BY id FOR UPDATE`,
    [actor.school_id, ids, account.id],
  );
  const byId = new Map(records.map((r) => [r.id, r]));
  if (ids.some((id) => !byId.has(id)))
    fail(422, `Choose ${teacher ? "classes" : "children"} from your school.`);
  if (
    ids.some(
      (id) =>
        byId.get(id)[column] !== null && byId.get(id)[column] !== account.id,
    )
  )
    fail(
      409,
      `One or more ${teacher ? "classes are already assigned to another teacher" : "children are already linked to another parent"}. Refresh the list. Existing links must be changed separately before assigning them here.`,
    );
  const selected = new Set(ids);
  for (const record of records) {
    const next = selected.has(record.id) ? account.id : null;
    if (record[column] === next) continue;
    await tx.query(
      `UPDATE ${table} SET ${column}=$3 WHERE school_id=$1 AND id=$2`,
      [actor.school_id, record.id, next],
    );
    await audit(
      tx,
      actor,
      table,
      record.id,
      teacher ? "TEACHER_ASSIGNED" : "PARENT_LINKED",
      { [column]: record[column] },
      { [column]: next },
    );
  }
}

export function accountAssignmentRoutes(db) {
  const r = express.Router();
  r.get(
    "/users/assignment-options",
    requirePermission("admin.write"),
    async (req, res) => {
      const role = z.enum(["TEACHER", "PARENT"]).parse(req.query.role);
      const accountId = req.query.account_id
        ? id.parse(req.query.account_id)
        : null;
      if (accountId) {
        const account = await one(
          db,
          "SELECT role FROM users WHERE school_id=$1 AND id=$2 AND archived_at IS NULL",
          [req.user.school_id, accountId],
        );
        if (!account) fail(404, "Account not found.");
        if (account.role !== role)
          fail(
            409,
            "This account's role has changed. Reopen the assignment form.",
          );
      }
      const options =
        role === "TEACHER"
          ? await rows(
              db,
              `SELECT c.id,c.name AS label,y.name AS detail,c.teacher_user_id AS assigned_to,u.name AS assigned_name
      FROM classes c JOIN academic_years y ON y.id=c.academic_year_id AND y.school_id=c.school_id
      LEFT JOIN users u ON u.id=c.teacher_user_id AND u.school_id=c.school_id WHERE c.school_id=$1 ORDER BY y.start_date DESC,c.name,c.id`,
              [req.user.school_id],
            )
          : await rows(
              db,
              `SELECT s.id,s.first_name || ' ' || s.last_name AS label,
      concat_ws(' · ',s.student_number,c.name,s.status) AS detail,s.parent_user_id AS assigned_to,u.name AS assigned_name
      FROM students s LEFT JOIN classes c ON c.id=s.class_id AND c.school_id=s.school_id
      LEFT JOIN users u ON u.id=s.parent_user_id AND u.school_id=s.school_id WHERE s.school_id=$1 ORDER BY s.last_name,s.first_name,s.id`,
              [req.user.school_id],
            );
      res.set("Cache-Control", "no-store");
      res.json({
        data: {
          options,
          selected_ids: accountId
            ? options
                .filter((o) => o.assigned_to === accountId)
                .map((o) => o.id)
            : [],
        },
      });
    },
  );
  r.patch(
    "/users/:id/assignments",
    requirePermission("admin.write"),
    async (req, res) => {
      const values = z.object(assignmentFields).strict().parse(req.body);
      const uid = id.parse(req.params.id);
      await db.transaction(async (tx) => {
        const account = await one(
          tx,
          "SELECT id,role FROM users WHERE school_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE",
          [req.user.school_id, uid],
        );
        if (!account) fail(404, "Account not found.");
        if (!["TEACHER", "PARENT"].includes(account.role))
          fail(
            422,
            "Assignments are available for teacher and parent accounts only.",
          );
        if (
          values[account.role === "TEACHER" ? "class_ids" : "student_ids"] ===
          undefined
        )
          fail(
            422,
            "Choose the assignments to save, or an empty selection to remove them.",
          );
        await assignAccountRecords(tx, req.user, account, values);
      });
      res.json({ data: { ok: true } });
    },
  );
  return r;
}
