import {
  HStack,
  List,
  NavigationLink,
  ProgressView,
  Section,
  Text,
  VStack,
  useEffect,
  useMemo,
  useState,
} from "scripting";

import { ArtworkView } from "./artworkView";
import { activeLyricLine, parseLyrics } from "./lyrics";
import { LyricsPage } from "./lyricsPage";
import { getSharedPlayer } from "./player";
import {
  PlaybackModeControl,
  TransportControls,
  playbackModeLabel,
} from "./playbackControls";
import { loadTrackLyrics } from "./storage";
import type { PlaybackMode, PlaybackUiState, Track } from "./types";

type NowPlayingPageProps = {
  currentTrack: Track | null;
  artworkUrl?: string;
  sourceTitle: string;
  playbackState: PlaybackUiState;
  playbackMode: PlaybackMode;
  playbackDetail?: string;
  currentIndex: number;
  queueLength: number;
  onPrimaryAction: () => void | Promise<void>;
  onPrevious: () => void | Promise<void>;
  onNext: () => void | Promise<void>;
  onCyclePlaybackMode: () => void;
};

function formatDuration(seconds?: number) {
  if (!seconds || seconds <= 0) {
    return "00:00";
  }

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function displayTrackTitle(track: Track | null, sourceTitle: string) {
  if (!track) {
    return sourceTitle;
  }

  return track.title.startsWith(`${sourceTitle} · `)
    ? track.title.slice(sourceTitle.length + 3)
    : track.title;
}

export function NowPlayingPage(props: NowPlayingPageProps) {
  const player = getSharedPlayer();
  const [progress, setProgress] = useState(player.getProgressSnapshot());

  useEffect(() => {
    return player.subscribeProgress((snapshot) => {
      setProgress(snapshot);
    });
  }, []);

  const duration = progress.duration || props.currentTrack?.durationSeconds || 0;
  const progressText = `${formatDuration(progress.currentTime)} / ${formatDuration(duration)}`;
  const displayTitle = displayTrackTitle(props.currentTrack, props.sourceTitle);
  const rawLyrics = props.currentTrack
    ? loadTrackLyrics({
        id: props.currentTrack.id,
        title: props.currentTrack.title,
        artist: props.currentTrack.artist,
      })
    : "";
  const parsedLyrics = useMemo(() => parseLyrics(rawLyrics), [rawLyrics]);
  const currentLyric = useMemo(
    () => activeLyricLine(parsedLyrics, progress.currentTime),
    [parsedLyrics, progress.currentTime],
  );
  const lyricStatus = parsedLyrics.lines.length
    ? parsedLyrics.timed
      ? "已导入同步歌词"
      : "已导入文本歌词"
    : "还没有歌词";
  const progressValue =
    duration > 0
      ? Math.max(0, Math.min(progress.currentTime, duration))
      : undefined;

  return (
    <List
      navigationTitle={"正在播放"}
      navigationBarTitleDisplayMode={"inline"}
      listStyle={"plain"}
    >
      <Section>
        <VStack
          alignment={"leading"}
          spacing={16}
          padding={{ top: 12, bottom: 8 }}
          listRowSeparator="hidden">
          <ArtworkView
            cover={props.artworkUrl}
            width={236}
            height={236}
            contentMode="fill"
            backgroundStyle="none"
            cornerRadius={28}
            fallbackColor={props.playbackState === "playing" ? "systemBlue" : "systemGray3"}
          />
          <VStack alignment={"leading"} spacing={5}>
            <Text font={"title2"}>
              {displayTitle}
            </Text>
            <Text font={"subheadline"} foregroundColor={"secondary"}>
              {props.currentTrack?.artist || "Azusa"}
            </Text>
            <Text font={"caption"} foregroundColor={"secondary"}>
              {props.sourceTitle}
            </Text>
            <Text font={"caption"} foregroundColor={"secondary"}>
              {progressText}
            </Text>
            {typeof progressValue === "number" && duration > 0 ? (
              <ProgressView
                value={progressValue}
                total={duration}
                progressViewStyle="linear"
              />
            ) : null}
            <Text font={"caption"} foregroundColor={"secondary"}>
              {playbackModeLabel(props.playbackMode)} · {props.currentIndex >= 0
                ? `${props.currentIndex + 1}/${props.queueLength}`
                : `共 ${props.queueLength} 首`}
            </Text>
            {props.playbackDetail ? (
              <Text font={"caption"} foregroundColor={"secondary"}>
                {props.playbackDetail}
              </Text>
            ) : null}
          </VStack>
        </VStack>
      </Section>

      <Section header={<Text font={"caption"}>播放控制</Text>}>
        <VStack
          alignment={"leading"}
          spacing={12}
          padding={16}
          background={{
            style: {
              light: "rgba(239, 246, 255, 0.95)",
              dark: "rgba(37, 99, 235, 0.14)",
            },
            shape: {
              type: "rect",
              cornerRadius: 24,
              style: "continuous",
              },
            }}
          listRowSeparator="hidden">
          <TransportControls
            playbackState={props.playbackState}
            onPrevious={() => void props.onPrevious()}
            onPrimaryAction={() => void props.onPrimaryAction()}
            onNext={() => void props.onNext()}
          />
          <PlaybackModeControl
            playbackMode={props.playbackMode}
            onCyclePlaybackMode={props.onCyclePlaybackMode}
          />
        </VStack>
      </Section>

      <Section header={<Text font={"caption"}>歌词</Text>}>
        <VStack
          alignment={"leading"}
          spacing={8}
          listRowSeparator="hidden">
          <Text font={"caption"} foregroundColor={"secondary"}>
            {lyricStatus}
          </Text>
          <Text font={currentLyric ? "headline" : "body"}>
            {currentLyric?.text ||
              "进入歌词页后会自动搜索 QQ 歌词，也支持导入 `.lrc` / `.txt`。"}
          </Text>
          <NavigationLink destination={<LyricsPage track={props.currentTrack} />}>
            <HStack spacing={12}>
              <VStack alignment={"leading"} spacing={3}>
                <Text font={"body"}>打开歌词页</Text>
                <Text font={"caption"} foregroundColor={"secondary"}>
                  搜索歌词候选、导入本地歌词、查看同步高亮
                </Text>
              </VStack>
              <Text font={"caption"} foregroundColor={"systemBlue"}>
                打开
              </Text>
            </HStack>
          </NavigationLink>
        </VStack>
      </Section>
    </List>
  );
}
