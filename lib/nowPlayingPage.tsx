import {
  HStack,
  List,
  NavigationLink,
  Section,
  Spacer,
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
import { PlaybackProgressView } from "./playbackProgressView";
import {
  PlaybackModeControl,
  TransportControls,
  playbackModeLabel,
} from "./playbackControls";
import { loadTrackLyricsEntry } from "./storage";
import { usePlaybackClock, usePlayerProgress } from "./usePlayerProgress";
import type {
  PlaybackMode,
  PlaybackUiState,
  Track,
  TrackLyricsEntry,
} from "./types";

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

function trackStorageInput(track: Track | null) {
  return {
    id: track?.id,
    title: track?.title,
    artist: track?.artist,
  };
}

export function NowPlayingPage(props: NowPlayingPageProps) {
  const player = getSharedPlayer();
  const progress = usePlayerProgress(player);
  const liveTime = usePlaybackClock(progress, 800);

  const duration = progress.duration || props.currentTrack?.durationSeconds || 0;
  const progressText = `${formatDuration(liveTime)} / ${formatDuration(duration)}`;
  const displayTitle = displayTrackTitle(props.currentTrack, props.sourceTitle);
  const [lyricsEntry, setLyricsEntry] = useState(
    (props.currentTrack
      ? loadTrackLyricsEntry(trackStorageInput(props.currentTrack))
      : null) as TrackLyricsEntry | null,
  );
  const rawLyrics = lyricsEntry?.rawLyric ?? "";

  useEffect(() => {
    if (!props.currentTrack) {
      setLyricsEntry(null);
      return;
    }

    setLyricsEntry(loadTrackLyricsEntry(trackStorageInput(props.currentTrack)));
  }, [props.currentTrack?.id]);

  const parsedLyrics = useMemo(() => parseLyrics(rawLyrics), [rawLyrics]);
  const lyricTime = Math.max(0, liveTime + (lyricsEntry?.offsetMs ?? 0) / 1000);
  const currentLyric = useMemo(
    () => activeLyricLine(parsedLyrics, lyricTime),
    [parsedLyrics, lyricTime],
  );
  const lyricStatus = parsedLyrics.lines.length
    ? parsedLyrics.timed
      ? "已导入同步歌词"
      : "已导入文本歌词"
    : "还没有歌词";
  return (
    <List
      navigationTitle={"正在播放"}
      navigationBarTitleDisplayMode={"inline"}
      listStyle={"plain"}
    >
      <Section>
        <VStack
          alignment={"center"}
          spacing={18}
          padding={{ top: 18, bottom: 10 }}
          listRowSeparator="hidden">
          <ArtworkView
            cover={props.artworkUrl}
            width={300}
            height={188}
            contentMode="fill"
            backgroundStyle="none"
            cornerRadius={28}
            fallbackColor={props.playbackState === "playing" ? "systemBlue" : "systemGray3"}
          />
          <VStack alignment={"center"} spacing={5}>
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
            <PlaybackProgressView progress={progress} />
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
          padding={{ vertical: 8 }}
          listRowSeparator="hidden">
          <HStack spacing={12}>
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
            <Spacer />
          </HStack>
        </VStack>
      </Section>

      <Section header={<Text font={"caption"}>歌词</Text>}>
        <VStack
          alignment={"leading"}
          spacing={10}
          listRowSeparator="hidden">
          <Text font={"caption"} foregroundColor={"secondary"}>
            {lyricStatus}
          </Text>
          <Text font={currentLyric ? "title3" : "body"}>
            {currentLyric?.text ||
              "进入歌词页后查看跟随歌词，再从工具页搜索 QQ 候选或导入 `.lrc` / `.txt`。"}
          </Text>
          <NavigationLink
            destination={
              <LyricsPage
                track={props.currentTrack}
                onLyricsEntryChange={setLyricsEntry}
              />
            }>
            <HStack spacing={12}>
              <VStack alignment={"leading"} spacing={3}>
                <Text font={"body"}>打开歌词页</Text>
                <Text font={"caption"} foregroundColor={"secondary"}>
                  查看跟随歌词，并进入工具页调整歌词来源和偏移
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
