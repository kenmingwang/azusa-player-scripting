import {
  AppEvents,
  BackgroundKeeper,
  Button,
  Dialog,
  HStack,
  LazyVStack,
  NavigationLink,
  NavigationStack,
  ScrollView,
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
import { PaginatedTrackList } from "./paginatedTrackList";
import {
  buildPaginatedTrackState,
  clampPage,
  pageForTrackIndex,
} from "./paginatedTracks";
import { usePlaybackClock, usePlayerProgress } from "./usePlayerProgress";
import { SourceLibraryPage } from "./sourceLibraryPage";
import {
  addTracksToPlaylist,
  clearPendingExternalCommand,
  createPlaylist,
  deletePlaylist,
  deleteTracksFromPlaylist,
  getActivePlaylist,
  getPlaylistById,
  loadState,
  persistPlayerState,
  rememberRecentSource,
  renamePlaylist,
  renameTrackInPlaylist,
  replacePlaylistTracks,
  saveSearchPlaylist,
  saveSourcePlaylist,
  setActivePlaylist,
} from "./storage";
import {
  createVideoSource,
  parseSourceInput,
  sourceKindLabel,
  sourceSecondaryLabel,
} from "./sources";
import type {
  PendingExternalCommand,
  PlaybackMode,
  PlaylistRecord,
  PlaybackUiState,
  SourceDescriptor,
  Track,
} from "./types";
import { AzusaNowPlayingLiveActivity } from "../live_activity";

const DEFAULT_SOURCE = createVideoSource("BV1wr4y1v7TA", "默认歌单");
const BUILD_VERSION = "0.1.7";

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

type MiniPlayerSectionProps = {
  player: ReturnType<typeof getSharedPlayer>;
  currentTrack: Track | null;
  sourceCover?: string;
  sourceTitle: string;
  ownerName: string;
  playbackState: PlaybackUiState;
  playbackLabel: string;
  playbackMode: PlaybackMode;
  modeLabel: string;
  playbackDetail?: string;
  onPrimaryAction: () => void | Promise<void>;
  onPrevious: () => void | Promise<void>;
  onNext: () => void | Promise<void>;
  onCyclePlaybackMode: () => void;
};

function MiniPlayerSection(props: MiniPlayerSectionProps) {
  const progress = usePlayerProgress(props.player);
  const liveTime = usePlaybackClock(progress, 500);
  const currentDurationSeconds =
    progress.duration || props.currentTrack?.durationSeconds || 0;

  return (
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
      }}>
      <NavigationLink
        destination={
          <NowPlayingPage
            currentTrack={props.currentTrack}
            artworkUrl={props.currentTrack?.cover || props.sourceCover}
            sourceTitle={props.sourceTitle}
            playbackState={props.playbackState}
            playbackMode={props.playbackMode}
            playbackDetail={props.playbackDetail}
            currentIndex={props.player.getCurrentIndex()}
            queueLength={props.player.getQueue().length}
            onPrimaryAction={props.onPrimaryAction}
            onPrevious={props.onPrevious}
            onNext={props.onNext}
            onCyclePlaybackMode={props.onCyclePlaybackMode}
          />
      }>
        <HStack spacing={14}>
          <ArtworkView
            cover={props.currentTrack?.cover || props.sourceCover}
            width={84}
            height={54}
            contentMode="fill"
            backgroundStyle="none"
            cornerRadius={16}
            fallbackColor={props.playbackState === "playing" ? "systemBlue" : "systemGray3"}
          />
          <VStack alignment={"leading"} spacing={3}>
            <Text font={"headline"}>
              {displayTrackTitle(props.currentTrack, props.sourceTitle)}
            </Text>
            <Text font={"caption"} foregroundColor={"secondary"}>
              {props.currentTrack?.artist || props.ownerName || "Azusa"} · {props.playbackLabel}
            </Text>
            <Text font={"caption2"} foregroundColor={"secondary"}>
              {props.modeLabel}
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
          {formatDuration(liveTime)} / {formatDuration(currentDurationSeconds)}
        </Text>
      ) : null}

      <HStack spacing={12}>
        <TransportControls
          compact
          playbackState={props.playbackState}
          onPrevious={props.onPrevious}
          onPrimaryAction={props.onPrimaryAction}
          onNext={props.onNext}
        />
        <PlaybackModeControl
          playbackMode={props.playbackMode}
          onCyclePlaybackMode={props.onCyclePlaybackMode}
        />
        <Spacer />
      </HStack>
    </VStack>
  );
}

type QueueManagementPageProps = {
  playlist: PlaylistRecord | null;
  tracks: Track[];
  sourceTitle: string;
  currentIndex: number;
  playbackState: PlaybackUiState;
  playLoading: boolean;
  onPlayTrackAt: (index: number) => void | Promise<void>;
  onHandleDuplicatePlaylistToNew: (playlistId: string, title: string) => Promise<void>;
  onHandleAddPlaylistToTitle: (playlistId: string, title: string) => Promise<void>;
  onAddTracksByTitle: (title: string, tracks: Track[]) => Promise<void>;
  onHandleDeleteTracks: (trackIds: string[]) => Promise<void>;
  onHandleRenameTrack: (track: Track) => Promise<void>;
  onHandleAddTrack: (track: Track) => Promise<void>;
};

type QueueToolsPageProps = QueueManagementPageProps;

