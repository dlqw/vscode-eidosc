const crypto = require("crypto");
const { execFileSync } = require("child_process");

const sourceSet = ["out", "syntaxes", "themes", "language-configuration.json"];
const candidate = process.argv[2] || "HEAD";
const tags = execFileSync("git", ["tag", "--list", "v*", "--sort=-version:refname"], { encoding: "utf8" })
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
const baseline = tags[0] || "";

function root(ref) {
  const payload = execFileSync("git", ["ls-tree", "-r", "--full-tree", ref, "--", ...sourceSet], { encoding: "utf8" });
  return crypto.createHash("sha256").update(payload.replace(/\r\n/g, "\n")).digest("hex");
}

let mode = "full";
let reason = "baseline tag unavailable";
let baselineRoot = "";
let candidateRoot = "";
if (baseline) {
  baselineRoot = root(baseline);
  candidateRoot = root(candidate);
  mode = baselineRoot === candidateRoot ? "fast" : "full";
  reason = mode === "fast" ? "editor source-set unchanged" : "editor source-set changed";
}

const result = { mode, reason, baseline: baseline || null, candidate, baselineRoot, candidateRoot };
console.log(JSON.stringify(result));
if (process.env.GITHUB_OUTPUT) {
  require("fs").appendFileSync(process.env.GITHUB_OUTPUT, `mode=${mode}\nreason=${reason}\nbaseline=${baseline}\ncandidate=${candidate}\nbaseline_root=${baselineRoot}\ncandidate_root=${candidateRoot}\n`);
}
