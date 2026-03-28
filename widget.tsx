import { Button, HStack, Text, VStack, Widget } from "scripting";

import {
  NextTrackIntent,
  OpenAzusaIntent,
  PreviousTrackIntent,
  TogglePlaybackIntent,
} from "./app_intents";
import { loadState } from "./lib/storage";

function playbackLabel(state?: string) {
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
      return "尚未开始";
  }
}

function ActionRow() {
  return (
    <HStack spacing={8}>
      <Button
        title="上一首"
        systemImage="backward.fill"
        intent={PreviousTrackIntent(undefined)}
      />
      <Button
        title="播放/暂停"
        systemImage="playpause.fill"
        intent={TogglePlaybackIntent(undefined)}
      />
      <Button
        title="下一首"
        systemImage="forward.fill"
        intent={NextTrackIntent(undefined)}
      />
    </HStack>
  );
}

function EmptyWidget() {
  return (
    <VStack alignment={"leading"} spacing={8}>
      <Text font={"headline"}>Azusa</Text>
      <Text font={"subheadline"} foregroundColor={"secondary"}>
        还没有播放快照，先打开一次完整播放器。
      </Text>
      <Button
        title="打开 Azusa"
        systemImage="music.note.list"
        intent={OpenAzusaIntent(undefined)}
      />
    </VStack>
  );
}

function WidgetView() {
  const snapshot = loadState().playbackSnapshot;
  if (!snapshot) {
    return <EmptyWidget />;
  }

  return (
    <VStack alignment={"leading"} spacing={8}>
      <Text font={"headline"}>
        {snapshot.currentTrack?.title || snapshot.sourceTitle}
      </Text>
      <Text font={"subheadline"} foregroundColor={"secondary"}>
        {snapshot.currentTrack?.artist || snapshot.ownerName || "Azusa"}
      </Text>
      <Text font={"caption"} foregroundColor={"secondary"}>
        {playbackLabel(snapshot.playbackState)} · {snapshot.currentIndex >= 0
          ? `${snapshot.currentIndex + 1}/${snapshot.queueLength}`
          : `共 ${snapshot.queueLength} 首`}
      </Text>
      <Text font={"caption"} foregroundColor={"secondary"}>
        {snapshot.sourceTitle}
      </Text>
      <ActionRow />
    </VStack>
  );
}

Widget.present(<WidgetView />);
