import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  acquireLease,
  artifactName,
  isAlive,
  journal,
  redact,
  sessionEnvironment,
  startFixtureSites,
} from "./support.mjs";

test("one owner holds the lease; releasing it permits a later session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qa-lease-test-"));
  let lease = await acquireLease(root);
  try {
    await lease.update({ electronPid: 12345 });
    await assert.rejects(
      acquireLease(root),
      /Another QA session.*[\s\S]*12345/,
    );
    await lease.release();
    lease = await acquireLease(root);
  } finally {
    await lease.release();
    await rm(root, { recursive: true });
  }
});

test("deterministic mode strips credentials and conflicting Electron launch variables", async () => {
  const env = await sessionEnvironment("deterministic", {
    UNEMPLOYED_AI_API_KEY: "should-not-leak",
    OPENAI_API_KEY: "also-secret",
    ELECTRON_RUN_AS_NODE: "1",
    ELECTRON_RENDERER_URL: "http://localhost:5173",
    NODE_OPTIONS: "--require some-hook",
    UNEMPLOYED_TEST_RESUME_PREVIEW: "fail_once",
    UNEMPLOYED_TEST_API_USE_LIVE_AI: "1",
    UNEMPLOYED_INTERVIEW_TEST_USE_LIVE_AI: "1",
  });
  assert.equal(env.UNEMPLOYED_AI_API_KEY, "");
  assert.equal(env.OPENAI_API_KEY, "");
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.ELECTRON_RENDERER_URL, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.UNEMPLOYED_TEST_RESUME_PREVIEW, "fail_once");
  assert.equal(env.UNEMPLOYED_TEST_API_USE_LIVE_AI, "0");
  assert.equal(env.UNEMPLOYED_INTERVIEW_TEST_USE_LIVE_AI, "0");
  await assert.rejects(sessionEnvironment("typo"), /provider must/);
});

test("configured mode enables both real providers despite ambient test-mode flags", async () => {
  const env = await sessionEnvironment("configured", {
    UNEMPLOYED_AI_API_KEY: "synthetic-test-key",
    UNEMPLOYED_TEST_API_USE_LIVE_AI: "0",
    UNEMPLOYED_INTERVIEW_TEST_USE_LIVE_AI: "0",
  });
  assert.equal(env.UNEMPLOYED_AI_API_KEY, "synthetic-test-key");
  assert.equal(env.UNEMPLOYED_TEST_API_USE_LIVE_AI, "1");
  assert.equal(env.UNEMPLOYED_INTERVIEW_TEST_USE_LIVE_AI, "1");
});

test("both provider modes default to the embedded browser and preserve explicit host overrides", async () => {
  for (const provider of ["deterministic", "configured"]) {
    for (const unset of [undefined, ""]) {
      const defaultEnv = await sessionEnvironment(provider, {
        UNEMPLOYED_BROWSER_HOST: unset,
      });
      assert.equal(defaultEnv.UNEMPLOYED_BROWSER_HOST, "embedded");
    }
    for (const host of ["embedded", "external"]) {
      const env = await sessionEnvironment(provider, {
        UNEMPLOYED_BROWSER_HOST: host,
      });
      assert.equal(env.UNEMPLOYED_BROWSER_HOST, host);
    }
  }
});

test("artifact names cannot escape their session directory", () => {
  for (const name of ["../data", "/tmp/data", "a/b", "..", ""])
    assert.throws(() => artifactName(name));
  assert.equal(artifactName("profile-dark-1440"), "profile-dark-1440");
});

test("journal serializes asynchronous events and redacts known secrets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qa-journal-test-"));
  try {
    const events = journal(root, { UNEMPLOYED_AI_API_KEY: "test-secret" });
    events.record("first", "test-secret");
    events.record("second", "Bearer example-token");
    await events.flush();
    const entries = (await readFile(path.join(root, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.deepEqual(
      entries.map((entry) => entry.type),
      ["first", "second"],
    );
    assert.equal(entries[0].detail, "[redacted]");
    assert.equal(entries[1].detail, "Bearer [redacted]");
    assert.equal(redact("normal message"), "normal message");
  } finally {
    await rm(root, { recursive: true });
  }
});

test("fixture servers use independent ports, keep POST evidence local, and close their own process", async () => {
  const firstDir = await mkdtemp(path.join(os.tmpdir(), "qa-sites-test-"));
  const secondDir = await mkdtemp(path.join(os.tmpdir(), "qa-sites-test-"));
  let first;
  let second;
  try {
    first = await startFixtureSites(firstDir);
    second = await startFixtureSites(secondDir);
    assert.notEqual(first.url, second.url);
    assert.equal((await fetch(`${first.url}board/`)).status, 200);
    await fetch(`${first.url}nonexistent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: "synthetic-password",
        name: "Fictional Tester",
      }),
    });
    const log = await readFile(first.log, "utf8");
    assert.match(log, /Fictional Tester/);
    assert.doesNotMatch(log, /synthetic-password/);
    await first.close();
    assert.equal(isAlive(first.pid), false);
    assert.equal((await fetch(second.url)).status, 200);
  } finally {
    await first?.close();
    await second?.close();
    await rm(firstDir, { recursive: true });
    await rm(secondDir, { recursive: true });
  }
});
