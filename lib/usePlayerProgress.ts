import { useEffect, useState } from "scripting";

import type { PlaybackProgressSnapshot } from "./types";

const globalRuntime = globalThis as any;
const setIntervalApi =
  typeof globalRuntime.setInterval === "function"
    ? globalRuntime.setInterval.bind(globalRuntime)
    : null;
const clearIntervalApi =
  typeof globalRuntime.clearInterval === "function"
    ? globalRuntime.clearInterval.bind(globalRuntime)
    : null;
const setTimeoutApi =
  typeof globalRuntime.setTimeout === "function"
    ? globalRuntime.setTimeout.bind(globalRuntime)
    : null;
const clearTimeoutApi =
  typeof globalRuntime.clearTimeout === "function"
    ? globalRuntime.clearTimeout.bind(globalRuntime)
    : null;

type ProgressSource = {
  getProgressSnapshot: () => PlaybackProgressSnapshot;
  subscribeProgress: (
    listener: (snapshot: PlaybackProgressSnapshot) => void,
  ) => () => void;
};

export function usePlayerProgress(
  player: ProgressSource,
): PlaybackProgressSnapshot {
  const [progress, setProgress] = useState(player.getProgressSnapshot());

  useEffect(() => {
    setProgress(player.getProgressSnapshot());
    return player.subscribeProgress((snapshot) => {
      setProgress(snapshot);
    });
  }, [player]);

  return progress;
}

export function liveCurrentTime(
  progress: PlaybackProgressSnapshot,
  nowMs = Date.now(),
) {
  if (progress.isRunning && typeof progress.timerFrom === "number") {
    return Math.max(
      0,
      progress.currentTime || 0,
      (nowMs - progress.timerFrom) / 1000,
    );
  }

  return Math.max(0, progress.currentTime || 0);
}

export function usePlaybackClock(
  progress: PlaybackProgressSnapshot,
  intervalMs = 200,
) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!progress.isRunning || typeof progress.timerFrom !== "number") {
      return;
    }

    let disposed = false;
    let timeout: number | undefined;
    let interval: number | undefined;
    const sync = () => {
      if (disposed) {
        return;
      }

      setNow(Date.now());

      if (setTimeoutApi) {
        timeout = setTimeoutApi(sync, intervalMs) as unknown as number;
      }
    };

    sync();
    if (!setTimeoutApi && setIntervalApi) {
      interval = setIntervalApi(sync, intervalMs) as unknown as number;
    }

    return () => {
      disposed = true;
      if (timeout != null && clearTimeoutApi) {
        clearTimeoutApi(timeout);
      }
      if (interval != null && clearIntervalApi) {
        clearIntervalApi(interval);
      }
    };
  }, [progress.isRunning, progress.timerFrom, intervalMs]);

  return liveCurrentTime(
    progress,
    progress.isRunning ? Math.max(now, Date.now()) : now,
  );
}
