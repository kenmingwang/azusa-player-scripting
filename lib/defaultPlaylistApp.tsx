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
  useMemo,
  useState,
} from "scripting";

import { importFromSource } from "./api";
import {
  buildPlaybackSnapshot,
  reloadExternalSurfaces,
  toLiveActivityState,
} from "./externalBridge";
import {
  getNativePlayerCompatibilityMessage,
  getSharedPlayer,
} from "./player";
import {
  clearPendingExternalCommand,
  loadState,
  persistPlayerState,
  rememberRecentSource,
} from "./storage";
import {
  createVideoSource,
  isSameSource,
  parseSourceInput,
  sourceKindLabel,
  sourceSecondaryLabel,
  sourceShortLabel,
} from "./sources";
import type {
  PendingExternalCommand,
  PlaybackUiState,
  SourceDescriptor,
  Track,
} from "./types";
import { AzusaNowPlayingLiveActivity } from "../live_activity";

const DEFAULT_SOURCE = createVideoSource("BV1wr4y1v7TA", "默认歌单");

const globalRuntime = globalThis as any;
const setIntervalApi =
  typeof globalRuntime.setInterval === "function"
    ? globalRuntime.setInterval.bind(globalRuntime)
    : null;
const clearIntervalApi =
  typeof globalRuntime.clearInterval === "function"
    ? globalRuntime.clearInterval.bind(globalRuntime)
    : null;

type DefaultPlaylistAppProps = {
  initialInput?: string;
};

type SourcePromptKind = SourceDescriptor["kind"];

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

function promptMeta(kind: SourcePromptKind) {
  switch (kind) {
    case "video":
      return {
        title: "导入视频",
        message: "输入 BV 号或 Bilibili 视频链接。",
        placeholder: "例如 BV1wr4y1v7TA",
      };
    case "favorite":
      return {
        title: "导入收藏夹",
        message: "输入 favorite:media_id，或直接贴 ml 开头的收藏夹链接。",
        placeholder: "例如 favorite:69072721 或 ml69072721",
      };
    case "collection":
      return {
        title: "导入合集",
        message: "支持 season:mid:id、series:mid:id，或对应的 space 链接。",
        placeholder: "例如 season:8251621:6203453",
      };
    case "channel":
      return {
        title: "导入频道",
        message: "输入 channel:mid，或直接贴 UP 主页链接。",
        placeholder: "例如 channel:8251621",
      };
    default:
      return {
        title: "导入来源",
        message: "输入一个来源标识。",
        placeholder: "",
      };
  }
}

function commandLabel(command: PendingExternalCommand["type"]) {
  switch (command) {
    case "playPause":
      return "播放 / 暂停";
    case "next":
      return "下一首";
    case "previous":
      return "上一首";
    case "openSource":
      return "打开来源";
    case "openApp":
      return "打开 Azusa";
    default:
      return command;
  }
}

