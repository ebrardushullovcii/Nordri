process.env.UI_CAPTURE_LABEL ??= "live-assistant-fast";
process.env.UI_LIVE_ASSISTANT_PROVIDER_MODE = "deterministic";

await import("./capture-live-assistant.mjs");