function QueueSearchPage(props: QueueToolsPageProps) {
  const [queueQuery, setQueueQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const tracks = props.tracks;
  const pageState = useMemo(
    () =>
      buildPaginatedTrackState({
        tracks,
        query: queueQuery,
        page,
        currentIndex: props.currentIndex,
      }),
    [tracks, queueQuery, page, props.currentIndex],
  );
  const filteredTracks = useMemo(
    () =>
      pageState.rows.map((row) => ({
        track: row.track,
        index: row.index,
        displayIndex: row.displayIndex,
        isActive: row.isActive,
        rowId: row.id,
      })),
    [pageState.rows],
  );

  useEffect(() => {
    setPage(1);
  }, [queueQuery, tracks]);

  useEffect(() => {
    setPageInput(String(pageState.page));
  }, [pageState.page]);

  function jumpToPage(nextPage: number) {
    setPage(clampPage(nextPage, pageState.totalPages));
  }

  return (
    <ScrollView
      navigationTitle={"搜索队列"}
      navigationBarTitleDisplayMode={"inline"}>
      <LazyVStack
        alignment={"leading"}
        spacing={24}
        padding={{ horizontal: 16, vertical: 16 }}>
        <VStack alignment={"leading"} spacing={12}>
          <TextField
            title="搜索队列"
            placeholder="按歌曲名 / 歌手 / CID 过滤"
            value={queueQuery}
            onChanged={setQueueQuery}
          />
          <Text font={"caption"} foregroundColor={"secondary"}>
            当前结果 {filteredTracks.length} / {tracks.length}
          </Text>
        </VStack>

        <HStack spacing={8}>
          <Button
            title="Prev"
            buttonStyle="bordered"
            action={() => jumpToPage(pageState.page - 1)}
          />
          <Button
            title="Next"
            buttonStyle="bordered"
            action={() => jumpToPage(pageState.page + 1)}
          />
          <TextField
            title="Page"
            placeholder="Page"
            value={pageInput}
            onChanged={setPageInput}
          />
          <Button
            title="Go"
            buttonStyle="bordered"
            action={() => jumpToPage(Number.parseInt(pageInput, 10))}
          />
        </HStack>

        <Text font={"caption"} foregroundColor={"secondary"}>
          Page {pageState.page}/{pageState.totalPages} · showing{" "}
          {pageState.startResult}-{pageState.endResult} / {pageState.resultCount}
        </Text>

        <VStack alignment={"leading"} spacing={12}>
          <Text font={"caption"} foregroundColor={"secondary"}>
            歌曲列表
          </Text>
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
          <LazyVStack alignment={"leading"} spacing={12}>
          {filteredTracks.map(({ track, index, displayIndex, isActive, rowId }) => {
            const displayTitle = displayTrackTitle(track, props.sourceTitle);

            return (
              <Button
                action={() => void props.onPlayTrackAt(index)}
                key={rowId}>
                  <HStack spacing={12}>
                    <VStack alignment={"leading"} spacing={4}>
                      <Text font={isActive ? "headline" : "body"}>
                        {displayIndex}. {displayTitle}
                      </Text>
                      <Text font={"caption"} foregroundColor={"secondary"}>
                        {track.artist}
                        {" · "}
                        CID {track.cid}
                      </Text>
                    </VStack>
                    <Spacer />
                    <Text
                      font={"caption"}
                      foregroundColor={isActive ? "systemBlue" : "secondary"}>
                      {trackStatusLabel(props.playbackState, isActive, props.playLoading)}
                    </Text>
                  </HStack>
                </Button>
            );
          })}
          </LazyVStack>
        )}
        </VStack>

        <VStack spacing={1} />
      </LazyVStack>
    </ScrollView>
  );
}

