import {
  AppEvents,
  BackgroundKeeper,
  Button,
  Dialog,
  HStack,
  List,
  NavigationLink,
  NavigationStack,
  ProgressView,
  Section,
  Script,
  Spacer,
  Text,
  TextField,
  VStack,
  useEffect,
  useMemo,
  useState,
} from "scripting";

import { importFromSource } from "./api";
import { ArtworkView } from "./artworkView";
import {
  buildPlaybackSnapshot,
  reloadExternalSurfaces,
  toLiveActivityState,
} from "./externalBridge";
import { NowPlayingPage } from "./nowPlayingPage";
import {
  PlaybackModeControl,
  TransportControls,
  playbackModeLabel,
} from "./playbackControls";
import {
  getNativePlayerCompatibilityMessage,
  getSharedPlayer,
} from "./player";
import { PlaybackProgressView } from "./playbackProgressView";
import { usePlayerProgress } from "./usePlayerProgress";
import { SourceLibraryPage } from "./sourceLibraryPage";
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
} from "./sources";
import type {
  PendingExternalCommand,
  PlaybackMode,
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
const AppEventsApi = (AppEvents as any) ?? globalRuntime.AppEvents;
const BackgroundKeeperApi =
  (BackgroundKeeper as any) ?? globalRuntime.BackgroundKeeper;
const ScriptApi = (Script as any) ?? globalRuntime.Script;

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

function keepAliveStateLabel(
  scenePhase: string,
  keepAliveState: "idle" | "requested" | "active" | "unsupported",
) {
  if (keepAliveState === "unsupported") {
    return "当前入口不支持后台保活";
  }
  if (scenePhase === "background" && keepAliveState === "requested") {
    return "后台保活请求中";
  }
  if (scenePhase === "background" && keepAliveState === "active") {
    return "后台保活已启用";
  }
  return "前台运行中";
}

const PLAYBACK_MODE_ORDER: PlaybackMode[] = [
  "normal",
  "repeatAll",
  "repeatOne",
  "shuffle",
];

function playbackModeHint(mode: PlaybackMode) {
  switch (mode) {
    case "repeatAll":
      return "播到队尾后从头继续";
    case "repeatOne":
      return "当前歌曲结束后重播";
    case "shuffle":
      return "切歌时随机选下一首";
    case "normal":
    default:
      return "播到队尾后停止";
  }
}

function nextPlaybackMode(mode: PlaybackMode) {
  const currentIndex = PLAYBACK_MODE_ORDER.indexOf(mode);
  return PLAYBACK_MODE_ORDER[
    currentIndex >= 0
      ? (currentIndex + 1) % PLAYBACK_MODE_ORDER.length
      : 0
  ];
}

function formatDuration(seconds?: number) {
  if (!seconds || seconds <= 0) {
    return "";
  }

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function displayTrackTitle(track: Track | null, sourceTitle: string) {
  if (!track) {
    return "还没开始播放";
  }

  return track.title.startsWith(`${sourceTitle} · `)
    ? track.title.slice(sourceTitle.length + 3)
    : track.title;
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
  const backgroundBridge = useMemo(
    () => ({
      scenePhase: "active",
      keepAliveState: "idle" as "idle" | "requested" | "active" | "unsupported",
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
  const [playbackState, setPlaybackState] = useState(
    (initialSnapshot?.playbackState ?? "idle") as PlaybackUiState,
  );
  const [playbackMode, setPlaybackMode] = useState(
    (persistedState.playbackMode ??
      initialSnapshot?.playbackMode ??
      "normal") as PlaybackMode,
  );
  const [playbackDetail, setPlaybackDetail] = useState(
    initialSnapshot?.playbackDetail || "",
  );
  const [currentIndex, setCurrentIndex] = useState(initialCurrentIndex);
  const [currentTrack, setCurrentTrack] = useState(initialCurrentTrack as Track | null);
  const [playerMessage] = useState(getNativePlayerCompatibilityMessage());
  const [scenePhase, setScenePhase] = useState("active");
  const [keepAliveState, setKeepAliveState] = useState(
    ScriptApi?.env === "index" ? "idle" : "unsupported",
  );
  const [queueQuery, setQueueQuery] = useState("");
  const progress = usePlayerProgress(player);

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
      setError(
        `来源导入失败: ${
          fetchError instanceof Error ? fetchError.message : String(fetchError)
        }`,
      );
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

  async function loadSourceFromInput(input: string) {
    const trimmed = input.trim();
    const source = parseSourceInput(trimmed);
    if (!source) {
      setError(
        "来源格式无效: 请输入 BV / 视频链接，或 favorite:mediaId、season:mid:id、series:mid:id、channel:mid 这类来源格式",
      );
      return;
    }

    await loadSource(source);
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
      setError(
        `开始播放失败: ${
          playError instanceof Error ? playError.message : String(playError)
        }`,
      );
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
      setError(
        `切歌失败: ${
          skipError instanceof Error ? skipError.message : String(skipError)
        }`,
      );
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
      setError(null);
      await player.toggle();
    } catch (toggleError) {
      setError(
        `播放控制失败: ${
          toggleError instanceof Error ? toggleError.message : String(toggleError)
        }`,
      );
    }
  }

  function cyclePlaybackMode() {
    setPlaybackMode((current) => nextPlaybackMode(current));
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

  async function syncBackgroundKeepAlive(nextPhase?: string) {
    const phase = nextPhase ?? backgroundBridge.scenePhase;
    const supportsKeepAlive =
      ScriptApi?.env === "index" &&
      typeof BackgroundKeeperApi?.keepAlive === "function" &&
      typeof BackgroundKeeperApi?.stopKeepAlive === "function";

    if (!supportsKeepAlive) {
      backgroundBridge.keepAliveState = "unsupported";
      setKeepAliveState("unsupported");
      return;
    }

    const shouldProtectPlayback =
      Boolean(currentTrack) &&
      (playbackState === "playing" ||
        playbackState === "loading" ||
        playbackState === "paused");

    if (phase === "background" && shouldProtectPlayback) {
      if (
        backgroundBridge.keepAliveState === "requested" ||
        backgroundBridge.keepAliveState === "active"
      ) {
        return;
      }

      backgroundBridge.keepAliveState = "requested";
      setKeepAliveState("requested");
      const started = await BackgroundKeeperApi.keepAlive();
      backgroundBridge.keepAliveState = started ? "active" : "idle";
      setKeepAliveState(started ? "active" : "idle");
      return;
    }

    if (
      backgroundBridge.keepAliveState === "requested" ||
      backgroundBridge.keepAliveState === "active"
    ) {
      await BackgroundKeeperApi.stopKeepAlive();
    }

    backgroundBridge.keepAliveState = "idle";
    setKeepAliveState("idle");
  }

  useEffect(() => {
    player.setPlaybackMode(playbackMode);
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
        if (state === "playing") {
          setError(null);
        }
      },
      onError: (message) => {
        setError(`音频流错误: ${message}`);
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
    if (!AppEventsApi?.scenePhase?.addListener) {
      return;
    }

    const listener = (phase: string) => {
      backgroundBridge.scenePhase = phase;
      setScenePhase(phase);
      void syncBackgroundKeepAlive(phase);
      void processPendingCommand();
    };

    AppEventsApi.scenePhase.addListener(listener);

    return () => {
      AppEventsApi?.scenePhase?.removeListener?.(listener);
    };
  }, [currentTrack?.id, playbackState]);

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

  useEffect(() => {
    void syncBackgroundKeepAlive();
  }, [currentTrack?.id, playbackState]);

  useEffect(() => {
    player.setPlaybackMode(playbackMode);
  }, [playbackMode]);

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
        playbackMode,
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
      playbackMode,
      playbackDetail,
    ],
  );

  useEffect(() => {
    persistPlayerState({
      sourceDescriptor: activeSource,
      sourceTitle,
      playbackMode,
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
    playbackMode,
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
  const currentSourceSummary = sourceSecondaryLabel(activeSource);
  const currentSourceKind = sourceKindLabel(activeSource.kind);
  const visibleRecentSources = recentSources.filter(
    (source) => source.input !== activeSource.input,
  );
  const pendingCommand = loadState().pendingExternalCommand;
  const keepAliveLabel = keepAliveStateLabel(scenePhase, keepAliveState as any);
  const modeLabel = playbackModeLabel(playbackMode);
  const modeHint = playbackModeHint(playbackMode);
  const cachedTrackCount = tracks.filter((track) => Boolean(track.localFilePath)).length;
  const currentTrackDuration = formatDuration(
    progress.duration || currentTrack?.durationSeconds,
  );
  const currentTrackLabel = displayTrackTitle(currentTrack, sourceTitle);
  const currentDurationSeconds =
    progress.duration || currentTrack?.durationSeconds || 0;
  const currentProgressValue =
    currentDurationSeconds > 0
      ? Math.max(0, Math.min(progress.currentTime, currentDurationSeconds))
      : undefined;
  const normalizedQueueQuery = queueQuery.trim().toLowerCase();
  const filteredTracks = tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => {
      if (!normalizedQueueQuery) {
        return true;
      }

      return [
        track.title,
        track.artist,
        track.sourceTitle,
        track.cid,
      ].some((value) => value.toLowerCase().includes(normalizedQueueQuery));
    });

  return (
    <NavigationStack>
      <List
        navigationTitle={"Azusa"}
        navigationBarTitleDisplayMode={"large"}
        listStyle={"plain"}
      >
        <Section header={<Text font={"caption"}>当前歌单</Text>}>
          <VStack
            alignment={"leading"}
            spacing={14}
            padding={{ horizontal: 16, vertical: 18 }}
            background={{
              style: {
                light: "rgba(248, 250, 252, 0.9)",
                dark: "rgba(255, 255, 255, 0.045)",
              },
              shape: {
                type: "rect",
                cornerRadius: 26,
                style: "continuous",
              },
            }}
            listRowSeparator="hidden">
            <HStack spacing={14}>
              <ArtworkView
                cover={sourceCover || currentTrack?.cover}
                width={118}
                height={78}
                contentMode="fill"
                backgroundStyle="none"
                cornerRadius={18}
                fallbackColor={playbackState === "playing" ? "systemBlue" : "systemGray3"}
              />
              <VStack alignment={"leading"} spacing={4}>
                <Text font={"title3"}>{sourceTitle}</Text>
                <Text font={"subheadline"} foregroundColor={"secondary"}>
                  {currentSourceKind} · {currentSourceSummary}
                </Text>
                <Text font={"caption"} foregroundColor={"secondary"}>
                  {queueSummary} · 已缓存 {cachedTrackCount} / {tracks.length} 首
                </Text>
              </VStack>
            </HStack>
            <VStack alignment={"leading"} spacing={2}>
              <Text font={"caption"} foregroundColor={"secondary"}>
                当前曲目
              </Text>
              <Text font={"headline"}>{currentTrackLabel}</Text>
              <Text font={"caption"} foregroundColor={"secondary"}>
                {modeLabel} · {modeHint}
                {currentTrackDuration ? ` · ${currentTrackDuration}` : ""}
              </Text>
            </VStack>

            <HStack spacing={12}>
              <NavigationLink
                destination={
                  <SourceLibraryPage
                    activeSource={activeSource}
                    recentSources={visibleRecentSources.slice(0, 8)}
                    loading={loading}
                    errorMessage={error}
                    onSearchInput={loadSourceFromInput}
                    onPromptSource={promptForSource}
                    onLoadSource={loadSource}
                    onLoadDefault={() => loadSource(DEFAULT_SOURCE)}
                    onReload={() => loadSource()}
                  />
              }>
                <Text font={"body"} foregroundColor={"systemBlue"}>
                  打开歌单库
                </Text>
              </NavigationLink>
              <Button
                title={loading ? "同步中..." : "重新拉取"}
                buttonStyle="bordered"
                action={() => void loadSource()}
              />
            </HStack>

            {playerMessage || pendingCommand || error || scenePhase !== "active" ? (
              <VStack alignment={"leading"} spacing={3}>
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
                {scenePhase !== "active" ? (
                  <Text font={"caption"} foregroundColor={"secondary"}>
                    {scenePhase} · {keepAliveLabel}
                  </Text>
                ) : null}
                {error ? (
                  <Text font={"caption"} foregroundColor={"systemRed"}>
                    {error}
                  </Text>
                ) : null}
              </VStack>
            ) : null}
          </VStack>
        </Section>

        <Section header={<Text font={"caption"}>迷你播放器</Text>}>
          <VStack
            alignment={"leading"}
            spacing={12}
            padding={{ horizontal: 16, vertical: 16 }}
            background={{
              style: {
                light: "rgba(239, 246, 255, 0.94)",
                dark: "rgba(37, 99, 235, 0.13)",
              },
              shape: {
                type: "rect",
                cornerRadius: 24,
                style: "continuous",
              },
            }}
            listRowSeparator="hidden">
            <NavigationLink
              destination={
                <NowPlayingPage
                  currentTrack={currentTrack}
                  artworkUrl={currentTrack?.cover || sourceCover}
                  sourceTitle={sourceTitle}
                  playbackState={playbackState}
                  playbackMode={playbackMode}
                  playbackDetail={playbackDetail}
                  currentIndex={currentIndex}
                  queueLength={tracks.length}
                  onPrimaryAction={handlePrimaryAction}
                  onPrevious={() => skipBy(-1)}
                  onNext={() => skipBy(1)}
                  onCyclePlaybackMode={cyclePlaybackMode}
                />
            }>
              <HStack spacing={14}>
                <ArtworkView
                  cover={currentTrack?.cover || sourceCover}
                  width={66}
                  height={66}
                  contentMode="fill"
                  backgroundStyle="none"
                  cornerRadius={16}
                  fallbackColor={playbackState === "playing" ? "systemBlue" : "systemGray3"}
                />
                <VStack alignment={"leading"} spacing={3}>
                  <Text font={"headline"}>
                    {currentTrackLabel}
                  </Text>
                  <Text font={"caption"} foregroundColor={"secondary"}>
                    {currentTrack?.artist || ownerName || "Azusa"} · {playbackLabel}
                  </Text>
                  <Text font={"caption2"} foregroundColor={"secondary"}>
                    {modeLabel}
                  </Text>
                </VStack>
                <Spacer />
                <Text font={"caption"} foregroundColor={"systemBlue"}>
                  打开
                </Text>
              </HStack>
            </NavigationLink>

            <PlaybackProgressView progress={progress} />
            {currentDurationSeconds > 0 ? (
              <Text font={"caption2"} foregroundColor={"secondary"}>
                {formatDuration(progress.currentTime)} / {formatDuration(currentDurationSeconds)}
              </Text>
            ) : null}

            <HStack spacing={12}>
              <TransportControls
                compact
                playbackState={playbackState}
                onPrevious={() => void skipBy(-1)}
                onPrimaryAction={() => void handlePrimaryAction()}
                onNext={() => void skipBy(1)}
              />
              <PlaybackModeControl
                playbackMode={playbackMode}
                onCyclePlaybackMode={cyclePlaybackMode}
              />
              <Spacer />
            </HStack>
          </VStack>
        </Section>

        <Section header={<Text font={"caption"}>播放队列</Text>}>
          {tracks.length > 8 ? (
            <VStack alignment={"leading"} spacing={8}>
              <TextField
                title="搜索队列"
                placeholder="按歌曲名 / 歌手 / CID 过滤"
                value={queueQuery}
                onChanged={setQueueQuery}
              />
              {normalizedQueueQuery ? (
                <Text font={"caption"} foregroundColor={"secondary"}>
                  当前结果 {filteredTracks.length} / {tracks.length}
                </Text>
              ) : null}
            </VStack>
          ) : null}

          {tracks.length === 0 ? (
            <VStack alignment={"leading"} spacing={4}>
              <Text font={"headline"}>还没有歌单</Text>
              <Text font={"subheadline"} foregroundColor={"secondary"}>
                现在支持视频、收藏夹、合集和频道四种来源。
              </Text>
            </VStack>
          ) : filteredTracks.length === 0 ? (
            <VStack alignment={"leading"} spacing={4}>
              <Text font={"headline"}>没有匹配结果</Text>
              <Text font={"subheadline"} foregroundColor={"secondary"}>
                试试换个关键词，或者清空搜索条件。
              </Text>
            </VStack>
          ) : (
            filteredTracks.map(({ track, index }) => {
              const isActive = currentIndex === index;
              const duration = formatDuration(track.durationSeconds);
              const isCached = Boolean(track.localFilePath);
              const displayTitle = displayTrackTitle(track, sourceTitle);
              return (
                <Button action={() => void playTrackAt(index)} key={track.id}>
                  <HStack spacing={12}>
                    <VStack alignment={"leading"} spacing={4}>
                      <Text font={isActive ? "headline" : "body"}>
                        {index + 1}. {displayTitle}
                      </Text>
                      <Text font={"caption"} foregroundColor={"secondary"}>
                        {track.artist}
                        {duration ? ` · ${duration}` : ""}
                        {isCached ? " · 已缓存" : ""}
                        {" · "}
                        CID {track.cid}
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
