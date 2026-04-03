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
  intervalMs = 250,
): PlaybackProgressSnapshot {
  const [progress, setProgress] = useState(player.getProgressSnapshot());

  useEffect(() => {
    setProgress(player.getProgressSnapshot());
    return player.subscribeProgress((snapshot) => {
      setProgress(snapshot);
    });
  }, [player]);

  useEffect(() => {
    if (!setIntervalApi) {
      return;
    }

    const sync = () => {
      setProgress(player.getProgressSnapshot());
    };

    sync();
    const timer = setIntervalApi(sync, intervalMs) as unknown as number;

    return () => {
      if (clearIntervalApi) {
        clearIntervalApi(timer);
      }
    };
  }, [player, intervalMs]);

  return progress;
}