function QueueBatchEditPage(props: QueueToolsPageProps) {
  const [selectedTrackIds, setSelectedTrackIds] = useState([] as string[]);
  const selectedTrackIdSet = useMemo(
    () => new Set(selectedTrackIds),
    [selectedTrackIds],
  );
  const hasSelectedTracks = selectedTrackIds.length > 0;
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const pageState = useMemo(
    () =>
      buildPaginatedTrackState({
        tracks: props.tracks,
        page,
        currentIndex: props.currentIndex,
      }),
    [props.tracks, page, props.currentIndex],
  );
  const visibleTracks = useMemo(
    () =>
      pageState.rows.map((row) => ({
        track: row.track,
        index: row.index,
        displayIndex: row.displayIndex,
        isActive: row.isActive,
        rowId: row.id,
      })),
    [pageState.rows],
  );

  useEffect(() => {
    setSelectedTrackIds([]);
    setPage(1);
  }, [props.playlist?.id]);

  useEffect(() => {
    setPageInput(String(pageState.page));
  }, [pageState.page]);

  function jumpToPage(nextPage: number) {
    setPage(clampPage(nextPage, pageState.totalPages));
  }

  return (
    <ScrollView
      navigationTitle={"批量操作"}
      navigationBarTitleDisplayMode={"inline"}>
      <LazyVStack
        alignment={"leading"}
        spacing={24}
        padding={{ horizontal: 16, vertical: 16 }}>
        <VStack alignment={"leading"} spacing={10}>
          <Text font={"title3"}>
            {props.playlist?.title || props.sourceTitle}
          </Text>
          <Text font={"caption"} foregroundColor={"secondary"}>
            已选 {selectedTrackIds.length} / {props.tracks.length} 首
          </Text>
        </VStack>

        <HStack spacing={10}>
          <Button
            title="加入歌单"
            buttonStyle="bordered"
            action={async () => {
              const title = await Dialog.prompt({
                title: "加入歌单",
                message: "输入目标歌单名。若不存在，会新建一个自定义歌单。",
                placeholder: "目标歌单名",
                confirmLabel: "加入",
                cancelLabel: "取消",
                selectAll: true,
              });
              if (title == null) {
                return;
              }
              const selectedTracks = props.tracks.filter((track) =>
                selectedTrackIdSet.has(track.id),
              );
              await props.onAddTracksByTitle(title, selectedTracks);
            }}
          />
          <Button
            title={hasSelectedTracks ? `删除已选 ${selectedTrackIds.length}` : "删除已选"}
            buttonStyle="bordered"
            action={() => void props.onHandleDeleteTracks(selectedTrackIds)}
          />
        </HStack>

        <HStack spacing={8}>
          <Button
            title="Prev"
            buttonStyle="bordered"
            action={() => jumpToPage(pageState.page - 1)}
          />
          <Button
            title="Next"
            buttonStyle="bordered"
            action={() => jumpToPage(pageState.page + 1)}
          />
          <TextField
            title="Page"
            placeholder="Page"
            value={pageInput}
            onChanged={setPageInput}
          />
          <Button
            title="Go"
            buttonStyle="bordered"
            action={() => jumpToPage(Number.parseInt(pageInput, 10))}
          />
        </HStack>

        <Text font={"caption"} foregroundColor={"secondary"}>
          Page {pageState.page}/{pageState.totalPages} · showing{" "}
          {pageState.startResult}-{pageState.endResult} / {pageState.resultCount}
        </Text>

        <LazyVStack alignment={"leading"} spacing={12}>
          {visibleTracks.map(({ track, index, displayIndex, isActive, rowId }) => {
            const isSelected = selectedTrackIdSet.has(track.id);
            const displayTitle = displayTrackTitle(track, props.sourceTitle);

            return (
              <Button
                key={rowId}
                action={() =>
                  setSelectedTrackIds((current) =>
                    current.includes(track.id)
                      ? current.filter((item) => item !== track.id)
                      : [...current, track.id],
                  )
                }>
                <HStack spacing={12}>
                  <VStack alignment={"leading"} spacing={4}>
                    <Text font={isActive ? "headline" : "body"}>
                      {displayIndex}. {displayTitle}
                    </Text>
                    <Text font={"caption"} foregroundColor={"secondary"}>
                      {track.artist} · CID {track.cid}
                    </Text>
                  </VStack>
                  <Spacer />
                  <Text
                    font={"caption"}
                    foregroundColor={isSelected ? "systemBlue" : "secondary"}>
                    {isSelected ? "已选" : "选择"}
                  </Text>
                </HStack>
              </Button>
            );
          })}
        </LazyVStack>

        <VStack spacing={1} />
      </LazyVStack>
    </ScrollView>
  );
}

function QueueToolsPage(props: QueueToolsPageProps) {
  const canManageTracks = props.playlist?.kind !== "source";

  return (
    <ScrollView
      navigationTitle={"队列工具"}
      navigationBarTitleDisplayMode={"inline"}>
      <LazyVStack
        alignment={"leading"}
        spacing={24}
        padding={{ horizontal: 16, vertical: 16 }}>
        <VStack alignment={"leading"} spacing={10}>
          <Text font={"title3"}>
            {props.playlist?.title || props.sourceTitle}
          </Text>
          <Text font={"caption"} foregroundColor={"secondary"}>
            共 {props.tracks.length} 首
          </Text>
        </VStack>

        {props.playlist?.kind === "search" && props.tracks.length > 0 ? (
          <VStack alignment={"leading"} spacing={10}>
            <Text font={"caption"} foregroundColor={"secondary"}>
              歌单操作
            </Text>
            <HStack spacing={10}>
              <Button
                title="另存为歌单"
                buttonStyle="bordered"
                action={() =>
                  void props.onHandleDuplicatePlaylistToNew(
                    props.playlist.id,
                    `${props.playlist.title} 收藏`,
                  )
                }
              />
              <Button
                title="整单加入歌单"
                buttonStyle="bordered"
                action={() =>
                  void props.onHandleAddPlaylistToTitle(
                    props.playlist.id,
                    props.playlist.title,
                  )
                }
              />
            </HStack>
          </VStack>
        ) : null}

        <VStack alignment={"leading"} spacing={12}>
          <Text font={"caption"} foregroundColor={"secondary"}>
            工具入口
          </Text>
          <NavigationLink
            destination={
              <QueueSearchPage
                playlist={props.playlist}
                tracks={props.tracks}
                sourceTitle={props.sourceTitle}
                currentIndex={props.currentIndex}
                playbackState={props.playbackState}
                playLoading={props.playLoading}
                onPlayTrackAt={props.onPlayTrackAt}
                onHandleDuplicatePlaylistToNew={props.onHandleDuplicatePlaylistToNew}
                onHandleAddPlaylistToTitle={props.onHandleAddPlaylistToTitle}
                onAddTracksByTitle={props.onAddTracksByTitle}
                onHandleDeleteTracks={props.onHandleDeleteTracks}
                onHandleRenameTrack={props.onHandleRenameTrack}
                onHandleAddTrack={props.onHandleAddTrack}
              />
            }>
            <HStack spacing={12}>
              <VStack alignment={"leading"} spacing={4}>
                <Text font={"body"}>搜索队列</Text>
                <Text font={"caption"} foregroundColor={"secondary"}>
                  按歌曲名、歌手或 CID 快速过滤
                </Text>
              </VStack>
              <Spacer />
              <Text font={"caption"} foregroundColor={"systemBlue"}>
                打开
              </Text>
            </HStack>
          </NavigationLink>

          {canManageTracks ? (
            <NavigationLink
              destination={
                <QueueBatchEditPage
                  playlist={props.playlist}
                  tracks={props.tracks}
                  sourceTitle={props.sourceTitle}
                  currentIndex={props.currentIndex}
                  playbackState={props.playbackState}
                  playLoading={props.playLoading}
                  onPlayTrackAt={props.onPlayTrackAt}
                  onHandleDuplicatePlaylistToNew={props.onHandleDuplicatePlaylistToNew}
                  onHandleAddPlaylistToTitle={props.onHandleAddPlaylistToTitle}
                  onAddTracksByTitle={props.onAddTracksByTitle}
                  onHandleDeleteTracks={props.onHandleDeleteTracks}
                  onHandleRenameTrack={props.onHandleRenameTrack}
                  onHandleAddTrack={props.onHandleAddTrack}
                />
              }>
              <HStack spacing={12}>
                <VStack alignment={"leading"} spacing={4}>
                  <Text font={"body"}>批量操作</Text>
                  <Text font={"caption"} foregroundColor={"secondary"}>
                    选择多首歌后统一加入歌单或删除
                  </Text>
                </VStack>
                <Spacer />
                <Text font={"caption"} foregroundColor={"systemBlue"}>
                  打开
                </Text>
              </HStack>
            </NavigationLink>
          ) : null}
        </VStack>

        <VStack spacing={1} />
      </LazyVStack>
    </ScrollView>
  );
}

