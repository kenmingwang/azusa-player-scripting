import { Button, HStack, Image, Text, VStack, Widget, ZStack } from "scripting";

import {
  NextTrackIntent,
  OpenAzusaIntent,
  PreviousTrackIntent,
  TogglePlaybackIntent,
} from "./app_intents";
import { loadState } from "./lib/storage";
import type { PlaybackSnapshot } from "./lib/types";

function displayTrackTitle(snapshot: PlaybackSnapshot) {
  const currentTitle = snapshot.currentTrack?.title;
  if (!currentTitle) {
    return snapshot.sourceTitle;
  }

  return currentTitle.startsWith(`${snapshot.sourceTitle} · `)
    ? currentTitle.slice(snapshot.sourceTitle.length + 3)
    : currentTitle;
}

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
    <HStack
      spacing={10}
      padding={6}
      background={{
        style: "rgba(255, 255, 255, 0.08)",
        shape: {
          type: "capsule",
        },
      }}
      clipShape={{
        type: "capsule",
      }}>
      <Button
        title="上"
        systemImage="backward.fill"
        buttonStyle="bordered"
        intent={PreviousTrackIntent(undefined)}
      />
      <Button
        title={playPauseTitle}
        systemImage="playpause.fill"
        buttonStyle="borderedProminent"
        intent={TogglePlaybackIntent(undefined)}
      />
      <Button
        title="下"
        systemImage="forward.fill"
        buttonStyle="bordered"
        intent={NextTrackIntent(undefined)}
      />
    </HStack>
  );
}

function WidgetCard(props: any) {
  const displaySize = (Widget as any)?.displaySize ?? {
    width: 170,
    height: 170,
  };

  return (
    <ZStack
      alignment="topLeading"
      frame={{ width: displaySize.width, height: displaySize.height }}
      clipShape={{
        type: "rect",
        cornerRadius: 28,
        style: "continuous",
      }}
      widgetBackground={{
        style: {
          light: "rgba(241, 245, 249, 0.88)",
          dark: "rgba(15, 23, 42, 0.84)",
        },
        shape: {
          type: "rect",
          cornerRadius: 28,
          style: "continuous",
        },
      }}>
      {props.cover ? (
        <Image
          imageUrl={props.cover}
          frame={{ width: displaySize.width, height: displaySize.height }}
          resizable
          aspectRatio={{ contentMode: "fill" }}
          scaleEffect={1.28}
          blur={20}
          opacity={0.12}
          widgetAccentedRenderingMode="fullColor"
        />
      ) : null}
      <VStack alignment={"leading"} spacing={14} padding={18}>
        {props.children}
      </VStack>
    </ZStack>
  );
}

function EmptyWidget() {
  return (
    <WidgetCard>
      <Text font={"headline"}>Azusa</Text>
      <Text font={"subheadline"} foregroundColor={"secondary"}>
        还没有播放快照，先打开一次完整播放器。
      </Text>
      <Button
        title="打开 Azusa"
        systemImage="music.note.list"
        intent={OpenAzusaIntent(undefined)}
      />
    </WidgetCard>
  );
}

function WidgetView() {
  const snapshot = loadState().playbackSnapshot;
  if (!snapshot) {
    return <EmptyWidget />;
  }

  const updatedAt = formatUpdatedAt(snapshot.updatedAt);
  const isSmall = (Widget as any)?.family === "systemSmall";
  const cover = snapshot.currentTrack?.cover || snapshot.cover;
  const title = displayTrackTitle(snapshot);

  return (
    <WidgetCard cover={cover}>
      <HStack spacing={12}>
        {cover ? (
          <ZStack
            frame={{ width: isSmall ? 60 : 68, height: isSmall ? 60 : 68 }}
            background={{
              style: "rgba(255, 255, 255, 0.08)",
              shape: {
                type: "rect",
                cornerRadius: 18,
                style: "continuous",
              },
            }}
            clipShape={{
              type: "rect",
              cornerRadius: 18,
              style: "continuous",
            }}>
            <Image
              imageUrl={cover}
              frame={{ width: isSmall ? 60 : 68, height: isSmall ? 60 : 68 }}
              resizable
              aspectRatio={{ contentMode: "fill" }}
              interpolation="high"
              antialiased
              clipShape={{
                type: "rect",
                cornerRadius: 16,
                style: "continuous",
              }}
              widgetAccentedRenderingMode="fullColor"
            />
          </ZStack>
        ) : null}
        <VStack alignment={"leading"} spacing={4}>
          <Text font={"caption2"} foregroundColor={"secondary"}>
            Azusa
          </Text>
          <Text font={"headline"}>
            {title}
          </Text>
          <Text font={"subheadline"} foregroundColor={"secondary"}>
            {snapshot.currentTrack?.artist || snapshot.ownerName || "Azusa"}
          </Text>
        </VStack>
      </HStack>

      <Text font={"caption"} foregroundColor={"secondary"}>
        {snapshot.currentIndex >= 0
          ? `${snapshot.currentIndex + 1}/${snapshot.queueLength}`
          : `共 ${snapshot.queueLength} 首`}
        {!isSmall ? ` · ${snapshot.sourceTitle}` : ""}
      </Text>

      <ActionRow {...snapshot} />

      <Text font={"caption2"} foregroundColor={"tertiary"}>
        {updatedAt ? `最近同步 ${updatedAt}` : "桌面卡片刷新会慢几秒"}
      </Text>
    </WidgetCard>
  );
}

Widget.present(<WidgetView />);
