import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const tracked = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
  windowsHide: true,
})
  .split("\0")
  .filter(Boolean);
function privatePath(file) {
  return (
    /^(data|backups|test-results|\.npm-cache)\//.test(file) ||
    file === "api.js" ||
    /(^|\/)\.env(?:$|\.(?!example$)[^/]+$)/.test(file)
  );
}
const data = tracked.filter(privatePath);
if (data.length)
  throw new Error(
    `${data.length} operational data/backup files are tracked in Git.`,
  );
const config = readFileSync(
  new URL("../vite.config.js", import.meta.url),
  "utf8",
);
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
if (
  Object.values(pkg.scripts).some((command) =>
    /\bnode\s+api\.js\b/.test(command),
  )
)
  throw new Error("Unexpected root api.js execution in package scripts.");
if (
  /\beval\s*\(|new\s+Function\b|\bspawn\s*\(|\brequire\s*\(|global\s*[.\[]/.test(
    config,
  )
)
  throw new Error(
    "Unexpected execution primitive in build configuration; inspect before running a build.",
  );
if (process.argv.includes("--history")) {
  const objects = execFileSync(
    "git",
    ["rev-list", "--objects", "--all", "--reflog"],
    { encoding: "utf8", windowsHide: true },
  ).split(/\r?\n/);
  const bad = objects.filter(
    (line) =>
      line.includes(" ") && privatePath(line.slice(line.indexOf(" ") + 1)),
  );
  if (bad.length)
    throw new Error(
      `${bad.length} private/loader paths remain in reachable Git history.`,
    );
  for (const line of objects.filter((line) =>
    line.endsWith(" vite.config.js"),
  )) {
    const oid = line.split(" ")[0];
    const source = execFileSync("git", ["cat-file", "blob", oid], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (
      /\beval\s*\(|new\s+Function\b|\bspawn\s*\(|\brequire\s*\(|global\s*[.\[]/.test(
        source,
      )
    )
      throw new Error(
        "A build-loader execution primitive remains in Git history.",
      );
  }
}
console.log(
  "Source hygiene checks passed: operational data excluded; build configuration has no dynamic execution primitives.",
);