export function DefaultPlaylistApp(props: DefaultPlaylistAppProps) {
  const persistedState = loadState();
  const requestedInput = props.initialInput?.trim() || "";
  const requestedSource = requestedInput ? parseSourceInput(requestedInput) : null;
  const storedSource =
    persistedState.sourceDescriptor ||
    (persistedState.lastInput ? parseSourceInput(persistedState.lastInput) : null) ||
    DEFAULT_SOURCE;
  const initialSource = requestedSource || storedSource;
  const canRestoreQueue = !requestedSource || isSameSource(requestedSource, storedSource);
  const initialTracks = canRestoreQueue ? persistedState.queue : [];
  const initialCurrentIndex =
    canRestoreQueue && persistedState.currentTrackId
      ? initialTracks.findIndex((track) => track.id === persistedState.currentTrackId)
      : -1;
  const initialCurrentTrack =
    initialCurrentIndex >= 0 ? initialTracks[initialCurrentIndex] : null;
  const initialSnapshot = canRestoreQueue ? persistedState.playbackSnapshot : null;
  const initialInputError =
    requestedInput && !requestedSource
      ? "这个来源格式暂时没识别出来，请改成 BV / 视频链接，或 favorite:mediaId、season:mid:id、series:mid:id、channel:mid"
      : "";

  const player = getSharedPlayer();
  const commandBridge = useMemo(
    () => ({
      busy: false,
      lastHandledId: "",
    }),
    [],
  );
  const liveActivity = useMemo(() => {
    try {
      return AzusaNowPlayingLiveActivity();
    } catch {
      return null;
    }
  }, []);
  const liveActivityBridge = useMemo(
    () => ({
      started: false,
      lastKey: "",
    }),
    [],
  );

  const [activeSource, setActiveSource] = useState(initialSource);
  const [loading, setLoading] = useState(false);
  const [playLoading, setPlayLoading] = useState(false);
  const [error, setError] = useState(null as string | null);
  const [sourceTitle, setSourceTitle] = useState(
    initialSnapshot?.sourceTitle || initialSource.titleHint || "Azusa",
  );
  const [ownerName, setOwnerName] = useState(initialSnapshot?.ownerName || "");
  const [sourceCover, setSourceCover] = useState(initialSnapshot?.cover || "");
  const [tracks, setTracks] = useState(initialTracks);
  const [recentSources, setRecentSources] = useState(
    persistedState.recentSources ?? [],
  );
  const [playbackState, setPlaybackState] = useState("idle" as PlaybackUiState);
  const [playbackDetail, setPlaybackDetail] = useState("");
  const [currentIndex, setCurrentIndex] = useState(initialCurrentIndex);
  const [currentTrack, setCurrentTrack] = useState(initialCurrentTrack as Track | null);
  const [playerMessage] = useState(getNativePlayerCompatibilityMessage());

  async function loadSource(nextSource?: SourceDescriptor) {
    const source = nextSource || activeSource || DEFAULT_SOURCE;
    const changingSource = !isSameSource(source, activeSource);

    setLoading(true);
    setError(null);

    try {
      const result = await importFromSource(source);
      const matchedTrackId = changingSource ? undefined : currentTrack?.id;
      const matchedIndex = matchedTrackId
        ? result.tracks.findIndex((track) => track.id === matchedTrackId)
        : -1;

      if (changingSource) {
        player.stop();
      }

      setActiveSource(result.source);
      setSourceTitle(result.sourceTitle);
      setOwnerName(result.ownerName);
      setSourceCover(result.cover || "");
      setTracks(result.tracks);
      setCurrentIndex(matchedIndex);
      setCurrentTrack(matchedIndex >= 0 ? result.tracks[matchedIndex] : null);
      setRecentSources((current) => {
        const next = [
          result.source,
          ...current.filter((item) => item.input !== result.source.input),
        ].slice(0, 8);
        return next;
      });

      rememberRecentSource(result.source);
      player.setQueue(result.tracks, matchedTrackId ?? null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  }

  async function promptForSource(kind: SourcePromptKind) {
    const meta = promptMeta(kind);
    const defaultValue = activeSource.kind === kind ? activeSource.input : "";
    const nextInput = await Dialog.prompt({
      title: meta.title,
      message: meta.message,
      defaultValue,
      placeholder: meta.placeholder,
      confirmLabel: "导入",
      cancelLabel: "取消",
      selectAll: true,
    });

    if (nextInput == null) {
      return;
    }

    const source = parseSourceInput(nextInput.trim());
    if (!source || source.kind !== kind) {
      setError(`这个输入不是有效的${sourceKindLabel(kind)}来源`);
      return;
    }

    await loadSource(source);
  }

  async function openSourceActions() {
    const selection = await Dialog.actionSheet({
      title: "切换来源",
      message: "现在可以直接导入视频、收藏夹、合集和频道。",
      actions: [
        { label: "导入视频 / BV" },
        { label: "导入收藏夹" },
        { label: "导入合集" },
        { label: "导入频道" },
        { label: "切回默认歌单" },
      ],
    });

    if (selection === 0) {
      await promptForSource("video");
    } else if (selection === 1) {
      await promptForSource("favorite");
    } else if (selection === 2) {
      await promptForSource("collection");
    } else if (selection === 3) {
      await promptForSource("channel");
    } else if (selection === 4) {
      await loadSource(DEFAULT_SOURCE);
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
      await player.toggle();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : String(toggleError));
    }
  }

  async function processPendingCommand() {
    if (commandBridge.busy || loading || playLoading) {
      return;
    }

    const pending = loadState().pendingExternalCommand;
    if (!pending || commandBridge.lastHandledId === pending.id) {
      return;
    }

    commandBridge.busy = true;

    try {
      setError(null);

      if (pending.type === "playPause") {
        await handlePrimaryAction();
      } else if (pending.type === "next") {
        await skipBy(1);
      } else if (pending.type === "previous") {
        await skipBy(-1);
      } else if (pending.type === "openSource" && pending.source) {
        await loadSource(pending.source);
      }

      commandBridge.lastHandledId = pending.id;
      clearPendingExternalCommand(pending.id);
    } catch (commandError) {
      setError(
        commandError instanceof Error ? commandError.message : String(commandError),
      );
      commandBridge.lastHandledId = pending.id;
      clearPendingExternalCommand(pending.id);
    } finally {
      commandBridge.busy = false;
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
      player.setQueue(initialTracks, persistedState.currentTrackId ?? null);
    }

    if (initialInputError) {
      setError(initialInputError);
    }

    void loadSource(initialSource);
    void processPendingCommand();

    return () => {
      player.bind({});
    };
  }, []);

  useEffect(() => {
    if (!setIntervalApi) {
      return;
    }

    const timer = setIntervalApi(() => {
      void processPendingCommand();
    }, 1200) as unknown as number;

    return () => {
      if (clearIntervalApi) {
        clearIntervalApi(timer);
      }
    };
  }, [activeSource.input, tracks.length, currentTrack?.id, loading, playLoading]);

  const playbackSnapshot = useMemo(
    () =>
      buildPlaybackSnapshot({
        source: activeSource,
        sourceTitle,
        ownerName,
        cover: sourceCover,
        queue: tracks,
        currentIndex,
        currentTrack,
        playbackState,
        playbackDetail,
      }),
    [
      activeSource.input,
      sourceTitle,
      ownerName,
      sourceCover,
      tracks,
      currentIndex,
      currentTrack?.id,
      playbackState,
      playbackDetail,
    ],
  );

  useEffect(() => {
    persistPlayerState({
      sourceDescriptor: activeSource,
      sourceTitle,
      queue: tracks,
      currentTrackId: currentTrack?.id,
      playbackSnapshot,
    });
    reloadExternalSurfaces();
  }, [
    activeSource.input,
    sourceTitle,
    ownerName,
    sourceCover,
    tracks,
    currentTrack?.id,
    currentIndex,
    playbackState,
    playbackDetail,
  ]);

  useEffect(() => {
    if (!liveActivity) {
      return;
    }

    const nextState = toLiveActivityState(playbackSnapshot);
    const nextKey = JSON.stringify(nextState ?? null);
    if (nextKey === liveActivityBridge.lastKey) {
      return;
    }

    liveActivityBridge.lastKey = nextKey;

    if (!nextState) {
      if (liveActivityBridge.started) {
        void liveActivity.end(
          {
            title: "",
            artist: "",
            sourceTitle: "",
            playbackState: "idle",
            queueLength: 0,
            currentIndex: -1,
          },
          { dismissTimeInterval: 0 },
        );
        liveActivityBridge.started = false;
      }
      return;
    }

    if (!liveActivityBridge.started) {
      void liveActivity
        .start(nextState, {
          staleDate: Date.now() + 1000 * 60 * 30,
          relevanceScore: 100,
        })
        .then((started: boolean) => {
          liveActivityBridge.started = Boolean(started);
          if (!started) {
            void liveActivity.update(nextState, {
              staleDate: Date.now() + 1000 * 60 * 30,
            });
          }
        });
      return;
    }

    void liveActivity.update(nextState, {
      staleDate: Date.now() + 1000 * 60 * 30,
    });
  }, [
    playbackSnapshot.updatedAt,
    playbackSnapshot.currentTrack?.id,
    playbackSnapshot.playbackState,
    playbackSnapshot.currentIndex,
    playbackSnapshot.queueLength,
  ]);

  const playbackLabel = describeState(playbackState, playbackDetail);
  const queueSummary = loading ? "正在同步歌单..." : `共 ${tracks.length} 首`;
  const primaryButtonTitle = currentTrack
    ? playbackState === "playing"
      ? "暂停"
      : "继续播放"
    : "播放第 1 首";
  const currentSourceSummary = sourceSecondaryLabel(activeSource);
  const currentSourceKind = sourceKindLabel(activeSource.kind);
  const visibleRecentSources = recentSources.filter(
    (source) => source.input !== activeSource.input,
  );
  const pendingCommand = loadState().pendingExternalCommand;

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
                {currentTrack?.artist || ownerName || "Bilibili 导入播放器"}
              </Text>
              <Text font={"caption"} foregroundColor={"secondary"}>
                {playbackLabel}
              </Text>
            </VStack>
          </HStack>

          <VStack alignment={"leading"} spacing={6}>
            <Text font={"headline"}>{sourceTitle}</Text>
            <Text font={"subheadline"} foregroundColor={"secondary"}>
              {currentSourceKind} · {currentSourceSummary}
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
          {pendingCommand ? (
            <Text font={"caption"} foregroundColor={"systemBlue"}>
              外部命令待处理: {commandLabel(pendingCommand.type)}
            </Text>
          ) : null}
          {error ? (
            <Text font={"caption"} foregroundColor={"systemRed"}>
              {error}
            </Text>
          ) : null}
        </Section>

        <Section header={<Text font={"caption"}>来源</Text>}>
          <VStack alignment={"leading"} spacing={4}>
            <Text font={"headline"}>{sourceShortLabel(activeSource)}</Text>
            <Text font={"subheadline"} foregroundColor={"secondary"}>
              {currentSourceKind} · {currentSourceSummary}
            </Text>
          </VStack>

          <HStack spacing={10}>
            <Button
              title="切换来源"
              buttonStyle="borderedProminent"
              action={() => void openSourceActions()}
            />
            <Button
              title={loading ? "刷新中..." : "重新拉取"}
              buttonStyle="bordered"
              action={() => void loadSource()}
            />
          </HStack>

          {visibleRecentSources.length > 0 ? (
            <VStack alignment={"leading"} spacing={6}>
              <Text font={"caption"} foregroundColor={"secondary"}>
                最近来源
              </Text>
              {visibleRecentSources.slice(0, 5).map((source) => (
                <Button
                  action={() => void loadSource(source)}
                  key={source.input}>
                  <HStack spacing={12}>
                    <VStack alignment={"leading"} spacing={3}>
                      <Text font={"body"}>{sourceShortLabel(source)}</Text>
                      <Text font={"caption"} foregroundColor={"secondary"}>
                        {sourceKindLabel(source.kind)} · {sourceSecondaryLabel(source)}
                      </Text>
                    </VStack>
                    <Spacer />
                    <Text font={"caption"} foregroundColor={"systemBlue"}>
                      打开
                    </Text>
                  </HStack>
                </Button>
              ))}
            </VStack>
          ) : null}
        </Section>

        <Section header={<Text font={"caption"}>播放队列</Text>}>
          {tracks.length === 0 ? (
            <VStack alignment={"leading"} spacing={4}>
              <Text font={"headline"}>还没有歌单</Text>
              <Text font={"subheadline"} foregroundColor={"secondary"}>
                现在支持视频、收藏夹、合集和频道四种来源。
              </Text>
            </VStack>
          ) : (
            tracks.map((track: Track, index: number) => {
              const isActive = currentIndex === index;
              return (
                <Button action={() => void playTrackAt(index)} key={track.id}>
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
                      foregroundColor={isActive ? "systemBlue" : "secondary"}>
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
