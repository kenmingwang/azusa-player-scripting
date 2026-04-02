import { Button, HStack, Text, VStack, Widget } from "scripting";

import {
  NextTrackIntent,
  OpenAzusaIntent,
  PreviousTrackIntent,
  TogglePlaybackIntent,
} from "./app_intents";
import { loadState } from "./lib/storage";
import type { PlaybackSnapshot } from "./lib/types";

function formatUpdatedAt(isoString?: string) {
  if (!isoString) {
    return "";
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

function ActionRow(props: PlaybackSnapshot) {
  const playPauseTitle =
    props.playbackState === "playing" ? "停" : "播";

  return (
    <HStack spacing={8}>
      <Button
        title="上"
        systemImage="backward.fill"
        intent={PreviousTrackIntent(undefined)}
      />
      <Button
        title={playPauseTitle}
        systemImage="playpause.fill"
        intent={TogglePlaybackIntent(undefined)}
      />
      <Button
        title="下"
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

  const updatedAt = formatUpdatedAt(snapshot.updatedAt);

  return (
    <VStack alignment={"leading"} spacing={8}>
      <Text font={"headline"}>
        {snapshot.currentTrack?.title || snapshot.sourceTitle}
      </Text>
      <Text font={"subheadline"} foregroundColor={"secondary"}>
        {snapshot.currentTrack?.artist || snapshot.ownerName || "Azusa"}
      </Text>
      <Text font={"caption"} foregroundColor={"secondary"}>
        {snapshot.currentIndex >= 0
          ? `${snapshot.currentIndex + 1}/${snapshot.queueLength}`
          : `共 ${snapshot.queueLength} 首`}
      </Text>
      <Text font={"caption"} foregroundColor={"secondary"}>
        {snapshot.sourceTitle}
      </Text>
      <Text font={"caption2"} foregroundColor={"tertiary"}>
        {updatedAt ? `最近同步 ${updatedAt}` : "桌面卡片刷新会慢几秒"}
      </Text>
      <ActionRow {...snapshot} />
    </VStack>
  );
}

Widget.present(<WidgetView />);
