import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

export const desktopDir = path.resolve(import.meta.dirname, "../..");
export const repoRoot = path.resolve(desktopDir, "../..");
const exec = promisify(execFile);
const require = createRequire(path.join(desktopDir, "package.json"));

export function artifactName(name) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || name.includes(".."))
    throw new Error(
      "Use a short artifact name with letters, numbers, dots, underscores or hyphens.",
    );
  return name;
}

export function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

export async function ownedProcessIds(pid) {
  if (process.platform === "win32") return [pid];
  const { stdout } = await exec("ps", ["-axo", "pid=,ppid="]);
  const rows = stdout
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number));
  const owned = new Set([pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [child, parent] of rows) {
      if (owned.has(parent) && !owned.has(child)) {
        owned.add(child);
        changed = true;
      }
    }
  }
  return [...owned];
}

export async function processConflicts() {
  if (process.platform === "win32") return [];
  const { stdout } = await exec("ps", ["-axo", "pid=,command="]);
  return stdout
    .split("\n")
    .filter((line) => {
      const command = line.trim().replace(/^\d+\s+/, "");
      return (
        command.includes(repoRoot) &&
        ((/electron(?:\/dist\/Electron.app\/Contents\/MacOS\/Electron|\/dist\/electron)/.test(
          command,
        ) &&
          command.includes("--inspect=0")) ||
          /(?:electron-vite|vite\/bin\/vite).*\bbuild\b/.test(command))
      );
    })
    .map((line) => line.trim());
}

export async function acquireLease(root = repoRoot) {
  const lock = path.join(
    os.tmpdir(),
    `unemployed-agent-qa-${Buffer.from(root).toString("base64url")}.lock`,
  );
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const owner = await readFile(path.join(lock, "owner.json"), "utf8").catch(
      () => "Owner record not yet available.",
    );
    throw new Error(
      `Another QA session holds ${lock}\n${owner}\nDo not stop its processes. If abandoned, verify both owner and Electron PIDs have exited before removing this lock directory.`,
    );
  }
  const owner = { pid: process.pid, startedAt: new Date().toISOString() };
  await writeFile(
    path.join(lock, "owner.json"),
    JSON.stringify(owner, null, 2),
  );
  return {
    async update(values) {
      Object.assign(owner, values);
      await writeFile(
        path.join(lock, "owner.json"),
        JSON.stringify(owner, null, 2),
      );
    },
    async release() {
      await rm(lock, { recursive: true });
    },
  };
}

async function inventory(directory, relative = "") {
  const entries = await readdir(path.join(directory, relative), {
    withFileTypes: true,
  });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await inventory(directory, name)));
    else {
      const info = await stat(path.join(directory, name));
      files.push({ name, size: info.size, modifiedAt: info.mtimeMs });
    }
  }
  return files;
}

export async function snapshotBuild(runDir) {
  const source = path.join(desktopDir, "out");
  await stat(path.join(source, "main/index.cjs")).catch(() => {
    throw new Error(
      "No desktop build. When other agents are not building, run pnpm --filter @unemployed/desktop build once, then retry.",
    );
  });
  const before = await inventory(source);
  const appDir = path.join(runDir, "app");
  await cp(source, path.join(appDir, "out"), { recursive: true });
  await cp(
    path.join(desktopDir, "package.json"),
    path.join(appDir, "package.json"),
  );
  await symlink(
    path.join(desktopDir, "node_modules"),
    path.join(appDir, "node_modules"),
    "junction",
  );
  const after = await inventory(source);
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error(
      "Desktop output changed while copying. Wait for the other build to finish, then retry.",
    );
  const { stdout: revision } = await exec("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
  });
  const { stdout: changes } = await exec("git", ["status", "--short"], {
    cwd: repoRoot,
  });
  return {
    appDir,
    source,
    copiedAt: new Date().toISOString(),
    revision: revision.trim(),
    changes: changes.trim(),
    files: before,
    note: "Existing build copied without rebuilding. Revision and dirty files describe the checkout at copy time, not proof that output includes them. Dependencies and native sidecars still come from this checkout.",
  };
}

