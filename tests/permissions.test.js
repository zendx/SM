import { testMailbox } from "./mailbox.js";
testMailbox();
import { openTestDatabase } from "./database.js";
import { test, before, after } from "./database.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { insert } from "../server/db.js";
import { createApp } from "../server/app.js";
import {
  ROLE_PERMISSIONS,
  hashPassword,
  permitted,
} from "../server/security.js";

process.env.REQUIRE_MFA = "false";
let db, server, base, term;
const clients = new Map();
const password = "Permission-test-2026!";

before(async () => {
  db = await openTestDatabase();
  const app = await createApp(db, { dataDir: "test-results/permissions" });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const setup = await fetch(`${base}/auth/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      school_name: "Permission Academy",
      short_code: "PERM",
      currency_code: "NGN",
      timezone: "Africa/Lagos",
      name: "Operator",
      email: "operator@permissions.test",
      password,
      year_name: "2026/2027",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
    }),
  });
  assert.equal(setup.status, 201, await setup.text());
  const school = (await db.query("SELECT id FROM schools")).rows[0];
  term = (await db.query("SELECT id FROM terms")).rows[0].id;
  const passwordHash = hashPassword(password);
  // Even the Super Admin here is a school account, without platform designation.
  for (const role of Object.keys(ROLE_PERMISSIONS)) {
    const email = `${role.toLowerCase()}@permissions.test`;
    await insert(db, "users", {
      school_id: school.id,
      name: role,
      email,
      password_hash: passwordHash,
      role,
      status: "ACTIVE",
    });
    const login = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(login.status, 200, await login.clone().text());
    const { data } = await login.json();
    clients.set(role, {
      cookie: login.headers.get("set-cookie").split(";")[0],
      ...data,
    });
  }
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db) await db.close();
});

async function request(client, path, method = "GET") {
  return fetch(base + path, {
    method,
    headers: {
      Cookie: client.cookie,
      "x-csrf-token": client.csrf,
      "Content-Type": "application/json",
    },
    body: method === "GET" ? undefined : "{}",
  });
}

// Exercise both sides of the policy through real authentication and database queries.
const readRoutes = [
  ["/students", ["students.read", "children.read"]],
  ["/admissions/applications", ["admissions.write"]],
  [
    "/classes",
    [
      "students.read",
      "attendance.read",
      "finance.read",
      "admin.write",
      "classes.write",
    ],
  ],
  ["/hr/staff", ["staff.read", "staff.attendance.read", "staff.self"]],
  ["/attendance/staff", ["staff.attendance.read", "staff.self"]],
  ["/finance/fee-structures", ["finance.read"]],
  ["/finance/invoices", ["finance.read", "finance.own"]],
  [
    "/academics/setup",
    [
      "academics.read",
      "analytics.summary",
      "curriculum.read",
      "curriculum.summary",
    ],
  ],
  ["/subjects", ["academics.read", "curriculum.read"]],
  ["/analytics/academics", ["analytics.read", "analytics.summary"]],
  ["/analytics/academics/at-risk", ["analytics.read"]],
  [
    "/operations/setup",
    ["operations.staff", "experience.own", "operations.summary"],
  ],
  ["/hr/overview", ["operations.staff"]],
  ["/hr/calendar", ["operations.staff"]],
  ["/surveys", ["experience.own", "complaints.manage", "operations.summary"]],
  ["/intelligence", ["intelligence.read"]],
  ["/users", ["admin.write"]],
  ["/audit", ["admin.write"]],
  ["/dashboard/executive", ["dashboard.read", "finance.summary"]],
];

test("each role can read its permitted routes and is denied other roles' routes", async () => {
  for (const [role, client] of clients) {
    for (const [path, permissions] of readRoutes) {
      const response = await request(client, `${path}?term_id=${term}`);
      const body = await response.text();
      const expected = permissions.some((p) => permitted(client.user, p))
        ? 200
        : 403;
      assert.equal(response.status, expected, `${role} GET ${path}: ${body}`);
    }
  }
});

test("all declared permission guards reject unauthorized roles before reading or mutating records", async () => {
  const files = [
    "auth.js",
    "routes.js",
    "academic-routes.js",
    "operations-routes.js",
    "refinement-routes.js",
    "model-routes.js",
    "intelligence.js",
  ];
  let checked = 0;
  for (const file of files) {
    const source = await readFile(
      new URL(`../server/${file}`, import.meta.url),
      "utf8",
    );
    const declarations = source.matchAll(
      /r\.(get|post|patch|delete)\(\s*"([^"]+)"\s*,\s*(?:requirePermission|allow)\(([^)]+)\)/g,
    );
    for (const [, method, path, args] of declarations) {
      const permissions = [...args.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      assert.ok(permissions.length, `${file} ${path} has a known policy`);
      for (const [role, client] of clients) {
        if (permissions.some((p) => permitted(client.user, p))) continue;
        const response = await request(
          client,
          path.replace(/:[\w]+/g, "999999"),
          method.toUpperCase(),
        );
        assert.equal(
          response.status,
          403,
          `${role} ${method} ${path}: ${await response.text()}`,
        );
        checked++;
      }
    }
  }
  assert.ok(checked > 500, `Expected broad guard coverage, got ${checked}`);
});

test("platform routes require explicit designation even for a Super Admin", async () => {
  const client = clients.get("SUPER_ADMIN");
  assert.equal(client.user.platform_operator, false);
  for (const method of ["GET", "POST"]) {
    const response = await request(client, "/platform/schools", method);
    assert.equal(response.status, 403, await response.text());
  }
  await insert(db, "platform_operators", { user_id: client.user.id });
  const response = await request(client, "/platform/schools");
  assert.equal(response.status, 200, await response.text());
  const me = await request(client, "/me");
  assert.equal((await me.json()).data.user.platform_operator, true);
});
