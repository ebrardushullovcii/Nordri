import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { _electron as electron } from "playwright";
import {
  acquireLease,
  artifactName,
  desktopDir,
  isAlive,
  journal,
  newRunDirectory,
  ownedProcessIds,
  processConflicts,
  sessionEnvironment,
  snapshotBuild,
  startFixtureSites,
  stopChild,
} from "./support.mjs";

// Only lifecycle and diagnostics live here. Tests use the real Playwright objects.
export async function createAgentSession({
  provider = "deterministic",
  env: overrides = {},
  fixtures = true,
  trace = false,
} = {}) {
  const lease = await acquireLease();
  let qa;
  try {
    const conflicts = await processConflicts();
    if (conflicts.length)
      throw new Error(
        `Another isolated app or build is active. Coordinate before launching:\n${conflicts.join("\n")}`,
      );
    const runDir = await newRunDirectory();
    const build = await snapshotBuild(runDir);
    const env = await sessionEnvironment(provider, overrides);
    const events = journal(runDir, env);
    let generation = 0;
    let closing;
    let survivors = [];
    let child;
    qa = {
      runDir,
      build,
      provider,
      browserHost: env.NORDRI_BROWSER_HOST,
      userDataDir: path.join(runDir, "user-data"),
      sites: null,
      app: null,
      page: null,
      get context() {
        return qa.app.context();
      },
      async capture(name) {
        const base = path.join(runDir, artifactName(name));
        await qa.page.screenshot({
          path: `${base}.png`,
          animations: "disabled",
        });
        await writeFile(
          `${base}.aria.txt`,
          await qa.page.locator("body").ariaSnapshot(),
        );
        events.record("capture", { name, generation, url: qa.page.url() });
        await events.flush();
        return `${base}.png`;
      },
      async restart() {
        await stop();
        await start();
        return qa.page;
      },
      close() {
        return (closing ??= (async () => {
          const errors = [];
          await stop().catch((error) => errors.push(error));
          await qa.sites?.close().catch((error) => errors.push(error));
          await events.flush().catch((error) => errors.push(error));
          if (!survivors.some(isAlive) && (!child || !isAlive(child.pid)))
            await lease.release();
          if (errors.length)
            throw new AggregateError(
              errors,
              errors.map((error) => error.message).join("\n"),
            );
        })());
      },
    };
    async function start() {
      if (closing) throw new Error("Session is closed");
      generation += 1;
      await mkdir(qa.userDataDir, { recursive: true });
      qa.app = await electron.launch({
        args: [build.appDir],
        cwd: desktopDir,
        timeout: 30000,
        env: {
          ...env,
          NORDRI_ENABLE_TEST_API: env.NORDRI_ENABLE_TEST_API ?? "1",
          NORDRI_USER_DATA_DIR: qa.userDataDir,
        },
      });
      child = qa.app.process();
      await lease.update({ runDir, electronPid: child.pid });
      child.stdout?.on("data", (chunk) =>
        events.record("stdout", chunk.toString()),
      );
      child.stderr?.on("data", (chunk) =>
        events.record("stderr", chunk.toString()),
      );
      const observed = new WeakSet();
      const observe = (page) => {
        if (observed.has(page)) return;
        observed.add(page);
        page.on("console", (message) =>
          events.record("console", {
            level: message.type(),
            text: message.text(),
          }),
        );
        page.on("pageerror", (error) =>
          events.record("pageerror", error.stack ?? error.message),
        );
        page.on("crash", () => events.record("page-crash", page.url()));
      };
      qa.context.on("page", observe);
      qa.context.pages().forEach(observe);
      qa.context.on("requestfailed", (request) =>
        events.record("requestfailed", {
          method: request.method(),
          url: request.url().split("?")[0],
          failure: request.failure(),
        }),
      );
      qa.context.on("response", (response) => {
        if (response.status() >= 400)
          events.record("http-error", {
            status: response.status(),
            url: response.url().split("?")[0],
          });
      });
      if (trace)
        await qa.context.tracing.start({
          screenshots: true,
          snapshots: true,
          sources: false,
        });
      qa.page = await qa.app.firstWindow();
      await qa.page.waitForLoadState("domcontentloaded");
      await qa.page.waitForFunction(
        () => Boolean(window.nordri?.jobFinder),
        null,
        { timeout: 30000 },
      );
      const actual = await qa.app.evaluate(({ app }) =>
        app.getPath("userData"),
      );
      if (path.resolve(actual) !== path.resolve(qa.userDataDir))
        throw new Error(`Unexpected user data directory: ${actual}`);
      events.record("started", {
        generation,
        pid: child.pid,
        provider,
        browserHost: qa.browserHost,
      });
      await writeFile(
        path.join(runDir, "session.json"),
        JSON.stringify(
          {
            runDir,
            userDataDir: qa.userDataDir,
            generation,
            pid: child.pid,
            provider,
            browserHost: qa.browserHost,
            build,
            sites: qa.sites && { url: qa.sites.url, log: qa.sites.log },
          },
          null,
          2,
        ),
      );
    }
    async function stop() {
      if (!qa.app) return;
      const owned = await ownedProcessIds(child.pid);
      await lease.update({ ownedPids: owned });
      if (trace)
        await qa.context.tracing
          .stop({ path: path.join(runDir, `trace-${generation}.zip`) })
          .catch((error) => events.record("trace-error", error.message));
      let timer;
      try {
        await Promise.race([
          qa.app.close(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Electron close timed out")),
              20000,
            );
          }),
        ]);
      } catch (error) {
        events.record("forced-close", error.message);
        await stopChild(child);
      } finally {
        clearTimeout(timer);
      }
      for (let attempt = 0; attempt < 10 && owned.some(isAlive); attempt += 1)
        await new Promise((resolve) => setTimeout(resolve, 100));
      survivors = owned.filter(isAlive);
      if (survivors.length)
        throw new Error(
          `Owned processes survived: ${survivors.join(", ")}. Lease retained; inspect these PIDs before another launch.`,
        );
      qa.app = null;
      qa.page = null;
      events.record("stopped", { generation });
    }
    if (fixtures) qa.sites = await startFixtureSites(runDir);
    await start();
    return qa;
  } catch (error) {
    if (qa) {
      await qa.close().catch((cleanup) => {
        error.message += `\nCleanup: ${cleanup.message}`;
      });
      error.message += `\nQA artifacts: ${qa.runDir}`;
    } else await lease.release();
    throw error;
  }
}
