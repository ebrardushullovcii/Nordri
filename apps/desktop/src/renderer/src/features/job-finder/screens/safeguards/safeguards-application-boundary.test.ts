import { describe, expect, it } from "vitest";
import { describeEnvelopeMode } from "./safeguards-application-boundary";

describe("describeEnvelopeMode", () => {
  it("names each permission by the mode Settings shows, never the stored value", () => {
    expect(describeEnvelopeMode("autonomous_submit")).toBe("Send for me");
    expect(describeEnvelopeMode("confirm_before_submit")).toBe(
      "Ask before sending",
    );
    expect(describeEnvelopeMode("prepare_only")).toBe("Fill for review only");
  });
});
