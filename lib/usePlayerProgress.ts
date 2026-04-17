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
    return Math.max(0, (nowMs - progress.timerFrom) / 1000);
  }

  return Math.max(0, progress.currentTime || 0);
}

export function usePlaybackClock(
  progress: PlaybackProgressSnapshot,
  intervalMs = 200,
) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (
      !setIntervalApi ||
      !progress.isRunning ||
      typeof progress.timerFrom !== "number"
    ) {
      return;
    }

    const sync = () => {
      setNow(Date.now());
    };

    sync();
    const timer = setIntervalApi(sync, intervalMs) as unknown as number;

    return () => {
      if (clearIntervalApi) {
        clearIntervalApi(timer);
      }
    };
  }, [progress.isRunning, progress.timerFrom, intervalMs]);

  return liveCurrentTime(progress, now);
}
