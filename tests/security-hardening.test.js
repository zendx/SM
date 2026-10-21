import assert from "node:assert/strict";
import { test, openTestDatabase } from "./database.js";
import { test as unitTest } from "node:test";
import nodemailer from "nodemailer";
import * as OTPAuth from "otpauth";
import { createApp } from "../server/app.js";
import { one, insert } from "../server/db.js";
import { hashPassword, verifyPassword, digest } from "../server/security.js";
import { seal, unseal, migrateMfaSecrets } from "../server/security-vault.js";
import {
  smtpDestination,
  smtpDns,
  publicAddress,
} from "../server/smtp-policy.js";
import {
  queueVerification,
  deliverVerifications,
} from "../server/verification-delivery.js";
import { reconcileDocumentUploads } from "../server/document-cleanup.js";
import { backupDatabase } from "../server/backup.js";
import {
  encryptBackup,
  decryptBackup,
  fileDigest,
} from "../server/backup-crypto.js";
import { Readable } from "node:stream";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("production authentication protects bootstrap, requires MFA, consumes TOTP and activates by single-use link", async (t) => {
  const db = await openTestDatabase();
  const saved = { ...process.env };
  Object.assign(process.env, {
    APP_URL: "https://smpis.test",
    SMTP_URL: "smtp://mail.test",
    MAIL_FROM: "accounts@smpis.test",
    SECURITY_ENCRYPTION_KEY: "23".repeat(32),
  });
  delete process.env.BOOTSTRAP_TOKEN;
  delete process.env.STOPREG_API_TOKEN;
  delete process.env.RECAPTCHA_SITE_KEY;
  delete process.env.RECAPTCHA_SECRET_KEY;
  const mail = [];
  t.mock.method(nodemailer, "createTransport", () => ({
    sendMail: async (message) => {
      // If SMTP were inside the registration transaction, queued records would be uncommitted.
      assert.ok(
        await one(db, "SELECT id FROM users WHERE email=$1", [message.to]),
      );
      mail.push(message);
      return { rejected: [] };
    },
  }));
  const app = await createApp(db);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const request = async (url, body, session, extra = {}) => {
    const response = await fetch(base + url, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(session
          ? { Cookie: session.cookie, "x-csrf-token": session.csrf }
          : {}),
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json();
    return {
      status: response.status,
      ...payload,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      csrf: payload.data?.csrf,
    };
  };
  const account = {
    name: "Owner",
    email: "owner@security.test",
    password: "Owner-password-2026!",
  };
  try {
    assert.equal((await request("/auth/owner/setup", account)).status, 403);
    process.env.BOOTSTRAP_TOKEN = "b".repeat(64);
    assert.equal(
      (await request("/auth/setup", {}, null, { "x-bootstrap-token": "wrong" }))
        .status,
      403,
    );
    assert.equal(
      (
        await request("/auth/owner/setup", account, null, {
          "x-bootstrap-token": process.env.BOOTSTRAP_TOKEN,
        })
      ).status,
      201,
    );
    const token = new URL(
      mail
        .at(-1)
        .text.match(/https:\/\/\S+/)[0]
        .replace(/\.$/, ""),
    ).searchParams.get("verify");
    assert.equal(
      (await request("/auth/email-verification/confirm", { token })).status,
      200,
    );
    const session = await request("/auth/owner/login", account);
    assert.equal(session.status, 200);
    assert.equal(session.data.user.mfa_setup_required, true);
    assert.equal((await request("/saas/owner", null, session)).status, 403);
    const setup = await request("/auth/mfa/setup", {}, session);
    const user = await one(db, "SELECT * FROM users WHERE email=$1", [
      account.email,
    ]);
    assert.notEqual(user.mfa_secret, setup.data.secret);
    assert.equal(unseal(user.mfa_secret, `mfa:${user.id}`), setup.data.secret);
    assert.throws(() => unseal(user.mfa_secret, `mfa:${user.id + 1}`));
    const otp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(setup.data.secret),
    });
    assert.equal(
      (await request("/auth/mfa/enable", { code: otp.generate() }, session))
        .status,
      200,
    );
    assert.equal((await request("/saas/owner", null, session)).status, 200);
    const second = await request("/auth/owner/login", account);
    assert.equal(second.data.mfa_required, true);
    assert.equal((await request("/saas/owner", null, second)).status, 403);
    const futureCode = otp.generate({ timestamp: Date.now() + 30000 });
    assert.equal(
      (await request("/auth/mfa/verify", { code: futureCode }, second)).status,
      200,
    );
    const third = await request("/auth/owner/login", account);
    assert.equal(
      (await request("/auth/mfa/verify", { code: futureCode }, third)).status,
      422,
    );
    const recovery = await request(
      "/auth/mfa/recovery-codes",
      { password: account.password },
      session,
    );
    assert.equal(
      (
        await request(
          "/auth/mfa/verify",
          { code: recovery.data.codes[0] },
          third,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/auth/mfa/verify",
          { code: recovery.data.codes[0] },
          third,
        )
      ).status,
      422,
    );
    const school = await insert(db, "schools", {
      name: "Security School",
      short_code: "SEC",
      portal_slug: "security-school",
    });
    const created = await request(
      "/users",
      {
        name: "Parent",
        email: "parent@security.test",
        role: "PARENT",
        password: "Never-email-this-2026!",
      },
      session,
      { "x-smpis-portal": school.portal_slug },
    );
    assert.equal(created.status, 201, JSON.stringify(created));
    const activation = mail.at(-1);
    assert.ok(!JSON.stringify(activation).includes("Never-email-this-2026!"));
    const pending = await one(db, "SELECT * FROM users WHERE id=$1", [
      created.data.id,
    ]);
    assert.equal(pending.activation_pending, true);
    assert.equal(
      verifyPassword("Never-email-this-2026!", pending.password_hash),
      false,
    );
    const reset = new URL(
      activation.text.match(/https:\/\/\S+/)[0],
    ).searchParams.get("reset");
    assert.ok(reset);
    const password = "Recipient-password-2026!";
    assert.equal(
      (
        await request("/auth/password-reset/confirm", {
          token: reset,
          password,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/auth/password-reset/confirm", {
          token: reset,
          password,
        })
      ).status,
      422,
    );
    assert.equal(
      (await request("/auth/login", { email: pending.email, password })).status,
      200,
    );
  } finally {
    await new Promise((r) => server.close(r));
    await db.close();
    for (const k of Object.keys(process.env))
      if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("verification failures persist encrypted retryable outbox and legacy MFA migrates safely", async (t) => {
  const db = await openTestDatabase();
  process.env.SECURITY_ENCRYPTION_KEY = "24".repeat(32);
  process.env.SMTP_URL = "smtp://mail.test";
  process.env.MAIL_FROM = "accounts@smpis.test";
  process.env.APP_URL = "https://smpis.test";
  const { seedRoles } = await import("../server/auth.js");
  await seedRoles(db);
  const school = await insert(db, "schools", {
    name: "Migration",
    short_code: "MIG",
  });
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const user = await insert(db, "users", {
    school_id: school.id,
    name: "User",
    email: "migrate@security.test",
    role: "SUPER_ADMIN",
    password_hash: hashPassword("Migration-password!"),
    mfa_secret: secret,
    mfa_enabled: true,
    email_verified: false,
  });
  try {
    await migrateMfaSecrets(db);
    const stored = (
      await one(db, "SELECT mfa_secret FROM users WHERE id=$1", [user.id])
    ).mfa_secret;
    assert.equal(unseal(stored, `mfa:${user.id}`), secret);
    await migrateMfaSecrets(db);
    assert.equal(
      (await one(db, "SELECT mfa_secret FROM users WHERE id=$1", [user.id]))
        .mfa_secret,
      stored,
    );
    await db.transaction((tx) => queueVerification(tx, user));
    const original = await one(db, "SELECT * FROM verification_outbox");
    assert.ok(original.encrypted_token.startsWith("v1:"));
    t.mock.method(nodemailer, "createTransport", () => ({
      sendMail: async () => {
        throw new Error("private provider response");
      },
    }));
    assert.equal(await deliverVerifications(db), 0);
    assert.equal(
      (await one(db, "SELECT attempts FROM verification_outbox")).attempts,
      1,
    );
    await db.query("UPDATE verification_outbox SET next_attempt_at=now()");
    t.mock.method(nodemailer, "createTransport", () => ({
      sendMail: async () => ({ rejected: [] }),
    }));
    assert.equal(await deliverVerifications(db), 1);
    assert.equal(
      await one(db, "SELECT id FROM verification_outbox"),
      undefined,
    );
  } finally {
    await db.close();
  }
});

unitTest(
  "SMTP policy blocks internal addresses and pins approved public resolution",
  async (t) => {
    const previous = process.env.SMTP_ALLOWED_HOSTS;
    process.env.SMTP_ALLOWED_HOSTS = "smtp.example.com";
    try {
      for (const address of [
        "127.0.0.1",
        "10.1.1.1",
        "169.254.169.254",
        "172.16.0.1",
        "192.168.1.1",
        "100.64.0.1",
        "::1",
        "::ffff:127.0.0.1",
        "fc00::1",
        "fe80::1",
        "2001:db8::1",
      ])
        assert.equal(publicAddress(address), false, address);
      await assert.rejects(smtpDestination("127.0.0.1"));
      await assert.rejects(smtpDestination("unapproved.example.com"));
      t.mock.method(smtpDns, "lookup", async () => [
        { address: "10.0.0.1", family: 4 },
      ]);
      await assert.rejects(smtpDestination("smtp.example.com"));
      t.mock.method(smtpDns, "lookup", async () => [
        { address: "8.8.8.8", family: 4 },
      ]);
      assert.equal(await smtpDestination("smtp.example.com"), "8.8.8.8");
    } finally {
      if (previous === undefined) delete process.env.SMTP_ALLOWED_HOSTS;
      else process.env.SMTP_ALLOWED_HOSTS = previous;
    }
  },
);

unitTest(
  "backup encrypts SQL and referenced documents with authenticated recoverable bytes",
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "smpis-backup-test-"),
    );
    const previous = process.env.BACKUP_ENCRYPTION_KEY;
    process.env.BACKUP_ENCRYPTION_KEY = "25".repeat(32);
    const sql = Buffer.from("test SQL dump");
    const bytes = Buffer.from("%PDF-test private document");
    let locked = false;
    const db = {
      transaction: async (fn) =>
        fn({
          query: async (statement) => {
            if (statement.startsWith("LOCK")) {
              locked = true;
              return { rows: [] };
            }
            assert.equal(locked, true);
            return {
              rows: [
                {
                  id: 7,
                  storage_key: "test-object",
                  mime: "application/pdf",
                  size: bytes.length,
                },
              ],
            };
          },
        }),
    };
    try {
      const out = await backupDatabase(db, {
        outputRoot: directory,
        storage: { get: async () => bytes },
        dump: () => Readable.from([sql]),
      });
      const manifest = JSON.parse(
        await readFile(path.join(out, "manifest.json")),
      );
      assert.equal(manifest.status, "COMPLETE");
      for (const entry of manifest.files)
        assert.equal(
          await fileDigest(path.join(out, entry.name)),
          entry.sha256,
        );
      for (const [file, expected] of [
        ["database.dump.enc", sql],
        ["document-7.enc", bytes],
      ]) {
        const decrypted = path.join(directory, file + ".plain");
        await decryptBackup(path.join(out, file), decrypted);
        assert.deepEqual(await readFile(decrypted), expected);
      }
      const encrypted = path.join(directory, "tampered.enc");
      await encryptBackup(Readable.from([bytes]), encrypted);
      const corrupted = await readFile(encrypted);
      corrupted[21] ^= 1;
      await writeFile(encrypted, corrupted);
      await assert.rejects(
        decryptBackup(encrypted, path.join(directory, "tampered.plain")),
      );
      await assert.rejects(readFile(path.join(directory, "tampered.plain")), {
        code: "ENOENT",
      });
      const existing = path.join(directory, "existing-plaintext");
      await writeFile(existing, "preserve this file");
      await assert.rejects(
        decryptBackup(path.join(out, "database.dump.enc"), existing),
        { code: "EEXIST" },
      );
      assert.equal(await readFile(existing, "utf8"), "preserve this file");
    } finally {
      if (previous === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
      else process.env.BACKUP_ENCRYPTION_KEY = previous;
    const cleanup = path.resolve(directory);
    assert.equal(path.dirname(cleanup), path.resolve(os.tmpdir()));
    assert.ok(path.basename(cleanup).startsWith("smpis-backup-test-"));
    await rm(cleanup, { recursive: true, force: true });
    }
  },
);