function QueueManagementPage(props: QueueManagementPageProps) {
  const tracks = props.tracks;
  const [page, setPage] = useState(pageForTrackIndex(props.currentIndex));
  const [pageInput, setPageInput] = useState(String(page));
  const pageState = useMemo(
    () =>
      buildPaginatedTrackState({
        tracks,
        page,
        currentIndex: props.currentIndex,
      }),
    [tracks, page, props.currentIndex],
  );
  const visibleTracks = useMemo(
    () =>
      pageState.rows.map((row) => ({
        track: row.track,
        index: row.index,
        displayIndex: row.displayIndex,
        isActive: row.isActive,
        rowId: row.id,
      })),
    [pageState.rows],
  );

  useEffect(() => {
    if (props.currentIndex >= 0) {
      setPage(pageForTrackIndex(props.currentIndex));
    }
  }, [props.currentIndex]);

  useEffect(() => {
    setPageInput(String(pageState.page));
  }, [pageState.page]);

  function jumpToPage(nextPage: number) {
    setPage(clampPage(nextPage, pageState.totalPages));
  }

  return (
    <ScrollView
      navigationTitle={"播放队列"}
      navigationBarTitleDisplayMode={"inline"}>
      <LazyVStack
        alignment={"leading"}
        spacing={24}
        padding={{ horizontal: 16, vertical: 16 }}>
        <VStack alignment={"leading"} spacing={10}>
          <HStack spacing={12}>
            <VStack alignment={"leading"} spacing={4}>
              <Text font={"title3"}>
                {props.playlist?.title || props.sourceTitle}
              </Text>
              <Text font={"caption"} foregroundColor={"secondary"}>
                共 {tracks.length} 首
                {props.currentIndex >= 0
                  ? ` · 当前 ${props.currentIndex + 1}/${tracks.length}`
                  : ""}
              </Text>
            </VStack>
            <Spacer />
            <NavigationLink
              destination={
                <QueueToolsPage
                  playlist={props.playlist}
                  tracks={props.tracks}
                  sourceTitle={props.sourceTitle}
                  currentIndex={props.currentIndex}
                  playbackState={props.playbackState}
                  playLoading={props.playLoading}
                  onPlayTrackAt={props.onPlayTrackAt}
                  onHandleDuplicatePlaylistToNew={props.onHandleDuplicatePlaylistToNew}
                  onHandleAddPlaylistToTitle={props.onHandleAddPlaylistToTitle}
                  onAddTracksByTitle={props.onAddTracksByTitle}
                  onHandleDeleteTracks={props.onHandleDeleteTracks}
                  onHandleRenameTrack={props.onHandleRenameTrack}
                  onHandleAddTrack={props.onHandleAddTrack}
                />
              }>
              <Text font={"body"} foregroundColor={"systemBlue"}>
                打开工具
              </Text>
            </NavigationLink>
          </HStack>
        </VStack>

        <HStack spacing={8}>
          <Button
            title="Prev"
            buttonStyle="bordered"
            action={() => jumpToPage(pageState.page - 1)}
          />
          <Button
            title="Next"
            buttonStyle="bordered"
            action={() => jumpToPage(pageState.page + 1)}
          />
          <TextField
            title="Page"
            placeholder="Page"
            value={pageInput}
            onChanged={setPageInput}
          />
          <Button
            title="Go"
            buttonStyle="bordered"
            action={() => jumpToPage(Number.parseInt(pageInput, 10))}
          />
        </HStack>

        <Text font={"caption"} foregroundColor={"secondary"}>
          Page {pageState.page}/{pageState.totalPages} · showing{" "}
          {pageState.startResult}-{pageState.endResult} / {pageState.resultCount}
        </Text>

        <VStack alignment={"leading"} spacing={12}>
          <Text font={"caption"} foregroundColor={"secondary"}>
            歌曲列表
          </Text>
          {tracks.length === 0 ? (
            <VStack alignment={"leading"} spacing={4}>
              <Text font={"headline"}>还没有歌单</Text>
              <Text font={"subheadline"} foregroundColor={"secondary"}>
                现在支持视频、收藏夹、合集和频道四种来源。
              </Text>
            </VStack>
          ) : (
            <LazyVStack alignment={"leading"} spacing={12}>
              {visibleTracks.map(({ track, index, displayIndex, isActive, rowId }) => {
                const displayTitle = displayTrackTitle(track, props.sourceTitle);

                return (
                  <Button key={rowId} action={() => void props.onPlayTrackAt(index)}>
                    <HStack spacing={12}>
                      <VStack alignment={"leading"} spacing={4}>
                        <Text font={isActive ? "headline" : "body"}>
                          {displayIndex}. {displayTitle}
                        </Text>
                        <Text font={"caption"} foregroundColor={"secondary"}>
                          {track.artist} · CID {track.cid}
                        </Text>
                      </VStack>
                      <Spacer />
                      <Text
                        font={"caption"}
                        foregroundColor={isActive ? "systemBlue" : "secondary"}>
                        {trackStatusLabel(
                          props.playbackState,
                          isActive,
                          props.playLoading,
                        )}
                      </Text>
                    </HStack>
                  </Button>
                );
              })}
            </LazyVStack>
          )}
        </VStack>

        <VStack spacing={1} />
      </LazyVStack>
    </ScrollView>
  );
}

