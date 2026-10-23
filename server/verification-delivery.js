import nodemailer from "nodemailer";
import { smtpConfig } from "./integrations.js";
import { insert, rows, one } from "./db.js";
import { token, digest, fail } from "./security.js";
import { seal, unseal } from "./security-vault.js";
import { renderEmail } from "./email-templates.js";

export async function verificationMailer(db) {
  const smtp = await smtpConfig(db, null);
  if (!smtp || !process.env.APP_URL)
    fail(
      503,
      "Registration email is not configured. Contact the platform owner.",
    );
  return { smtp, url: new URL("/login", process.env.APP_URL) };
}
// Only encrypted delivery material is persisted inside the registration transaction.
export async function queueVerification(db, user) {
  const raw = token();
  await insert(db, "email_verification_tokens", {
    token_hash: digest(raw),
    user_id: user.id,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  await insert(db, "verification_outbox", {
    user_id: user.id,
    token_hash: digest(raw),
    encrypted_token: seal(raw, `verification:${user.id}`),
  });
}
// Delivery is claimed after commit, never while holding registration locks.
export async function deliverVerifications(db, userId = null) {
  const candidates = await rows(
    db,
    `SELECT o.id FROM verification_outbox o
    JOIN email_verification_tokens t ON t.token_hash=o.token_hash JOIN users u ON u.id=o.user_id
    WHERE NOT u.email_verified AND u.status='ACTIVE' AND t.expires_at>now()
      AND o.attempts<5 AND o.next_attempt_at<=now()
      AND (o.claimed_until IS NULL OR o.claimed_until<=now())
      AND ($1::int IS NULL OR o.user_id=$1) ORDER BY o.id LIMIT 50`,
    [userId],
  );
  let sent = 0;
  for (const candidate of candidates) {
    const claim = token();
    const item = await one(
      db,
      `UPDATE verification_outbox SET claim_token=$2,claimed_until=now()+interval '2 minutes'
      WHERE id=$1 AND attempts<5 AND next_attempt_at<=now()
        AND (claimed_until IS NULL OR claimed_until<=now()) RETURNING *`,
      [candidate.id, claim],
    );
    if (!item) continue;
    let transport;
    try {
      const user = await one(
        db,
        "SELECT id,school_id,name,email,email_verified,status FROM users WHERE id=$1",
        [item.user_id],
      );
      if (!user || user.email_verified || user.status !== "ACTIVE") {
        await db.query(
          "DELETE FROM verification_outbox WHERE id=$1 AND claim_token=$2",
          [item.id, claim],
        );
        continue;
      }
      const { smtp, url } = await verificationMailer(db);
      url.searchParams.set(
        "verify",
        unseal(item.encrypted_token, `verification:${user.id}`),
      );
      let options = smtp.transport;
      const timeouts = {
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      };
      if (typeof options === "string") {
        const config = new URL(options);
        for (const [key, value] of Object.entries(timeouts))
          config.searchParams.set(key, String(value));
        options = config.href;
      } else options = { ...options, ...timeouts };
      transport = nodemailer.createTransport(options);
      const result = await transport.sendMail({
        from: smtp.from,
        to: user.email,
        ...(await renderEmail(db, "verification", {
          school_id: user.school_id,
          name: user.name,
          link: url.href,
        })),
      });
      if (result?.rejected?.length) throw new Error("Delivery rejected");
      await db.query(
        "DELETE FROM verification_outbox WHERE id=$1 AND claim_token=$2",
        [item.id, claim],
      );
      sent++;
    } catch {
      console.error("Verification email delivery failed; queued for retry.");
      await db.query(
        `UPDATE verification_outbox SET attempts=attempts+1,
        next_attempt_at=now()+interval '5 minutes',claim_token=NULL,claimed_until=NULL
        WHERE id=$1 AND claim_token=$2`,
        [item.id, claim],
      );
    } finally {
      transport?.close?.();
    }
  }
  return sent;
}
export async function sendVerification(db, user) {
  await verificationMailer(db);
  await db.transaction((tx) => queueVerification(tx, user));
  return deliverVerifications(db, user.id);
}
