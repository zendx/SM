import { test } from "node:test";
import assert from "node:assert/strict";
import { SCHOOL_ROLES, SCHOOL_ROLE_OPTIONS } from "../shared/school-roles.js";
import { ROLE_PERMISSIONS } from "../server/security.js";
test("tenant role options include Parent and every backend school role", () => {
  assert.deepEqual(
    [...SCHOOL_ROLES].sort(),
    Object.keys(ROLE_PERMISSIONS).sort(),
  );
  assert.deepEqual(
    SCHOOL_ROLE_OPTIONS.map((o) => o.value),
    SCHOOL_ROLES,
  );
  assert.equal(
    SCHOOL_ROLE_OPTIONS.find((o) => o.value === "PARENT").label,
    "Parent",
  );
  assert.ok(!SCHOOL_ROLES.includes("PLATFORM_OWNER"));
});
