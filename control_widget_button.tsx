import { ControlWidget, ControlWidgetButton } from "scripting";

import {
  NextTrackIntent,
  OpenAzusaIntent,
  PreviousTrackIntent,
  TogglePlaybackIntent,
} from "./app_intents";
import { loadState } from "./lib/storage";

const snapshot = loadState().playbackSnapshot;
const isPlaying = snapshot?.playbackState === "playing";
const hasSnapshot = Boolean(snapshot);
const mode = String(ControlWidget.parameter || "playPause");

const actionMap = {
  playPause: {
    intent: hasSnapshot ? TogglePlaybackIntent(undefined) : OpenAzusaIntent(undefined),
    title: hasSnapshot ? "Azusa" : "打开 Azusa",
    systemImage: hasSnapshot ? "playpause.fill" : "music.note.list",
    valueLabel: hasSnapshot ? (isPlaying ? "暂停播放" : "继续播放") : "打开 Azusa",
  },
  next: {
    intent: hasSnapshot ? NextTrackIntent(undefined) : OpenAzusaIntent(undefined),
    title: "下一首",
    systemImage: "forward.fill",
    valueLabel: hasSnapshot ? "切到下一首" : "打开 Azusa",
  },
  previous: {
    intent: hasSnapshot ? PreviousTrackIntent(undefined) : OpenAzusaIntent(undefined),
    title: "上一首",
    systemImage: "backward.fill",
    valueLabel: hasSnapshot ? "切到上一首" : "打开 Azusa",
  },
  open: {
    intent: OpenAzusaIntent(undefined),
    title: "打开 Azusa",
    systemImage: "music.note.list",
    valueLabel: "打开播放器",
  },
} as const;

const config = actionMap[mode as keyof typeof actionMap] ?? actionMap.playPause;

ControlWidget.present(
  <ControlWidgetButton
    privacySensitive
    intent={config.intent}
    label={{
      title: config.title,
      systemImage: config.systemImage,
    }}
    activeValueLabel={
      mode === "open"
        ? null
        : hasSnapshot
        ? {
            title: config.valueLabel,
          }
        : null
    }
    inactiveValueLabel={
      mode === "open"
        ? null
        : hasSnapshot
        ? {
            title: config.valueLabel,
          }
        : null
    }
  />,
);
