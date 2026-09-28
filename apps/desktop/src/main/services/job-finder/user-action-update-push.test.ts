import { describe, expect, it, vi } from "vitest";
import {
  publishOnApplyStandingChanges,
  publishOnUserActionChanges,
} from "./user-action-update-push";

describe("publishOnUserActionChanges", () => {
  it("pushes once shortly after a step changes, however many changes land together", async () => {
    vi.useFakeTimers();
    const repository = {
      commitUserActionTransition: vi.fn<(input: unknown) => Promise<unknown>>(
        () => Promise.resolve({ status: "applied" }),
      ),
      createUserActionRequest: vi.fn<(input: unknown) => Promise<void>>(() =>
        Promise.resolve(),
      ),
    };
    const publish = vi.fn();
    publishOnUserActionChanges(repository as never, publish);

    await repository.commitUserActionTransition({} as never);
    await repository.commitUserActionTransition({} as never);
    await repository.createUserActionRequest({} as never);
    expect(publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(publish).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("publishOnApplyStandingChanges", () => {
  it("pushes when a batch job's standing changes, and not for a swap that lost", async () => {
    vi.useFakeTimers();
    let swapWins = false;
    const repository = {
      upsertApplyRun: vi.fn<(run: unknown) => Promise<void>>(() =>
        Promise.resolve(),
      ),
      upsertApplyJobResult: vi.fn<(result: unknown) => Promise<void>>(() =>
        Promise.resolve(),
      ),
      compareAndSwapApplyJobResult: vi.fn<(input: unknown) => Promise<boolean>>(
        () => Promise.resolve(swapWins),
      ),
      markApplicationPreparationStarted: vi.fn<
        (input: unknown) => Promise<{ result: object; didStart: boolean }>
      >(() => Promise.resolve({ result: {}, didStart: true })),
    };
    const publish = vi.fn();
    publishOnApplyStandingChanges(repository as never, publish);

    // A lost compare-and-swap wrote nothing.
    await repository.compareAndSwapApplyJobResult({} as never);
    await vi.advanceTimersByTimeAsync(300);
    expect(publish).not.toHaveBeenCalled();

    // Planned to "Waiting for a free browser tab" is a swap that lands.
    swapWins = true;
    await expect(
      repository.compareAndSwapApplyJobResult({} as never),
    ).resolves.toBe(true);
    await repository.upsertApplyRun({} as never);
    await vi.advanceTimersByTimeAsync(300);
    expect(publish).toHaveBeenCalledTimes(1);

    await repository.markApplicationPreparationStarted({} as never);
    await vi.advanceTimersByTimeAsync(300);
    expect(publish).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
