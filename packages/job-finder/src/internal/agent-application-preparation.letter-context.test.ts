import { describe, expect, test } from "vitest";

import { createSeed } from "../workspace-service.test-fixtures";
import { buildApplyLetterDependencies } from "./agent-application-preparation";

describe("application document writer context", () => {
  test("passes grounded context, preferences, and prior text to the actual model boundary", async () => {
    const seed = createSeed();
    const messagesSeen: Array<{ role: string; content: string }> = [];
    const dependencies = buildApplyLetterDependencies({
      aiClient: {
        chatWithTools(messages) {
          messagesSeen.push(...messages);
          return Promise.resolve({ content: "Revised grounded letter." });
        },
      },
      documentManager: {},
      job: seed.savedJobs[0]!,
      profile: seed.profile,
      settings: seed.settings,
    });

    expect(dependencies).toBeDefined();
    await dependencies!.writeLetter({
      purpose: "motivation_letter",
      prompt: "Make the second paragraph shorter.",
      groundedIn: [
        "Profile: Alex Vanguard, platform designer",
        "Resume: Built workflow tools at Acme",
        "Job: Senior Product Designer at Northstar",
      ],
      language: "English",
      preference: {
        tone: "direct",
        length: "short",
        language: "English",
        sample: null,
      },
      priorText: "Earlier document text.",
    });

    const userMessage = messagesSeen.find((message) => message.role === "user");
    expect(userMessage?.content).toContain(
      "Document purpose: motivation letter",
    );
    expect(userMessage?.content).toContain("Saved tone: direct");
    expect(userMessage?.content).toContain("Saved length: short");
    expect(userMessage?.content).toContain("Profile: Alex Vanguard");
    expect(userMessage?.content).toContain(
      "Resume: Built workflow tools at Acme",
    );
    expect(userMessage?.content).toContain(
      "Job: Senior Product Designer at Northstar",
    );
    expect(userMessage?.content).toContain(
      "Prior version to revise:\nEarlier document text.",
    );
  });
});
