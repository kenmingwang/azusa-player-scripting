import {
  Button,
  Circle,
  Dialog,
  HStack,
  List,
  NavigationStack,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useState,
} from "scripting";

import { importFromInput } from "./api";
import {
  getNativePlayerCompatibilityMessage,
  getSharedPlayer,
} from "./player";
import { loadState, saveState } from "./storage";
import type { PlaybackUiState, Track } from "./types";

const DEFAULT_BVID = "BV1wr4y1v7TA";

type DefaultPlaylistAppProps = {
  initialInput?: string;
};

function describeState(state: PlaybackUiState, detail?: string) {
  if (detail) return detail;

  switch (state) {
    case "idle":
      return "还没开始播放";
    case "loading":
      return "正在准备音频流";
    case "playing":
      return "正在播放";
    case "paused":
      return "已暂停";
    case "error":
      return "播放失败";
    default:
      return state;
  }
}

function trackStatusLabel(
  playbackState: PlaybackUiState,
  isActive: boolean,
  isBusy: boolean,
) {
  if (isBusy && isActive) return "准备中";
  if (!isActive) return "点播";
  if (playbackState === "playing") return "播放中";
  if (playbackState === "loading") return "加载中";
  if (playbackState === "paused") return "已暂停";
  if (playbackState === "error") return "失败";
  return "当前";
}

