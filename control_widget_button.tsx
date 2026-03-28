import { ControlWidget, ControlWidgetButton } from "scripting";

import { OpenAzusaIntent, TogglePlaybackIntent } from "./app_intents";
import { loadState } from "./lib/storage";

const snapshot = loadState().playbackSnapshot;
const isPlaying = snapshot?.playbackState === "playing";
const hasSnapshot = Boolean(snapshot);

ControlWidget.present(
  <ControlWidgetButton
    privacySensitive
    intent={
      hasSnapshot ? TogglePlaybackIntent(undefined) : OpenAzusaIntent(undefined)
    }
    label={{
      title: hasSnapshot ? "Azusa" : "打开 Azusa",
      systemImage: hasSnapshot ? "playpause.fill" : "music.note.list",
    }}
    activeValueLabel={
      hasSnapshot
        ? {
            title: isPlaying ? "暂停播放" : "继续播放",
          }
        : null
    }
    inactiveValueLabel={
      hasSnapshot
        ? {
            title: isPlaying ? "暂停播放" : "继续播放",
          }
        : null
    }
  />,
);
