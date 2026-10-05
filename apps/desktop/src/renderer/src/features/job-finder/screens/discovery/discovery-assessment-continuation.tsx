import { useEffect, useRef, useState } from "react";
import type { SavedJob } from "@nordri/contracts";
import { Button } from "@renderer/components/ui/button";
import { isDiscoveryUncheckedResult } from "./discovery-result-groups";

export function DiscoveryAssessmentContinuation(props: {
  jobs: readonly SavedJob[];
  isSearchRunning: boolean;
  onAssess: (jobId: string) => Promise<void>;
}) {
  const unread = props.jobs.filter(isDiscoveryUncheckedResult);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState(false);
  const stopped = useRef(false);
  const busy = useRef(false);
  useEffect(
    () => () => {
      stopped.current = true;
    },
    [],
  );

  const assessMore = async () => {
    if (busy.current) return;
    busy.current = true;
    stopped.current = false;
    setError(false);
    const batch = unread.slice(0, 20);
    setProgress({ done: 0, total: batch.length });
    try {
      for (const [index, job] of batch.entries()) {
        if (stopped.current) break;
        await props.onAssess(job.id);
        if (!stopped.current)
          setProgress({ done: index + 1, total: batch.length });
      }
    } catch {
      if (!stopped.current) setError(true);
    } finally {
      busy.current = false;
      if (!stopped.current) setProgress(null);
    }
  };

  if (unread.length === 0 && !progress) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-xs text-foreground-soft"
      role="status"
    >
      {progress ? (
        <p>
          Assessing listings · {progress.done} of {progress.total} finished.
          Leaving this page stops the batch after the current listing.
        </p>
      ) : !props.isSearchRunning ? (
        <Button size="sm" variant="secondary" onClick={() => void assessMore()}>
          Assess next {Math.min(20, unread.length)} listings
        </Button>
      ) : null}
      {error ? <p>Assessment stopped. Try again to continue.</p> : null}
    </div>
  );
}