function displayTrackTitle(track: Track | null, sourceTitle: string) {
  if (!track) {
    return "还没开始播放";
  }

  return track.title.startsWith(`${sourceTitle} · `)
    ? track.title.slice(sourceTitle.length + 3)
    : track.title;
}

function playlistKindLabel(playlist: PlaylistRecord | null) {
  if (!playlist) {
    return "歌单";
  }

  switch (playlist.kind) {
    case "search":
      return "搜索歌单";
    case "source":
      return playlist.source ? sourceKindLabel(playlist.source.kind) : "来源歌单";
    case "user":
    default:
      return "自定义歌单";
  }
}

function playlistSummaryLabel(playlist: PlaylistRecord | null) {
  if (!playlist) {
    return "";
  }

  if (playlist.kind === "user") {
    return `共 ${playlist.tracks.length} 首`;
  }

  if (playlist.source) {
    return `${sourceKindLabel(playlist.source.kind)} · ${sourceSecondaryLabel(playlist.source)}`;
  }

  return `共 ${playlist.tracks.length} 首`;
}

export function DefaultPlaylistApp(props: DefaultPlaylistAppProps) {
  const persistedState = useMemo(() => loadState(), []);
  const requestedInput = props.initialInput?.trim() || "";
  const requestedSource = requestedInput ? parseSourceInput(requestedInput) : null;
  const initialPlaylist =
    getActivePlaylist(persistedState) ??
    persistedState.playlistLibrary[0] ??
    null;
  const initialSource =
    requestedSource ||
    initialPlaylist?.source ||
    persistedState.sourceDescriptor ||
    (persistedState.lastInput ? parseSourceInput(persistedState.lastInput) : null) ||
    DEFAULT_SOURCE;
  const initialTracks = initialPlaylist?.tracks ?? persistedState.queue;
  const initialCurrentIndex = persistedState.currentTrackId
    ? initialTracks.findIndex((track) => track.id === persistedState.currentTrackId)
    : -1;
  const initialCurrentTrack =
    initialCurrentIndex >= 0 ? initialTracks[initialCurrentIndex] : null;
  const initialSnapshot = persistedState.playbackSnapshot;
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
  const playlistBridge = useMemo(
    () => ({
      activePlaylistId: persistedState.activePlaylistId ?? initialPlaylist?.id ?? "",
    }),
    [],
  );

  const [playlistLibrary, setPlaylistLibrary] = useState(
    persistedState.playlistLibrary,
  );
  const [activePlaylistId, setActivePlaylistId] = useState(
    persistedState.activePlaylistId ?? initialPlaylist?.id ?? "",
  );
  const [loading, setLoading] = useState(false);
  const [playLoading, setPlayLoading] = useState(false);
  const [error, setError] = useState(null as string | null);
  const [recentSources, setRecentSources] = useState(
    persistedState.recentSources ?? [],
  );
  const [pendingCommand, setPendingCommand] = useState(
    persistedState.pendingExternalCommand ?? null,
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
  const activePlaylist = useMemo(
    () =>
      playlistLibrary.find((playlist) => playlist.id === activePlaylistId) ??
      playlistLibrary[0] ??
      null,
    [playlistLibrary, activePlaylistId],
  );
  const tracks = activePlaylist?.tracks ?? [];
  const sourceTitle =
    activePlaylist?.title || initialSnapshot?.sourceTitle || initialSource.titleHint || "Azusa";
  const ownerName = activePlaylist?.ownerName || initialSnapshot?.ownerName || "";
  const sourceCover = activePlaylist?.cover || initialSnapshot?.cover || "";
  const playbackSource =
    activePlaylist?.source ??
    (currentTrack?.bvid ? createVideoSource(currentTrack.bvid, sourceTitle) : initialSource);

  useEffect(() => {
    playlistBridge.activePlaylistId = activePlaylistId;
  }, [activePlaylistId]);

  function syncFromState(nextState: ReturnType<typeof loadState>) {
    setPlaylistLibrary(nextState.playlistLibrary);
    setActivePlaylistId(nextState.activePlaylistId ?? nextState.playlistLibrary[0]?.id ?? "");
    setRecentSources(nextState.recentSources ?? []);
    setPendingCommand(nextState.pendingExternalCommand ?? null);
  }

  function applyPlaylistToPlayer(
    playlist: PlaylistRecord | null,
    preserveTrackId?: string | null,
  ) {
    const matchedTrackId =
      preserveTrackId &&
      playlist?.tracks.some((track) => track.id === preserveTrackId)
        ? preserveTrackId
        : null;

    if (!matchedTrackId) {
      player.stop();
      setCurrentTrack(null);
      setCurrentIndex(-1);
      setPlaybackState("idle");
      setPlaybackDetail("");
    }

    player.setQueue(playlist?.tracks ?? [], matchedTrackId);

    if (matchedTrackId && playlist) {
      const matchedIndex = playlist.tracks.findIndex(
        (track) => track.id === matchedTrackId,
      );
      setCurrentIndex(matchedIndex);
      setCurrentTrack(matchedIndex >= 0 ? playlist.tracks[matchedIndex] : null);
    }
  }

  async function importSourceToSearch(nextSource?: SourceDescriptor) {
    const source = nextSource || activePlaylist?.source || playbackSource || DEFAULT_SOURCE;

    setLoading(true);
    setError(null);

    try {
      const result = await importFromSource(source);
      saveSearchPlaylist({
        title: result.sourceTitle,
        source: result.source,
        ownerName: result.ownerName,
        cover: result.cover,
        tracks: result.tracks,
        activate: true,
      });
      const nextState = rememberRecentSource(result.source);
      syncFromState(nextState);
      const nextPlaylist = getActivePlaylist(nextState);
      applyPlaylistToPlayer(nextPlaylist, currentTrack?.id);
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

  async function refreshPlaylistSource(playlistId?: string) {
    const state = loadState();
    const playlist = getPlaylistById(playlistId ?? activePlaylistId, state);
    if (!playlist?.source) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await importFromSource(playlist.source);
      if (playlist.kind === "search") {
        saveSearchPlaylist({
          title: result.sourceTitle,
          source: result.source,
          ownerName: result.ownerName,
          cover: result.cover,
          tracks: result.tracks,
          activate: state.activePlaylistId === playlist.id,
        });
      } else {
        saveSourcePlaylist({
          playlistId: playlist.id,
          title: result.sourceTitle,
          source: result.source,
          ownerName: result.ownerName,
          cover: result.cover,
          tracks: result.tracks,
          activate: state.activePlaylistId === playlist.id,
        });
      }
      const nextState = rememberRecentSource(result.source);
      syncFromState(nextState);
      if (state.activePlaylistId === playlist.id) {
        applyPlaylistToPlayer(getActivePlaylist(nextState), currentTrack?.id);
      }
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

  async function loadSourceFromInput(input: string) {
    const trimmed = input.trim();
    const source = parseSourceInput(trimmed);
    if (!source) {
      setError(
        "来源格式无效: 请输入 BV / 视频链接，或 favorite:mediaId、season:mid:id、series:mid:id、channel:mid 这类来源格式",
      );
      return;
    }

    await importSourceToSearch(source);
  }

  async function openPlaylist(playlistId: string) {
    const nextState = setActivePlaylist(playlistId);
    syncFromState(nextState);
    applyPlaylistToPlayer(getActivePlaylist(nextState), currentTrack?.id);
  }

  async function handleCreatePlaylist(title: string) {
    createPlaylist(title, []);
    const nextState = loadState();
    syncFromState(nextState);
    applyPlaylistToPlayer(getActivePlaylist(nextState), null);
  }

  async function handleRenamePlaylist(playlistId: string, title: string) {
    const nextState = renamePlaylist(playlistId, title);
    syncFromState(nextState);
  }

  async function handleDeletePlaylist(playlistId: string) {
    const nextState = deletePlaylist(playlistId);
    syncFromState(nextState);
    applyPlaylistToPlayer(getActivePlaylist(nextState), currentTrack?.id);
  }

  async function handleDuplicatePlaylistToNew(
    playlistId: string,
    title: string,
  ) {
    const playlist = getPlaylistById(playlistId);
    createPlaylist(title, playlist?.tracks ?? []);
    const nextState = loadState();
    syncFromState(nextState);
    applyPlaylistToPlayer(getActivePlaylist(nextState), null);
  }

  async function addTracksByTitle(targetTitle: string, nextTracks: Track[]) {
    const title = targetTitle.trim();
    if (!title) {
      return;
    }

    const beforeState = loadState();
    const target = beforeState.playlistLibrary.find(
      (playlist) => playlist.kind === "user" && playlist.title === title,
    );

    if (target) {
      const nextState = addTracksToPlaylist(target.id, nextTracks);
      syncFromState(nextState);
      return;
    }

    const previousActivePlaylistId = activePlaylistId;
    createPlaylist(title, nextTracks);
    let nextState = loadState();
    if (previousActivePlaylistId) {
      nextState = setActivePlaylist(previousActivePlaylistId);
    }
    syncFromState(nextState);
  }

  async function handleAddPlaylistToTitle(playlistId: string, title: string) {
    const playlist = getPlaylistById(playlistId);
    await addTracksByTitle(title, playlist?.tracks ?? []);
  }

  async function handleRenameTrack(track: Track) {
    if (!activePlaylistId) {
      return;
    }

    const title = await Dialog.prompt({
      title: "重命名歌曲",
      message: "输入新的显示标题。",
      defaultValue: displayTrackTitle(track, sourceTitle),
      placeholder: "歌曲名",
      confirmLabel: "保存",
      cancelLabel: "取消",
      selectAll: true,
    });

    if (title == null) {
      return;
    }

    const nextState = renameTrackInPlaylist(activePlaylistId, track.id, title);
    syncFromState(nextState);
  }

  async function handleDeleteTracks(trackIds: string[]) {
    if (!activePlaylistId || !trackIds.length) {
      return;
    }

    const nextState = deleteTracksFromPlaylist(activePlaylistId, trackIds);
    syncFromState(nextState);
    applyPlaylistToPlayer(getActivePlaylist(nextState), currentTrack?.id);
  }

  async function handleAddTrack(track: Track) {
    const title = await Dialog.prompt({
      title: "加入歌单",
      message: "输入目标歌单名。若不存在，会新建一个自定义歌单。",
      placeholder: "目标歌单名",
      confirmLabel: "加入",
      cancelLabel: "取消",
      selectAll: true,
    });

    if (title == null) {
      return;
    }

    await addTracksByTitle(title, [track]);
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
        await importSourceToSearch(pending.source);
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
        if (playlistBridge.activePlaylistId) {
          const nextState = replacePlaylistTracks(playlistBridge.activePlaylistId, queue);
          syncFromState(nextState);
        }
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

    if (initialInputError) {
      setError(initialInputError);
    }

    if (initialTracks.length > 0) {
      player.setQueue(initialTracks, persistedState.currentTrackId ?? null);
    }

    if (requestedSource) {
      void importSourceToSearch(requestedSource);
    } else if (initialPlaylist?.kind !== "user" && initialPlaylist?.source) {
      void refreshPlaylistSource(initialPlaylist.id);
    }

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
  }, [activePlaylistId, tracks.length, currentTrack?.id, loading, playLoading]);

  useEffect(() => {
    void syncBackgroundKeepAlive();
  }, [currentTrack?.id, playbackState]);

  useEffect(() => {
    player.setPlaybackMode(playbackMode);
  }, [playbackMode]);

  const playbackSnapshot = useMemo(
    () =>
      buildPlaybackSnapshot({
        source: playbackSource,
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
      playbackSource.input,
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
    const nextState = persistPlayerState({
      sourceDescriptor: playbackSource,
      sourceTitle,
      playbackMode,
      queue: tracks,
      currentTrackId: currentTrack?.id,
      playbackSnapshot,
    });
    syncFromState(nextState);
    reloadExternalSurfaces();
  }, [
    playbackSource.input,
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
  const currentSourceSummary = playlistSummaryLabel(activePlaylist);
  const currentSourceKind = playlistKindLabel(activePlaylist);
  const visibleRecentSources = recentSources.filter(
    (source) => source.input !== playbackSource.input,
  );
  const keepAliveLabel = keepAliveStateLabel(scenePhase, keepAliveState as any);
  const modeLabel = playbackModeLabel(playbackMode);
  const modeHint = playbackModeHint(playbackMode);
  const cachedTrackCount = useMemo(
    () => tracks.filter((track) => Boolean(track.localFilePath)).length,
    [tracks],
  );
  const currentTrackDuration = formatDuration(currentTrack?.durationSeconds);
  const currentTrackLabel = displayTrackTitle(currentTrack, sourceTitle);
  const queuePreview = useMemo(() => {
    if (!tracks.length) {
      return [] as Array<{ track: Track; index: number }>;
    }

    if (currentIndex >= 0) {
      const start = Math.max(0, currentIndex - 1);
      const end = Math.min(tracks.length, start + 4);
      return tracks.slice(start, end).map((track, offset) => ({
        track,
        index: start + offset,
      }));
    }

    return tracks.slice(0, 4).map((track, index) => ({ track, index }));
  }, [tracks, currentIndex]);

  return (
    <NavigationStack>
      <ScrollView
        navigationTitle={`Azusa ${BUILD_VERSION}`}
        navigationBarTitleDisplayMode={"large"}
      >
        <LazyVStack
          alignment={"leading"}
          spacing={24}
          padding={{ horizontal: 16, vertical: 16 }}>
          <VStack alignment={"leading"} spacing={12}>
            <Text font={"caption"} foregroundColor={"secondary"}>
              当前歌单
            </Text>
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
            }}>
            <HStack spacing={14}>
              <ArtworkView
                cover={sourceCover || currentTrack?.cover}
                width={124}
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
                    activePlaylistId={activePlaylistId}
                    playlists={playlistLibrary}
                    recentSources={visibleRecentSources.slice(0, 8)}
                    loading={loading}
                    errorMessage={error}
                    defaultQuery={playbackSource.input}
                    onSearchInput={loadSourceFromInput}
                    onOpenPlaylist={openPlaylist}
                    onCreatePlaylist={handleCreatePlaylist}
                    onRenamePlaylist={handleRenamePlaylist}
                    onDeletePlaylist={handleDeletePlaylist}
                    onRefreshPlaylist={refreshPlaylistSource}
                    onDuplicatePlaylistToNew={handleDuplicatePlaylistToNew}
                    onAddPlaylistToTitle={handleAddPlaylistToTitle}
                    onLoadSource={importSourceToSearch}
                  />
              }>
                <Text font={"body"} foregroundColor={"systemBlue"}>
                  打开歌单库
                </Text>
              </NavigationLink>
              {activePlaylist?.source ? (
                <Button
                  title={loading ? "同步中..." : "重新拉取"}
                  buttonStyle="bordered"
                  action={() => void refreshPlaylistSource(activePlaylist.id)}
                />
              ) : null}
              {activePlaylist?.kind === "search" ? (
                <Button
                  title="另存为歌单"
                  buttonStyle="bordered"
                  action={() =>
                    void handleDuplicatePlaylistToNew(
                      activePlaylist.id,
                      `${activePlaylist.title} 收藏`,
                    )
                  }
                />
              ) : null}
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
          </VStack>

        <VStack alignment={"leading"} spacing={12}>
          <Text font={"caption"} foregroundColor={"secondary"}>
            迷你播放器
          </Text>
          <MiniPlayerSection
            player={player}
            currentTrack={currentTrack}
            sourceCover={sourceCover}
            sourceTitle={sourceTitle}
            ownerName={ownerName}
            playbackState={playbackState}
            playbackLabel={playbackLabel}
            playbackMode={playbackMode}
            modeLabel={modeLabel}
            playbackDetail={playbackDetail}
            onPrimaryAction={() => void handlePrimaryAction()}
            onPrevious={() => void skipBy(-1)}
            onNext={() => void skipBy(1)}
            onCyclePlaybackMode={cyclePlaybackMode}
          />
        </VStack>

        <VStack alignment={"leading"} spacing={12}>
          <Text font={"caption"} foregroundColor={"secondary"}>
            播放队列
          </Text>
          {tracks.length === 0 ? (
            <VStack alignment={"leading"} spacing={4}>
              <Text font={"headline"}>还没有歌单</Text>
              <Text font={"subheadline"} foregroundColor={"secondary"}>
                现在支持视频、收藏夹、合集和频道四种来源。
              </Text>
            </VStack>
          ) : (
            <VStack alignment={"leading"} spacing={12}>
              <HStack spacing={12}>
                <VStack alignment={"leading"} spacing={4}>
                  <Text font={"headline"}>{activePlaylist?.title || sourceTitle}</Text>
                  <Text font={"caption"} foregroundColor={"secondary"}>
                    共 {tracks.length} 首
                    {currentIndex >= 0 ? ` · 当前 ${currentIndex + 1}/${tracks.length}` : ""}
                  </Text>
                </VStack>
                <Spacer />
                <NavigationLink
                  destination={
                    <QueueManagementPage
                      playlist={activePlaylist}
                      tracks={tracks}
                      sourceTitle={sourceTitle}
                      currentIndex={currentIndex}
                      playbackState={playbackState}
                      playLoading={playLoading}
                      onPlayTrackAt={(index) => void playTrackAt(index)}
                      onHandleDuplicatePlaylistToNew={handleDuplicatePlaylistToNew}
                      onHandleAddPlaylistToTitle={handleAddPlaylistToTitle}
                      onAddTracksByTitle={addTracksByTitle}
                      onHandleDeleteTracks={handleDeleteTracks}
                      onHandleRenameTrack={handleRenameTrack}
                      onHandleAddTrack={handleAddTrack}
                    />
                  }>
                  <Text font={"body"} foregroundColor={"systemBlue"}>
                    打开队列
                  </Text>
                </NavigationLink>
              </HStack>

              {queuePreview.map(({ track, index }) => {
                const isActive = currentIndex === index;
                const duration = formatDuration(track.durationSeconds);
                const displayTitle = displayTrackTitle(track, sourceTitle);
                return (
                  <Button key={track.id} action={() => void playTrackAt(index)}>
                    <HStack spacing={12}>
                      <VStack alignment={"leading"} spacing={4}>
                        <Text font={isActive ? "headline" : "body"}>
                          {index + 1}. {displayTitle}
                        </Text>
                        <Text font={"caption"} foregroundColor={"secondary"}>
                          {track.artist}
                          {duration ? ` · ${duration}` : ""}
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
              })}

              {tracks.length > queuePreview.length ? (
                <Text font={"caption"} foregroundColor={"secondary"}>
                  还有 {tracks.length - queuePreview.length} 首未显示
                </Text>
              ) : null}
            </VStack>
          )}
        </VStack>

          <VStack spacing={1} />
        </LazyVStack>
      </ScrollView>
    </NavigationStack>
  );
}
