import { ProgressView } from "scripting";

import type { PlaybackProgressSnapshot } from "./types";

type PlaybackProgressViewProps = {
  progress: PlaybackProgressSnapshot;
};

export function PlaybackProgressView(props: PlaybackProgressViewProps) {
  const { progress } = props;
  const hiddenValueLabel = <></>;

  if (
    progress.isRunning &&
    typeof progress.timerFrom === "number" &&
    typeof progress.timerTo === "number"
  ) {
    return (
      <ProgressView
        timerFrom={progress.timerFrom}
        timerTo={progress.timerTo}
        countsDown={false}
        progressViewStyle="linear"
        currentValueLabel={hiddenValueLabel}
      />
    );
  }

  if (progress.duration > 0) {
    return (
      <ProgressView
        value={Math.max(0, Math.min(progress.currentTime, progress.duration))}
        total={progress.duration}
        progressViewStyle="linear"
        currentValueLabel={hiddenValueLabel}
      />
    );
  }

  return null;
}
