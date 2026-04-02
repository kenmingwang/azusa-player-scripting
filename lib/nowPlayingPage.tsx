import {
  Button,
  HStack,
  List,
  NavigationLink,
  Section,
  Text,
  VStack,
  useEffect,
  useState,
} from "scripting";

import { ArtworkView } from "./artworkView";
import { LyricsPage } from "./lyricsPage";
import { getSharedPlayer } from "./player";
import type { PlaybackMode, PlaybackUiState, Track } from "./types";

const globalRuntime = globalThis as any;
const setIntervalApi =
  typeof globalRuntime.setInterval === "function"
    ? globalRuntime.setInterval.bind(globalRuntime)
    : null;
const clearIntervalApi =
  typeof globalRuntime.clearInterval === "function"
    ? globalRuntime.clearInterval.bind(globalRuntime)
    : null;

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

function modeLabel(mode: PlaybackMode) {
  switch (mode) {
    case "repeatAll":
      return "列表循环";
    case "repeatOne":
      return "单曲循环";
    case "shuffle":
      return "随机播放";
    case "normal":
    default:
      return "顺序播放";
  }
}

export function NowPlayingPage(props: NowPlayingPageProps) {
  const player = getSharedPlayer();
  const [currentTime, setCurrentTime] = useState(player.getCurrentTime());

  useEffect(() => {
    if (!setIntervalApi) {
      return;
    }

    const timer = setIntervalApi(() => {
      setCurrentTime(player.getCurrentTime());
    }, 450) as unknown as number;

    return () => {
      if (clearIntervalApi) {
        clearIntervalApi(timer);
      }
    };
  }, []);

  const duration = props.currentTrack?.durationSeconds ?? player.getDuration();
  const progressText = `${formatDuration(currentTime)} / ${formatDuration(duration)}`;
  const primaryTitle = props.playbackState === "playing" ? "暂停" : "继续播放";

  return (
    <List
      navigationTitle={"正在播放"}
      navigationBarTitleDisplayMode={"inline"}
      listStyle={"plain"}
    >
      <Section>
        <VStack alignment={"leading"} spacing={12}>
          <ArtworkView
            cover={props.artworkUrl}
            size={120}
            fallbackColor={props.playbackState === "playing" ? "systemBlue" : "systemGray3"}
          />
          <VStack alignment={"leading"} spacing={5}>
            <Text font={"title2"}>
              {props.currentTrack?.title || props.sourceTitle}
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
            <Text font={"caption"} foregroundColor={"secondary"}>
              {modeLabel(props.playbackMode)} · {props.currentIndex >= 0
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
        <HStack spacing={10}>
          <Button
            title="上一首"
            buttonStyle="bordered"
            action={() => void props.onPrevious()}
          />
          <Button
            title={primaryTitle}
            buttonStyle="borderedProminent"
            action={() => void props.onPrimaryAction()}
          />
          <Button
            title="下一首"
            buttonStyle="bordered"
            action={() => void props.onNext()}
          />
        </HStack>
        <Button
          title={modeLabel(props.playbackMode)}
          buttonStyle="bordered"
          action={() => props.onCyclePlaybackMode()}
        />
      </Section>

      <Section header={<Text font={"caption"}>内容</Text>}>
        <NavigationLink destination={<LyricsPage track={props.currentTrack} />}>
          <HStack spacing={12}>
            <VStack alignment={"leading"} spacing={3}>
              <Text font={"body"}>歌词</Text>
              <Text font={"caption"} foregroundColor={"secondary"}>
                进入同步歌词页，支持导入 `.lrc` / `.txt`
              </Text>
            </VStack>
            <Text font={"caption"} foregroundColor={"systemBlue"}>
              打开
            </Text>
          </HStack>
        </NavigationLink>
      </Section>
    </List>
  );
}
