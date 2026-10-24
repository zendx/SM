import express from "express";
import { one, rows } from "./db.js";
import { requireOwner } from "./platform-access.js";
import { fail, ROLE_PERMISSIONS } from "./security.js";
import { z } from "./validation.js";
import { subscriptionEvent } from "./saas-service.js";

export function customerAccountRoutes(db, { documentStorage } = {}) {
  const r = express.Router();
  r.get("/saas/owner/account-schools", requireOwner, async (req, res) => {
    const search = z
      .string()
      .trim()
      .max(200)
      .parse(req.query.search || "");
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page || 1);
    const where = `NOT EXISTS(SELECT 1 FROM platform_operators p JOIN users o ON o.id=p.user_id WHERE o.school_id=s.id)
      AND (s.name ILIKE $1 OR s.portal_slug ILIKE $1 OR EXISTS(SELECT 1 FROM users u WHERE u.school_id=s.id AND (u.name ILIKE $1 OR u.email ILIKE $1)))`;
    const args = [`%${search}%`];
    const schools = await rows(
      db,
      `SELECT s.id,s.name,s.portal_slug,s.created_at,sub.status,sub.closed_at,
      (SELECT count(*)::int FROM users u WHERE u.school_id=s.id AND u.archived_at IS NULL) AS user_count,
      (SELECT count(*)::int FROM users u WHERE u.school_id=s.id AND u.archived_at IS NOT NULL) AS retained_count,
      (SELECT json_build_object('id',u.id,'name',u.name,'email',u.email,'phone_number',u.phone_number)
        FROM users u WHERE u.school_id=s.id AND u.archived_at IS NULL AND u.role IN ('SUPER_ADMIN','PRINCIPAL','PROPRIETOR')
        ORDER BY CASE WHEN u.role='SUPER_ADMIN' THEN 0 ELSE 1 END,CASE WHEN u.status='ACTIVE' THEN 0 ELSE 1 END,u.id LIMIT 1) AS administrator,
      COALESCE((SELECT json_object_agg(t.role,t.n) FROM (SELECT u.role,count(*)::int AS n FROM users u WHERE u.school_id=s.id AND u.archived_at IS NULL GROUP BY u.role) t),'{}'::json) AS role_counts
      FROM schools s LEFT JOIN school_subscriptions sub ON sub.school_id=s.id WHERE ${where}
      ORDER BY lower(s.name),s.id LIMIT 20 OFFSET $2`,
      [...args, (page - 1) * 20],
    );
    const { total } = await one(
      db,
      `SELECT count(*)::int AS total FROM schools s WHERE ${where}`,
      args,
    );
    res.json({
      data: {
        schools,
        total,
        page,
        page_size: 20,
        roles: Object.keys(ROLE_PERMISSIONS),
      },
    });
  });
  r.get(
    "/saas/owner/users/:id/retained-documents/:document",
    requireOwner,
    async (req, res) => {
      const uid = z.coerce.number().int().positive().parse(req.params.id);
      const did = z.coerce.number().int().positive().parse(req.params.document);
      const doc = await one(
        db,
        `SELECT d.id,d.name,d.mime,d.storage_key,d.school_id FROM staff_documents d
      JOIN staff s ON s.id=d.staff_id AND s.school_id=d.school_id JOIN users u ON u.id=s.user_id
      WHERE u.id=$1 AND d.id=$2 AND u.archived_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM platform_operators p WHERE p.user_id=u.id)`,
        [uid, did],
      );
      if (!doc) fail(404, "Retained document not found.");
      const content = await documentStorage.get(doc.storage_key);
      await subscriptionEvent(
        db,
        doc.school_id,
        req.user.id,
        "RETAINED_ACCOUNT_DOCUMENT_DOWNLOADED",
        { user_id: uid, document_id: did },
      );
      res.type(doc.mime).attachment(doc.name).send(content);
    },
  );
  r.get(
    "/saas/owner/users/:id/retained-record",
    requireOwner,
    async (req, res) => {
      const uid = z.coerce.number().int().positive().parse(req.params.id);
      const download =
        z.enum(["0", "1"]).parse(req.query.download || "0") === "1";
      const user = await one(
        db,
        `SELECT u.id,u.school_id,u.name,u.email,u.role,u.status,u.phone_number,u.address,u.created_at,u.archived_at,u.archive_reason,
      a.name AS archived_by_name,s.name AS school_name,s.portal_slug
      FROM users u JOIN schools s ON s.id=u.school_id LEFT JOIN users a ON a.id=u.archived_by WHERE u.id=$1 AND u.archived_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM platform_operators p WHERE p.user_id=u.id)`,
        [uid],
      );
      if (!user) fail(404, "Retained account record not found.");
      const archive = await one(
        db,
        "SELECT record FROM account_archives WHERE school_id=$1 AND user_id=$2",
        [user.school_id, uid],
      );
      if (archive) {
        if (download) {
          await subscriptionEvent(
            db,
            user.school_id,
            req.user.id,
            "RETAINED_ACCOUNT_RECORD_EXPORTED",
            { user_id: uid },
          );
          return res
            .attachment(`retained-account-${uid}.json`)
            .json({ ...archive.record, exported_at: new Date().toISOString() });
        }
        return res.json({
          data: {
            ...archive.record,
            attendance: archive.record.attendance.slice(0, 20),
          },
        });
      }

      const staff = await one(
        db,
        "SELECT * FROM staff WHERE school_id=$1 AND user_id=$2",
        [user.school_id, uid],
      );
      const profile = staff
        ? await one(
            db,
            "SELECT * FROM staff_profiles WHERE school_id=$1 AND staff_id=$2",
            [user.school_id, staff.id],
          )
        : null;
      const attendance = staff
        ? await rows(
            db,
            `SELECT * FROM staff_attendance WHERE school_id=$1 AND staff_id=$2 ORDER BY attendance_date DESC,id DESC ${download ? "" : "LIMIT 20"}`,
            [user.school_id, staff.id],
          )
        : [];
      const counts = staff
        ? await one(
            db,
            `SELECT (SELECT count(*)::int FROM staff_attendance WHERE staff_id=$1) AS attendance,
      (SELECT count(*)::int FROM leave_requests WHERE staff_id=$1) AS leave_requests,
      (SELECT count(*)::int FROM performance_reviews WHERE staff_id=$1) AS reviews,
      (SELECT count(*)::int FROM staff_documents WHERE staff_id=$1) AS documents`,
            [staff.id],
          )
        : { attendance: 0, leave_requests: 0, reviews: 0, documents: 0 };
      const assignments = await rows(
        db,
        `SELECT cs.id,c.name AS class_name,s.name AS subject_name,y.name AS academic_year
      FROM class_subjects cs JOIN classes c ON c.id=cs.class_id JOIN subjects s ON s.id=cs.subject_id JOIN academic_years y ON y.id=c.academic_year_id
      WHERE cs.school_id=$1 AND cs.teacher_user_id=$2 ORDER BY y.start_date DESC,c.name,s.name`,
        [user.school_id, uid],
      );
      const documents = staff
        ? await rows(
            db,
            "SELECT id,name,category,mime,size,created_at FROM staff_documents WHERE school_id=$1 AND staff_id=$2 ORDER BY id",
            [user.school_id, staff.id],
          )
        : [];
      const data = {
        user,
        staff,
        profile,
        counts,
        attendance,
        assignments,
        documents,
      };
      if (download) {
        data.leave_requests = staff
          ? await rows(
              db,
              "SELECT * FROM leave_requests WHERE school_id=$1 AND staff_id=$2 ORDER BY id",
              [user.school_id, staff.id],
            )
          : [];
        data.reviews = staff
          ? await rows(
              db,
              "SELECT * FROM performance_reviews WHERE school_id=$1 AND staff_id=$2 ORDER BY id",
              [user.school_id, staff.id],
            )
          : [];
        data.exported_at = new Date().toISOString();
        await subscriptionEvent(
          db,
          user.school_id,
          req.user.id,
          "RETAINED_ACCOUNT_RECORD_EXPORTED",
          { user_id: uid },
        );
        return res.attachment(`retained-account-${uid}.json`).json(data);
      }
      res.json({ data });
    },
  );
  return r;
}