export async function sessionEnvironment(provider, overrides = {}) {
  if (!["deterministic", "configured"].includes(provider))
    throw new Error("provider must be deterministic or configured");
  const loaded = {};
  if (provider === "configured") {
    const { parse } = require("dotenv");
    for (const dir of [repoRoot, desktopDir]) {
      for (const filename of [".env", ".env.local"]) {
        const contents = await readFile(path.join(dir, filename), "utf8").catch(
          (error) => {
            if (error.code !== "ENOENT") throw error;
            return "";
          },
        );
        // Match the desktop's first-defined-value precedence.
        for (const [key, value] of Object.entries(parse(contents)))
          loaded[key] ??= value;
      }
    }
  }
  const env = { ...loaded, ...process.env, ...overrides };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  delete env.NODE_OPTIONS;
  // Test hooks retain the legacy external host unless QA explicitly selects one.
  env.UNEMPLOYED_BROWSER_HOST ||= "embedded";
  // Test APIs otherwise force deterministic providers despite valid credentials.
  // The selected mode wins over ambient flags from another QA session.
  env.UNEMPLOYED_TEST_API_USE_LIVE_AI = provider === "configured" ? "1" : "0";
  env.UNEMPLOYED_INTERVIEW_TEST_USE_LIVE_AI =
    provider === "configured" ? "1" : "0";
  if (provider === "deterministic") {
    for (const key of Object.keys(env)) {
      if (/(?:API_KEY|TOKEN|SECRET|PASSWORD)$/.test(key)) env[key] = "";
    }
    for (const key of [
      "UNEMPLOYED_AI_API_KEY",
      "UNEMPLOYED_AI_VISION_API_KEY",
      "UNEMPLOYED_INTERVIEW_AI_API_KEY",
      "UNEMPLOYED_INTERVIEW_VISION_API_KEY",
    ])
      env[key] = "";
  }
  return env;
}

export function redact(text, env = {}) {
  let result = String(text);
  for (const [key, value] of Object.entries(env)) {
    if (/(?:KEY|TOKEN|SECRET|PASSWORD)$/.test(key) && value?.length > 3)
      result = result.split(value).join("[redacted]");
  }
  return result.replace(/(Bearer\s+)\S+/gi, "$1[redacted]");
}

export async function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

export async function startFixtureSites(runDir) {
  const log = path.join(runDir, "fixture-submissions.jsonl");
  const child = spawn(
    process.execPath,
    [path.join(desktopDir, "test-fixtures/job-sites/serve.mjs")],
    {
      cwd: desktopDir,
      env: {
        ...process.env,
        PORT: "0",
        UNEMPLOYED_FIXTURE_SUBMISSIONS_LOG: log,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.resume();
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new Error("Fixture startup timed out")),
        10000,
      );
      const finish = (error, value) => {
        clearTimeout(timer);
        child.off("error", failed);
        child.off("exit", exited);
        child.stderr.off("data", received);
        if (error) reject(error);
        else resolve(value);
      };
      const failed = (error) => finish(error);
      const exited = (code) =>
        finish(new Error(`Fixture exited (${code}): ${output}`));
      const received = (chunk) => {
        output += chunk;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
        if (match) finish(null, match[0]);
      };
      child.once("error", failed);
      child.once("exit", exited);
      child.stderr.on("data", received);
    });
    child.stderr.resume();
    return { url, log, pid: child.pid, close: () => stopChild(child) };
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

export async function newRunDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "unemployed-agent-qa-"));
}

export function journal(runDir, env) {
  let pending = Promise.resolve();
  return {
    record(type, detail) {
      const line = JSON.stringify(
        { at: new Date().toISOString(), type, detail },
        (_key, value) =>
          typeof value === "string" ? redact(value, env) : value,
      );
      pending = pending.then(() =>
        appendFile(path.join(runDir, "events.jsonl"), `${line}\n`),
      );
      // Keep event listeners from creating unhandled rejections; flush still reports failure.
      pending.catch(() => {});
    },
    flush: () => pending,
  };
}