test("stale document upload intents clean orphans and preserve referenced objects", async () => {
  const db = await openTestDatabase();
  try {
    const school = await insert(db, "schools", {
      name: "Cleanup",
      short_code: "CLN",
    });
    const { seedRoles } = await import("../server/auth.js");
    await seedRoles(db);
    const user = await insert(db, "users", {
      school_id: school.id,
      name: "Admin",
      email: "cleanup@security.test",
      role: "SUPER_ADMIN",
      password_hash: hashPassword("Cleanup-password-2026!"),
    });
    const student = await insert(db, "students", {
      school_id: school.id,
      first_name: "Student",
      last_name: "Cleanup",
      gender: "OTHER",
      date_of_birth: "2015-01-01",
      guardian_name: "Guardian",
      guardian_phone: "01234",
    });
    await insert(db, "student_documents", {
      school_id: school.id,
      student_id: student.id,
      name: "saved.pdf",
      storage_key: "referenced",
      mime: "application/pdf",
      size: 10,
      uploaded_by: user.id,
    });
    await insert(db, "document_upload_intents", {
      storage_key: "referenced",
      school_id: school.id,
      created_at: new Date(Date.now() - 7200000),
    });
    await insert(db, "document_upload_intents", {
      storage_key: "orphan",
      school_id: school.id,
      created_at: new Date(Date.now() - 7200000),
    });
    const deleted = [];
    await reconcileDocumentUploads(db, {
      delete: async (key) => deleted.push(key),
    });
    assert.deepEqual(deleted, ["orphan"]);
    assert.equal(
      await one(db, "SELECT storage_key FROM document_upload_intents"),
      undefined,
    );
  } finally {
    await db.close();
  }
});

