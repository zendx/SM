import express from "express";
import { one, rows } from "./db.js";
import { fail } from "./security.js";
import { id, z } from "./validation.js";
import { notifyUser } from "./operations-service.js";

// Resolve relationships from current enrolment and teaching assignments on every
// request, including reads. A changed school/child assignment revokes access.
async function contacts(db, user) {
  return rows(
    db,
    `SELECT s.id AS student_id,s.first_name || ' ' || s.last_name AS student_name,
    p.id AS parent_user_id,p.name AS parent_name,u.id AS staff_user_id,u.name AS staff_name,u.role AS staff_role,
    CASE WHEN p.id=$2 THEN u.id ELSE p.id END AS recipient_id,
    CASE WHEN p.id=$2 THEN u.name ELSE p.name END AS recipient_name,
    CASE WHEN p.id=$2 THEN u.role ELSE p.role END AS recipient_role,
    EXISTS(SELECT 1 FROM sessions se WHERE se.user_id=CASE WHEN p.id=$2 THEN u.id ELSE p.id END
      AND se.expires_at>now() AND se.mfa_verified AND se.last_seen_at>now()-interval '45 seconds') AS online
    FROM students s JOIN users p ON p.id=s.parent_user_id AND p.school_id=s.school_id
    JOIN users u ON u.school_id=s.school_id AND u.id<>p.id
    WHERE s.school_id=$1 AND s.status='ENROLLED' AND p.role='PARENT' AND p.status='ACTIVE' AND p.archived_at IS NULL
    AND u.status='ACTIVE' AND u.archived_at IS NULL AND ${user.role === "PARENT" ? "p.id=$2" : "u.id=$2"}
    AND NOT EXISTS(SELECT 1 FROM platform_operators po WHERE po.user_id=u.id)
    AND NOT EXISTS(SELECT 1 FROM platform_staff ps WHERE ps.user_id=u.id)
    AND (u.role IN ('SUPER_ADMIN','PRINCIPAL','PROPRIETOR') OR (u.role='TEACHER' AND (
      EXISTS(SELECT 1 FROM classes c WHERE c.school_id=s.school_id AND c.id=s.class_id AND c.teacher_user_id=u.id)
      OR EXISTS(SELECT 1 FROM class_subjects cs WHERE cs.school_id=s.school_id AND cs.class_id=s.class_id AND cs.teacher_user_id=u.id))))
    ORDER BY s.first_name,u.name,p.name`,
    [user.school_id, user.id],
  );
}
async function access(db, user, conversationId, lock = false) {
  const thread = await one(
    db,
    `SELECT * FROM school_conversations WHERE school_id=$1 AND id=$2
    AND (parent_user_id=$3 OR staff_user_id=$3)${lock ? " FOR UPDATE" : ""}`,
    [user.school_id, conversationId, user.id],
  );
  if (!thread) fail(404, "Conversation not found.");
  const contact = (await contacts(db, user)).find(
    (c) =>
      c.student_id === thread.student_id &&
      c.parent_user_id === thread.parent_user_id &&
      c.staff_user_id === thread.staff_user_id,
  );
  if (!contact)
    fail(403, "This conversation is no longer available to your account.");
  return { ...thread, ...contact, id: thread.id };
}
export function messagingRoutes(db) {
  const r = express.Router();
  r.use("/messages", (req, res, next) => {
    if (
      !req.user.school_id ||
      !["PARENT", "TEACHER", "PRINCIPAL", "PROPRIETOR", "SUPER_ADMIN"].includes(
        req.user.role,
      )
    )
      return next(
        Object.assign(
          new Error("Messaging is not available to your account."),
          { status: 403 },
        ),
      );
    res.set("Cache-Control", "no-store");
    next();
  });
  r.get("/messages/contacts", async (req, res) =>
    res.json({ data: await contacts(db, req.user) }),
  );
  r.get("/messages", async (req, res) => {
    const allowed = await contacts(db, req.user);
    const byRelationship = new Map(
      allowed.map((c) => [
        `${c.student_id}:${c.parent_user_id}:${c.staff_user_id}`,
        c,
      ]),
    );
    const threads = await rows(
      db,
      `SELECT c.*,
      (SELECT body FROM school_messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
      (SELECT count(*)::int FROM school_messages m WHERE m.conversation_id=c.id AND m.recipient_id=$2 AND m.read_at IS NULL) AS unread_count
      FROM school_conversations c WHERE c.school_id=$1 AND (c.parent_user_id=$2 OR c.staff_user_id=$2)
      ORDER BY c.updated_at DESC,c.id DESC`,
      [req.user.school_id, req.user.id],
    );
    res.json({
      data: threads.flatMap((t) => {
        const contact = byRelationship.get(
          `${t.student_id}:${t.parent_user_id}:${t.staff_user_id}`,
        );
        return contact ? [{ ...t, ...contact, id: t.id }] : [];
      }),
    });
  });
  r.post("/messages", async (req, res) => {
    const b = z
      .object({ student_id: id, recipient_id: id })
      .strict()
      .parse(req.body);
    const contact = (await contacts(db, req.user)).find(
      (c) => c.student_id === b.student_id && c.recipient_id === b.recipient_id,
    );
    if (!contact)
      fail(
        403,
        "Choose a parent, assigned teacher or school leader linked to this child.",
      );
    const thread = await one(
      db,
      `INSERT INTO school_conversations(school_id,student_id,parent_user_id,staff_user_id)
      VALUES($1,$2,$3,$4) ON CONFLICT(school_id,student_id,parent_user_id,staff_user_id)
      DO UPDATE SET student_id=EXCLUDED.student_id RETURNING *`,
      [
        req.user.school_id,
        b.student_id,
        contact.parent_user_id,
        contact.staff_user_id,
      ],
    );
    res.json({ data: { ...thread, ...contact, id: thread.id } });
  });
  r.get("/messages/:id", async (req, res) => {
    const thread = await access(db, req.user, id.parse(req.params.id));
    const before = req.query.before ? id.parse(req.query.before) : null;
    const messages = await rows(
      db,
      `SELECT id,sender_id,recipient_id,body,read_at,created_at,client_key
      FROM school_messages WHERE school_id=$1 AND conversation_id=$2 AND ($3::int IS NULL OR id<$3)
      ORDER BY id DESC LIMIT 100`,
      [req.user.school_id, thread.id, before],
    );
    res.json({
      data: {
        conversation: thread,
        messages: messages.reverse(),
        has_more: messages.length === 100,
      },
    });
  });
  r.post("/messages/:id/send", async (req, res) => {
    const b = z
      .object({
        body: z.string().trim().min(1).max(4000),
        client_key: z.string().uuid(),
      })
      .strict()
      .parse(req.body);
    const message = await db.transaction(async (tx) => {
      const thread = await access(tx, req.user, id.parse(req.params.id), true);
      const recipient = thread.recipient_id;
      const saved = await one(
        tx,
        `INSERT INTO school_messages(school_id,conversation_id,sender_id,recipient_id,body,client_key)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(conversation_id,sender_id,client_key) DO NOTHING RETURNING *`,
        [
          req.user.school_id,
          thread.id,
          req.user.id,
          recipient,
          b.body,
          b.client_key,
        ],
      );
      if (!saved)
        return one(
          tx,
          "SELECT * FROM school_messages WHERE conversation_id=$1 AND sender_id=$2 AND client_key=$3",
          [thread.id, req.user.id, b.client_key],
        );
      await tx.query(
        "UPDATE school_conversations SET updated_at=now() WHERE id=$1",
        [thread.id],
      );
      await notifyUser(
        tx,
        req.user.school_id,
        recipient,
        `New message from ${req.user.name}`,
        `${thread.student_name}: ${b.body}`,
        `chat:${thread.id}:${saved.id}:${recipient}`,
        `#conversations/${thread.id}`,
      );
      return saved;
    });
    res.json({ data: message });
  });
  r.post("/messages/:id/read", async (req, res) => {
    const b = z.object({ through_id: id }).strict().parse(req.body);
    await db.transaction(async (tx) => {
      const thread = await access(tx, req.user, id.parse(req.params.id), true);
      await tx.query(
        `UPDATE school_messages SET read_at=COALESCE(read_at,now())
        WHERE school_id=$1 AND conversation_id=$2 AND recipient_id=$3 AND id<=$4 AND read_at IS NULL`,
        [req.user.school_id, thread.id, req.user.id, b.through_id],
      );
      await tx.query(
        `UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE school_id=$1 AND user_id=$2
        AND dedupe_key IN (SELECT 'chat:' || conversation_id || ':' || id || ':' || recipient_id FROM school_messages
          WHERE conversation_id=$3 AND recipient_id=$2 AND id<=$4) AND read_at IS NULL`,
        [req.user.school_id, req.user.id, thread.id, b.through_id],
      );
    });
    res.json({ data: { ok: true } });
  });
  return r;
}
