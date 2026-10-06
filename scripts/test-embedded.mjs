import { spawn } from "node:child_process";
// An explicit portable test command: no connection to application DATABASE_URL.
const args = process.argv.slice(2);
const child = spawn(
  process.execPath,
  args.length ? args : ["--test", "--test-concurrency=2", "tests/*.test.js"],
  {
    stdio: "inherit",
    env: { ...process.env, SMPIS_TEST_EMBEDDED: "true" },
    windowsHide: true,
  },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
