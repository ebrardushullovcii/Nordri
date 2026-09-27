import { describe, expect, it, vi } from "vitest";
import {
  looksLikeSignInPage,
  withBrowserSignInRetry,
} from "./listing-html-with-browser-session";

const signIn = {
  status: 200,
  html: '<form><input type="email" name="email"><input type="password" name="password"></form>',
  finalUrl: "http://localhost:47963/authboard/jobs/2",
};
const listing = {
  status: 200,
  html: "<h1>Backend Engineer</h1><p>Build APIs.</p>",
  finalUrl: "http://localhost:47963/authboard/jobs/2",
};

describe("withBrowserSignInRetry", () => {
  it("reads a page behind the person's sign-in again with the browser's sign-in", async () => {
    const plain = vi.fn().mockResolvedValue(signIn);
    const withSignIn = vi.fn().mockResolvedValue(listing);
    const read = withBrowserSignInRetry(plain, withSignIn);
    const signal = new AbortController().signal;

    await expect(read(listing.finalUrl, { signal })).resolves.toBe(listing);
    expect(withSignIn).toHaveBeenCalledWith(listing.finalUrl, { signal });
  });

  it("never uses the sign-in for a public page, and keeps the plain answer when the sign-in read fails", async () => {
    const withSignIn = vi.fn().mockRejectedValue(new Error("offline"));
    const signal = new AbortController().signal;

    await expect(
      withBrowserSignInRetry(vi.fn().mockResolvedValue(listing), withSignIn)(
        "x",
        { signal },
      ),
    ).resolves.toBe(listing);
    expect(withSignIn).not.toHaveBeenCalled();

    await expect(
      withBrowserSignInRetry(vi.fn().mockResolvedValue(signIn), withSignIn)(
        "x",
        { signal },
      ),
    ).resolves.toBe(signIn);
  });

  it("recognises sign-in pages by status, address and password field", () => {
    expect(looksLikeSignInPage({ ...listing, status: 401 })).toBe(true);
    expect(
      looksLikeSignInPage({ ...listing, finalUrl: "https://a.example/login" }),
    ).toBe(true);
    expect(looksLikeSignInPage(signIn)).toBe(true);
    expect(looksLikeSignInPage(listing)).toBe(false);
  });
});
