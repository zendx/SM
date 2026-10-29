import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MENU_DESCRIPTIONS,
  workspaceGroups,
} from "../shared/workspace-navigation.js";

const entry = (key) => [key, key, null];
test("tenant navigation follows the requested order with clickable parents and distinct children", () => {
  const keys = [
    "students",
    "dashboard",
    "finance",
    "staff",
    "people",
    "admissions",
    "attendance",
    "academics",
    "administration",
    "quality",
    "intelligence",
    "facilities",
    "alerts",
    "curriculum",
    "messages",
    "subscription",
    "reports",
    "support",
  ];
  const groups = workspaceGroups(keys.map(entry));
  assert.deepEqual(
    groups.map((g) => g.entry[0]),
    ["dashboard", "admissions", "staff", "administration", "academics"],
  );
  assert.deepEqual(
    groups[1].children.map(([key]) => key),
    ["students", "attendance"],
  );
  assert.deepEqual(
    groups[2].children.map(([key]) => key),
    ["people"],
  );
  assert.deepEqual(
    groups[3].children.map(([key]) => key),
    ["quality", "intelligence", "facilities", "alerts"],
  );
  assert.deepEqual(
    groups[4].children.map(([key]) => key),
    ["finance", "curriculum", "messages", "reports", "subscription", "support"],
  );
  const all = groups
    .flatMap((g) => [g.entry, ...g.children])
    .map(([key]) => key);
  assert.equal(new Set(all).size, keys.length);
  for (const key of all) assert.ok(MENU_DESCRIPTIONS[key]);
});
test("allowed child pages remain accessible when a role cannot open the parent", () => {
  const groups = workspaceGroups(
    ["students", "attendance", "teaching", "messages"].map(entry),
  );
  assert.deepEqual(
    groups.map((g) => g.entry[0]),
    ["students", "attendance", "messages", "teaching"],
  );
  assert.ok(groups.every((g) => g.children.length === 0));
});
