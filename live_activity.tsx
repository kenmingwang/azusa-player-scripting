import {
  HStack,
  Image,
  LiveActivity,
  LiveActivityUI,
  LiveActivityUIExpandedBottom,
  LiveActivityUIExpandedCenter,
  Text,
  VStack,
} from "scripting";

import type { AzusaLiveActivityState } from "./lib/externalBridge";

function playbackLabel(state: AzusaLiveActivityState["playbackState"]) {
  switch (state) {
    case "playing":
      return "正在播放";
    case "paused":
      return "已暂停";
    case "loading":
      return "加载中";
    case "error":
      return "播放出错";
    default:
      return "待机中";
  }
}

function stateSymbol(state: AzusaLiveActivityState["playbackState"]) {
  switch (state) {
    case "playing":
      return "play.fill";
    case "paused":
      return "pause.fill";
    case "loading":
      return "arrow.trianglehead.2.clockwise";
    case "error":
      return "exclamationmark.triangle.fill";
    default:
      return "music.note";
  }
}

function LiveActivityContent(state: AzusaLiveActivityState) {
  return (
    <VStack alignment={"leading"} spacing={4}>
      <Text font={"headline"}>{state.title}</Text>
      <Text font={"subheadline"} foregroundColor={"secondary"}>
        {state.artist}
      </Text>
      <Text font={"caption"} foregroundColor={"secondary"}>
        {playbackLabel(state.playbackState)} · {state.currentIndex + 1}/{state.queueLength}
      </Text>
    </VStack>
  );
}

export const AzusaNowPlayingLiveActivity = LiveActivity.register(
  "AzusaNowPlayingLiveActivity",
  (state: AzusaLiveActivityState) => (
    <LiveActivityUI
      content={
        <HStack spacing={10}>
          <Image systemName={stateSymbol(state.playbackState)} />
          <LiveActivityContent {...state} />
        </HStack>
      }
      compactLeading={<Text>{state.currentIndex + 1}</Text>}
      compactTrailing={<Image systemName={stateSymbol(state.playbackState)} />}
      minimal={<Image systemName={stateSymbol(state.playbackState)} />}>
      <LiveActivityUIExpandedCenter>
        <LiveActivityContent {...state} />
      </LiveActivityUIExpandedCenter>
      <LiveActivityUIExpandedBottom>
        <Text font={"caption"} foregroundColor={"secondary"}>
          {state.sourceTitle}
        </Text>
      </LiveActivityUIExpandedBottom>
    </LiveActivityUI>
  ),
);
