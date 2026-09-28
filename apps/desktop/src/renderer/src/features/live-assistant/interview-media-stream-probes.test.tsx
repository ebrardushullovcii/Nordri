// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { InterviewMediaStreamProbes } from "./interview-media-stream-probes";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

const originalMediaDevices = Object.getOwnPropertyDescriptor(
  navigator,
  "mediaDevices",
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalMediaDevices) {
    Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
  } else {
    Reflect.deleteProperty(navigator, "mediaDevices");
  }
});

function setupDelayedMicrophoneStream() {
  const streamDeferred = createDeferred<MediaStream>();
  const stopTrack = vi.fn();
  const stream = {
    getTracks: () => [{ stop: stopTrack }],
  } as unknown as MediaStream;
  const getUserMedia = vi.fn(() => streamDeferred.promise);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  const constructMediaRecorder = vi.fn();
  vi.stubGlobal(
    "MediaRecorder",
    class {
      static isTypeSupported() {
        return true;
      }

      constructor() {
        constructMediaRecorder();
      }
    },
  );

  return {
    constructMediaRecorder,
    getUserMedia,
    resolveStream: async () => {
      await act(async () => {
        streamDeferred.resolve(stream);
        await streamDeferred.promise;
        await Promise.resolve();
      });
    },
    stopTrack,
  };
}

function setupRecorderFailure(failure: "constructor" | "start") {
  const stopTrack = vi.fn();
  const stream = {
    getTracks: () => [{ stop: stopTrack }],
  } as unknown as MediaStream;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(() => Promise.resolve(stream)) },
  });
  vi.stubGlobal(
    "MediaRecorder",
    class {
      static isTypeSupported() {
        return true;
      }

      state = "inactive";

      constructor() {
        if (failure === "constructor") {
          throw new Error("MediaRecorder construction failed.");
        }
      }

      start() {
        if (failure === "start") {
          throw new Error("MediaRecorder start failed.");
        }
      }

      stop() {}
    },
  );

  return { stopTrack };
}

function renderProbe(input?: {
  listening?: boolean;
  sessionId?: string;
  microphoneCaptureAllowed?: boolean;
  meetingAudioCaptureAllowed?: boolean;
}) {
  return render(
    <InterviewMediaStreamProbes
      audioTranscriptionAvailable
      language="en-US"
      listening={input?.listening ?? true}
      meetingAudioCaptureAllowed={input?.meetingAudioCaptureAllowed ?? true}
      microphoneCaptureAllowed={input?.microphoneCaptureAllowed ?? true}
      onWorkspaceChange={() => undefined}
      sessionId={input?.sessionId ?? "session_1"}
    />,
  );
}

describe("InterviewMediaStreamProbes capture lifecycle", () => {
  test("labels microphone and system audio probe statuses distinctly before any check", () => {
    const rendered = renderProbe();

    const statusLines = Array.from(
      rendered.container.querySelectorAll("p"),
    ).map((line) => line.textContent ?? "");

    expect(statusLines).toContain("Microphone: Not checked yet.");
    expect(statusLines).toContain("System audio: Not checked yet.");
  });

  test("allows system audio while microphone capture remains disabled", () => {
    const rendered = renderProbe({
      microphoneCaptureAllowed: false,
      meetingAudioCaptureAllowed: true,
    });

    expect(
      rendered
        .getByRole("button", { name: "Start mic audio" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      rendered
        .getByRole("button", { name: "Start system audio" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  test.each(["constructor", "start"] as const)(
    "stops an acquired stream when MediaRecorder %s fails",
    async (failure) => {
      const recorderFailure = setupRecorderFailure(failure);
      const rendered = renderProbe();

      await act(async () => {
        fireEvent.click(
          rendered.getByRole("button", { name: "Start mic audio" }),
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(recorderFailure.stopTrack).toHaveBeenCalledOnce();
    },
  );

  test("stops a microphone stream that resolves after listening pauses", async () => {
    const delayedStream = setupDelayedMicrophoneStream();
    const rendered = renderProbe();

    fireEvent.click(rendered.getByRole("button", { name: "Start mic audio" }));
    expect(delayedStream.getUserMedia).toHaveBeenCalledOnce();
    rendered.rerender(
      <InterviewMediaStreamProbes
        audioTranscriptionAvailable
        language="en-US"
        listening={false}
        meetingAudioCaptureAllowed
        microphoneCaptureAllowed
        onWorkspaceChange={() => undefined}
        sessionId="session_1"
      />,
    );
    await delayedStream.resolveStream();

    expect(delayedStream.stopTrack).toHaveBeenCalledOnce();
    expect(delayedStream.constructMediaRecorder).not.toHaveBeenCalled();
  });

  test("stops a microphone stream that resolves after unmount", async () => {
    const delayedStream = setupDelayedMicrophoneStream();
    const rendered = renderProbe();

    fireEvent.click(rendered.getByRole("button", { name: "Start mic audio" }));
    rendered.unmount();
    await delayedStream.resolveStream();

    expect(delayedStream.stopTrack).toHaveBeenCalledOnce();
    expect(delayedStream.constructMediaRecorder).not.toHaveBeenCalled();
  });

  test("stops a microphone stream that resolves for a replaced session", async () => {
    const delayedStream = setupDelayedMicrophoneStream();
    const rendered = renderProbe();

    fireEvent.click(rendered.getByRole("button", { name: "Start mic audio" }));
    rendered.rerender(
      <InterviewMediaStreamProbes
        audioTranscriptionAvailable
        language="en-US"
        listening
        meetingAudioCaptureAllowed
        microphoneCaptureAllowed
        onWorkspaceChange={() => undefined}
        sessionId="session_2"
      />,
    );
    await delayedStream.resolveStream();

    expect(delayedStream.stopTrack).toHaveBeenCalledOnce();
    expect(delayedStream.constructMediaRecorder).not.toHaveBeenCalled();
  });
});