test("document audit failure rolls back metadata and compensates uploaded bytes", async (t) => {
  const db = await openTestDatabase();
  const objects = new Map();
  const storage = {
    put: async (key, bytes) => objects.set(key, bytes),
    delete: async (key) => objects.delete(key),
  };
  const faultDb = {
    ...db,
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          ...tx,
          query: (sql, args) => {
            if (sql.startsWith("INSERT INTO audit_logs"))
              throw new Error("injected audit failure");
            return tx.query(sql, args);
          },
        }),
      ),
  };
  t.mock.method(console, "error", () => {});
  const app = await createApp(faultDb, { documentStorage: storage });
  const school = await insert(db, "schools", {
    name: "Upload",
    short_code: "UPL",
  });
  const user = await insert(db, "users", {
    school_id: school.id,
    name: "Admin",
    email: "upload@security.test",
    role: "SUPER_ADMIN",
    password_hash: hashPassword("Upload-password-2026!"),
    mfa_enabled: true,
  });
  const student = await insert(db, "students", {
    school_id: school.id,
    first_name: "Student",
    last_name: "Upload",
    gender: "OTHER",
    date_of_birth: "2015-01-01",
    guardian_name: "Guardian",
    guardian_phone: "01234",
  });
  await insert(db, "sessions", {
    token_hash: digest("upload-test-session"),
    user_id: user.id,
    csrf: "upload-csrf",
    mfa_verified: true,
    expires_at: new Date(Date.now() + 60000),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    const form = new FormData();
    form.append(
      "document",
      new Blob(["%PDF-test"], { type: "application/pdf" }),
      "test.pdf",
    );
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/v1/students/${student.id}/documents`,
      {
        method: "POST",
        headers: {
          Cookie: "smpis_session=upload-test-session",
          "x-csrf-token": "upload-csrf",
        },
        body: form,
      },
    );
    assert.equal(response.status, 500);
    assert.equal(objects.size, 0);
    assert.equal(await one(db, "SELECT id FROM student_documents"), undefined);
    assert.equal(
      await one(db, "SELECT storage_key FROM document_upload_intents"),
      undefined,
    );
  } finally {
    await new Promise((r) => server.close(r));
    await db.close();
  }
});
