import { ProgressView } from "scripting";

import type { PlaybackProgressSnapshot } from "./types";

type PlaybackProgressViewProps = {
  progress: PlaybackProgressSnapshot;
};

export function PlaybackProgressView(props: PlaybackProgressViewProps) {
  const { progress } = props;

  if (progress.isRunning && progress.timerFrom && progress.timerTo) {
    return (
      <ProgressView
        timerFrom={progress.timerFrom}
        timerTo={progress.timerTo}
        countsDown={false}
        progressViewStyle="linear"
      />
    );
  }

  if (progress.duration > 0) {
    return (
      <ProgressView
        value={Math.max(0, Math.min(progress.currentTime, progress.duration))}
        total={progress.duration}
        progressViewStyle="linear"
      />
    );
  }

  return null;
}
