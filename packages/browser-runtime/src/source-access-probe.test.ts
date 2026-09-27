import type { Page } from "playwright";
import { describe, expect, test, vi } from "vitest";

import { createBrowserAgentRuntime } from "./playwright-browser-runtime";
import {
  inspectSourceAccessPage,
  selectUniqueSourceAccessPage,
} from "./source-access-probe";

type Signals = {
  passwordControl: boolean;
  loginControl: boolean;
  captchaChallenge: boolean;
  mfaChallenge: boolean;
  signOutControl: boolean;
  accountMenuControl: boolean;
  profileControl: boolean;
};

const emptySignals: Signals = {
  passwordControl: false,
  loginControl: false,
  captchaChallenge: false,
  mfaChallenge: false,
  signOutControl: false,
  accountMenuControl: false,
  profileControl: false,
};

function createPage(url: string, signals: Partial<Signals> = {}) {
  const evaluate = vi.fn().mockResolvedValue({ ...emptySignals, ...signals });
  const page = {
    url: vi.fn(() => url),
    evaluate,
  } as unknown as Page;
  return { evaluate, page };
}

describe("read-only source access probe", () => {
  test("selects only a unique expected-origin tab among unrelated live pages", () => {
    const unrelated = {
      url: () => "https://other.example/apply",
      isClosed: () => false,
    };
    const expected = {
      url: () => "https://jobs.example.com/search",
      isClosed: () => false,
    };
    expect(
      selectUniqueSourceAccessPage(
        [expected, unrelated],
        "https://jobs.example.com/",
      ),
    ).toBe(expected);
    expect(
      selectUniqueSourceAccessPage(
        [expected, expected, unrelated],
        "https://jobs.example.com/",
      ),
    ).toBeNull();
    expect(
      selectUniqueSourceAccessPage([unrelated], "https://jobs.example.com/"),
    ).toBeNull();
  });

  test("does not launch a browser when no managed session is already open", async () => {
    const runtime = createBrowserAgentRuntime({
      userDataDir: "unused-source-access-probe-profile",
      chromeExecutablePath: "missing-chrome.exe",
      debugPort: 65_530,
    });

    await expect(
      runtime.inspectSourceAccess?.("target_site", {
        expectedOrigin: "https://jobs.example.com/",
      }),
    ).resolves.toMatchObject({
      state: "inconclusive",
      currentOrigin: null,
      signals: [],
    });
  });
  test("treats a ready same-origin page without positive account evidence as inconclusive", async () => {
    const { page } = createPage("https://jobs.example.com/search");

    await expect(
      inspectSourceAccessPage(page, {
        expectedOrigin: "https://jobs.example.com/",
      }),
    ).resolves.toMatchObject({
      state: "inconclusive",
      currentOrigin: "https://jobs.example.com/",
      signals: [],
    });
  });

  test("blocks an origin mismatch without inspecting or navigating the page", async () => {
    const { evaluate, page } = createPage("https://accounts.example.net/login");

    await expect(
      inspectSourceAccessPage(page, {
        expectedOrigin: "https://jobs.example.com/",
      }),
    ).resolves.toMatchObject({
      state: "blocked",
      currentOrigin: "https://accounts.example.net/",
      signals: ["origin_mismatch"],
    });
    expect(evaluate).not.toHaveBeenCalled();
  });

  test("keeps visible password, MFA, and challenge surfaces blocked", async () => {
    const { page } = createPage("https://jobs.example.com/login", {
      passwordControl: true,
      loginControl: true,
      mfaChallenge: true,
      profileControl: true,
    });

    const result = await inspectSourceAccessPage(page, {
      expectedOrigin: "https://jobs.example.com/",
    });

    expect(result.state).toBe("blocked");
    expect(result.signals).toEqual(
      expect.arrayContaining([
        "auth_route",
        "password_control",
        "login_control",
        "mfa_challenge",
        "profile_control",
      ]),
    );
  });

  test.each([
    ["sign out", { signOutControl: true }, "sign_out_control"],
    ["account menu", { accountMenuControl: true }, "account_menu_control"],
    ["profile menu", { profileControl: true }, "profile_control"],
  ])(
    "accepts a same-origin strong %s marker",
    async (_label, signals, signal) => {
      const { page } = createPage(
        "https://jobs.example.com/search?query=engineer",
        signals,
      );

      await expect(
        inspectSourceAccessPage(page, {
          expectedOrigin: "https://jobs.example.com/",
        }),
      ).resolves.toMatchObject({
        state: "authenticated",
        currentOrigin: "https://jobs.example.com/",
        signals: [signal],
      });
    },
  );

  test("lets an explicit blocker win over a simultaneous account marker", async () => {
    const { page } = createPage("https://jobs.example.com/search", {
      captchaChallenge: true,
      signOutControl: true,
    });

    const result = await inspectSourceAccessPage(page, {
      expectedOrigin: "https://jobs.example.com/",
    });

    expect(result.state).toBe("blocked");
    expect(result.signals).toEqual(
      expect.arrayContaining(["captcha_challenge", "sign_out_control"]),
    );
  });

  test("returns only redacted enum evidence", async () => {
    const { page } = createPage("https://jobs.example.com/search", {
      accountMenuControl: true,
    });

    const result = await inspectSourceAccessPage(page, {
      expectedOrigin: "https://jobs.example.com/",
    });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("search?");
    expect(serialized).not.toContain("cookie");
    expect(Object.keys(result).sort()).toEqual([
      "checkedAt",
      "currentOrigin",
      "signals",
      "state",
    ]);
  });
});