function sourceSummary(input: string) {
  if (input.startsWith("BV")) return input;
  return input.replace(/^https?:\/\//, "");
}

export function DefaultPlaylistApp(props: DefaultPlaylistAppProps) {
  const persistedState = loadState();
  const requestedInput = props.initialInput?.trim();
  const canRestoreQueue =
    !requestedInput || requestedInput === persistedState.lastInput;
  const initialInput = requestedInput || persistedState.lastInput || DEFAULT_BVID;
  const initialTracks = canRestoreQueue ? persistedState.queue : [];
  const initialCurrentIndex =
    canRestoreQueue && persistedState.currentTrackId
      ? initialTracks.findIndex((track) => track.id === persistedState.currentTrackId)
      : -1;
  const initialCurrentTrack =
    initialCurrentIndex >= 0 ? initialTracks[initialCurrentIndex] : null;

  const player = getSharedPlayer();
  const [activeInput, setActiveInput] = useState(initialInput);
  const [loading, setLoading] = useState(false);
  const [playLoading, setPlayLoading] = useState(false);
  const [error, setError] = useState(null as string | null);
  const [sourceTitle, setSourceTitle] = useState(
    persistedState.sourceTitle || "Azusa Player",
  );
  const [ownerName, setOwnerName] = useState("");
  const [tracks, setTracks] = useState(initialTracks);
  const [playbackState, setPlaybackState] = useState("idle" as PlaybackUiState);
  const [playbackDetail, setPlaybackDetail] = useState("");
  const [currentIndex, setCurrentIndex] = useState(initialCurrentIndex);
  const [currentTrack, setCurrentTrack] = useState(initialCurrentTrack as Track | null);
  const [playerMessage] = useState(getNativePlayerCompatibilityMessage());

  async function loadPlaylist(nextInput?: string) {
    const normalizedInput = nextInput?.trim() || activeInput || DEFAULT_BVID;
    const isChangingSource = normalizedInput !== activeInput;

    setLoading(true);
    setError(null);

    try {
      const result = await importFromInput(normalizedInput);
      const matchedTrackId = isChangingSource ? undefined : currentTrack?.id;
      const matchedIndex = matchedTrackId
        ? result.tracks.findIndex((track) => track.id === matchedTrackId)
        : -1;

      if (isChangingSource) {
        player.stop();
      }

      setActiveInput(normalizedInput);
      setSourceTitle(result.sourceTitle);
      setOwnerName(result.ownerName);
      setTracks(result.tracks);
      setCurrentIndex(matchedIndex);
      setCurrentTrack(matchedIndex >= 0 ? result.tracks[matchedIndex] : null);
      player.setQueue(result.tracks);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  }

  async function promptImport() {
    const nextInput = await Dialog.prompt({
      title: "导入 BV / 链接",
      message: "输入 Bilibili BV 号或完整视频链接。",
      defaultValue: activeInput,
      placeholder: "例如 BV1wr4y1v7TA",
      confirmLabel: "导入",
      cancelLabel: "取消",
      selectAll: true,
    });

    if (nextInput == null) {
      return;
    }

    const trimmed = nextInput.trim();
    if (!trimmed) {
      setError("请输入 BV 号或 Bilibili 链接");
      return;
    }

    await loadPlaylist(trimmed);
  }

  async function openSourceActions() {
    const selection = await Dialog.actionSheet({
      title: "选择来源",
      message: "你可以导入新的 BV / 链接，或切回默认歌单。",
      actions: [
        { label: "输入 BV / 链接" },
        { label: "切回默认歌单" },
      ],
    });

    if (selection === 0) {
      await promptImport();
    } else if (selection === 1) {
      await loadPlaylist(DEFAULT_BVID);
    }
  }

  async function playTrackAt(index: number) {
    if (index < 0 || index >= tracks.length) {
      return;
    }

    setPlayLoading(true);
    setError(null);

    try {
      player.setQueue(tracks);
      await player.playIndex(index);
    } catch (playError) {
      setError(playError instanceof Error ? playError.message : String(playError));
    } finally {
      setPlayLoading(false);
    }
  }

  async function skipBy(delta: number) {
    setPlayLoading(true);
    setError(null);

    try {
      await player.skip(delta);
    } catch (skipError) {
      setError(skipError instanceof Error ? skipError.message : String(skipError));
    } finally {
      setPlayLoading(false);
    }
  }

  async function handlePrimaryAction() {
    if (!currentTrack) {
      await playTrackAt(0);
      return;
    }

    try {
      player.toggle();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : String(toggleError));
    }
  }

  useEffect(() => {
    player.bind({
      onQueueChange: (queue) => {
        setTracks(queue);
      },
      onCurrentTrackChange: (track, index) => {
        setCurrentTrack(track);
        setCurrentIndex(index);
      },
      onStateChange: (state, detail) => {
        setPlaybackState(state);
        setPlaybackDetail(detail ?? "");
      },
      onError: (message) => {
        setError(message);
      },
    });

    if (initialTracks.length > 0) {
      player.setQueue(initialTracks);
    }

    void loadPlaylist(initialInput);

    return () => {
      player.bind({});
    };
  }, []);

  useEffect(() => {
    saveState({
      lastInput: activeInput,
      sourceTitle,
      queue: tracks,
      currentTrackId: currentTrack?.id,
    });
  }, [activeInput, sourceTitle, tracks, currentTrack?.id]);

  const playbackLabel = describeState(playbackState, playbackDetail);
  const queueSummary = loading ? "正在同步歌单..." : `共 ${tracks.length} 首`;
  const primaryButtonTitle = currentTrack
    ? playbackState === "playing"
      ? "暂停"
      : "继续播放"
    : "播放第 1 首";

  return (
    <NavigationStack>
      <List
        navigationTitle={"Azusa"}
        navigationBarTitleDisplayMode={"large"}
        listStyle={"plain"}
      >
        <Section header={<Text font={"caption"}>正在播放</Text>}>
          <HStack spacing={14}>
            <Circle
              fill={playbackState === "playing" ? "systemBlue" : "systemGray4"}
              frame={{ width: 56, height: 56 }}
            />
            <VStack alignment={"leading"} spacing={4}>
              <Text font={"title3"}>
                {currentTrack?.title || sourceTitle}
              </Text>
              <Text font={"subheadline"} foregroundColor={"secondary"}>
                {ownerName ? `UP · ${ownerName}` : "Bilibili 导入播放器"}
              </Text>
              <Text font={"caption"} foregroundColor={"secondary"}>
                {playbackLabel}
              </Text>
            </VStack>
          </HStack>

          <VStack alignment={"leading"} spacing={6}>
            <Text font={"headline"}>{sourceTitle}</Text>
            <Text font={"subheadline"} foregroundColor={"secondary"}>
              {sourceSummary(activeInput)}
            </Text>
            <Text font={"caption"} foregroundColor={"secondary"}>
              {queueSummary}
            </Text>
          </VStack>

          <HStack spacing={10}>
            <Button
              title={playLoading ? "准备中..." : primaryButtonTitle}
              buttonStyle="borderedProminent"
              action={() => void handlePrimaryAction()}
            />
            <Button
              title="上一首"
              buttonStyle="bordered"
              action={() => void skipBy(-1)}
            />
            <Button
              title="下一首"
              buttonStyle="bordered"
              action={() => void skipBy(1)}
            />
          </HStack>

          {playerMessage ? (
            <Text font={"caption"} foregroundColor={"systemOrange"}>
              {playerMessage}
            </Text>
          ) : null}
          {error ? (
            <Text font={"caption"} foregroundColor={"systemRed"}>
              {error}
            </Text>
          ) : null}
        </Section>

        <Section header={<Text font={"caption"}>来源</Text>}>
          <HStack>
            <VStack alignment={"leading"} spacing={3}>
              <Text font={"headline"}>当前输入</Text>
              <Text font={"subheadline"} foregroundColor={"secondary"}>
                {activeInput}
              </Text>
            </VStack>
            <Spacer />
          </HStack>

          <HStack spacing={10}>
            <Button
              title="切换来源"
              buttonStyle="borderedProminent"
              action={() => void openSourceActions()}
            />
            <Button
              title={loading ? "刷新中..." : "重新拉取"}
              buttonStyle="bordered"
              action={() => void loadPlaylist()}
            />
          </HStack>
        </Section>

        <Section header={<Text font={"caption"}>播放队列</Text>}>
          {tracks.length === 0 ? (
            <VStack alignment={"leading"} spacing={4}>
              <Text font={"headline"}>还没有歌单</Text>
              <Text font={"subheadline"} foregroundColor={"secondary"}>
                先导入一个 BV 或视频链接，我们就能把完整队列拉下来。
              </Text>
            </VStack>
          ) : (
            tracks.map((track: Track, index: number) => {
              const isActive = currentIndex === index;
              return (
                <Button
                  action={() => void playTrackAt(index)}
                  key={track.id}
                >
                  <HStack spacing={12}>
                    <VStack alignment={"leading"} spacing={4}>
                      <Text font={isActive ? "headline" : "body"}>
                        {index + 1}. {track.title}
                      </Text>
                      <Text font={"caption"} foregroundColor={"secondary"}>
                        {track.artist} · CID {track.cid}
                      </Text>
                    </VStack>
                    <Spacer />
                    <Text
                      font={"caption"}
                      foregroundColor={isActive ? "systemBlue" : "secondary"}
                    >
                      {trackStatusLabel(playbackState, isActive, playLoading)}
                    </Text>
                  </HStack>
                </Button>
              );
            })
          )}
        </Section>
      </List>
    </NavigationStack>
  );
}
