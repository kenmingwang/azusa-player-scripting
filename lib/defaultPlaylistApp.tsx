import {
  AppEvents,
  BackgroundKeeper,
  Button,
  Dialog,
  HStack,
  Image,
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
import { InlineLyricsPanel } from "./lyricsPage";
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
  persistPlaybackSnapshot,
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

type AzusaTab = "search" | "player" | "library";

const AZUSA_TABS: Array<{
  id: AzusaTab;
  title: string;
  systemName: string;
}> = [
  { id: "search", title: "搜索", systemName: "magnifyingglass" },
  { id: "player", title: "播放", systemName: "play.circle" },
  { id: "library", title: "歌单", systemName: "folder" },
];

function AppTabBar(props: {
  activeTab: AzusaTab;
  onChange: (tab: AzusaTab) => void;
}) {
  return (
    <HStack
      spacing={8}
      padding={{ horizontal: 14, vertical: 10 }}
      background={{
        style: {
          light: "rgba(250, 250, 252, 0.96)",
          dark: "rgba(28, 28, 30, 0.96)",
        },
      }}>
      {AZUSA_TABS.map((item) => {
        const isActive = props.activeTab === item.id;

        return (
          <Button
            key={item.id}
            buttonStyle={isActive ? "borderedProminent" : "bordered"}
            action={() => props.onChange(item.id)}>
            <VStack
              spacing={3}
              padding={{ horizontal: 8, vertical: 4 }}>
              <Image
                systemName={item.systemName}
                resizable
                aspectRatio={{ contentMode: "fit" }}
                frame={{ width: 18, height: 18 }}
              />
              <Text font={"caption2"}>{item.title}</Text>
            </VStack>
          </Button>
        );
      })}
    </HStack>
  );
}

function AppPage(props: {
  title: string;
  subtitle?: string;
  children?: any;
}) {
  return (
    <ScrollView
      navigationTitle={props.title}
      navigationBarTitleDisplayMode={"inline"}>
      <LazyVStack
        alignment={"leading"}
        spacing={18}
        padding={{ horizontal: 16, vertical: 14 }}>
        <VStack alignment={"leading"} spacing={4}>
          <Text font={"title2"}>{props.title}</Text>
          {props.subtitle ? (
            <Text font={"caption"} foregroundColor={"secondary"}>
              {props.subtitle}
            </Text>
          ) : null}
        </VStack>
        {props.children}
        <VStack spacing={1} />
      </LazyVStack>
    </ScrollView>
  );
}

function SectionCard(props: { children?: any; accent?: boolean }) {
  return (
    <VStack
      alignment={"leading"}
      spacing={14}
      padding={{ horizontal: 16, vertical: 16 }}
      background={{
        style: props.accent
          ? {
              light: "rgba(239, 246, 255, 0.95)",
              dark: "rgba(37, 99, 235, 0.16)",
            }
          : {
              light: "rgba(248, 250, 252, 0.94)",
              dark: "rgba(255, 255, 255, 0.055)",
            },
        shape: {
          type: "rect",
          cornerRadius: 20,
          style: "continuous",
        },
      }}>
      {props.children}
    </VStack>
  );
}

function PrimaryActionRow(props: {
  title: string;
  subtitle?: string;
  systemName: string;
  trailing?: string;
}) {
  return (
    <HStack spacing={12}>
      <Image
        systemName={props.systemName}
        resizable
        aspectRatio={{ contentMode: "fit" }}
        frame={{ width: 20, height: 20 }}
      />
      <VStack alignment={"leading"} spacing={3}>
        <Text font={"body"}>{props.title}</Text>
        {props.subtitle ? (
          <Text font={"caption"} foregroundColor={"secondary"}>
            {props.subtitle}
          </Text>
        ) : null}
      </VStack>
      <Spacer />
      {props.trailing ? (
        <Text font={"caption"} foregroundColor={"systemBlue"}>
          {props.trailing}
        </Text>
      ) : null}
    </HStack>
  );
}

function CompactPager(props: {
  page: number;
  totalPages: number;
  startResult: number;
  endResult: number;
  resultCount: number;
  pageInput: string;
  onPageInputChange: (value: string) => void;
  onJumpToPage: (page: number) => void;
}) {
  return (
    <VStack alignment={"leading"} spacing={8}>
      <HStack spacing={8}>
        <Button
          title="上一页"
          buttonStyle="bordered"
          action={() => props.onJumpToPage(props.page - 1)}
        />
        <Text font={"caption"} foregroundColor={"secondary"}>
          第 {props.page}/{props.totalPages} 页
        </Text>
        <Button
          title="下一页"
          buttonStyle="bordered"
          action={() => props.onJumpToPage(props.page + 1)}
        />
        <Spacer />
      </HStack>
      <HStack spacing={8}>
        <TextField
          title="跳页"
          placeholder="页码"
          value={props.pageInput}
          onChanged={props.onPageInputChange}
        />
        <Button
          title="跳转"
          buttonStyle="bordered"
          action={() => props.onJumpToPage(Number.parseInt(props.pageInput, 10))}
        />
      </HStack>
      <Text font={"caption2"} foregroundColor={"secondary"}>
        显示 {props.startResult}-{props.endResult} / {props.resultCount}
      </Text>
    </VStack>
  );
}

function TrackListRow(props: {
  key?: any;
  track: Track;
  sourceTitle: string;
  displayIndex: number;
  isActive: boolean;
  playbackState: PlaybackUiState;
  playLoading: boolean;
  onPress: () => void | Promise<void>;
}) {
  const duration = formatDuration(props.track.durationSeconds);
  const status = trackStatusLabel(
    props.playbackState,
    props.isActive,
    props.playLoading,
  );

  return (
    <Button action={() => void props.onPress()}>
      <HStack
        spacing={12}
        padding={{ horizontal: 10, vertical: 8 }}
        background={
          props.isActive
            ? {
                style: {
                  light: "rgba(59, 130, 246, 0.1)",
                  dark: "rgba(59, 130, 246, 0.16)",
                },
                shape: {
                  type: "rect",
                  cornerRadius: 12,
                  style: "continuous",
                },
              }
            : undefined
        }>
        <Text
          font={"caption"}
          foregroundColor={props.isActive ? "systemBlue" : "secondary"}>
          {props.displayIndex}
        </Text>
        <VStack alignment={"leading"} spacing={4}>
          <Text
            font={props.isActive ? "headline" : "body"}
            foregroundColor={props.isActive ? "systemBlue" : "primary"}>
            {displayTrackTitle(props.track, props.sourceTitle)}
          </Text>
          <Text font={"caption"} foregroundColor={"secondary"}>
            {props.track.artist}
            {duration ? ` · ${duration}` : ""}
            {props.track.cid ? ` · ${props.track.cid}` : ""}
          </Text>
          {props.isActive ? (
            <Text font={"caption2"} foregroundColor={"systemBlue"}>
              {status}
            </Text>
          ) : null}
        </VStack>
        <Spacer />
        <Image
          systemName={props.isActive ? "speaker.wave.2.fill" : "play.fill"}
          resizable
          aspectRatio={{ contentMode: "fit" }}
          frame={{ width: 16, height: 16 }}
          foregroundColor={props.isActive ? "systemBlue" : "secondary"}
        />
      </HStack>
    </Button>
  );
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

function PlayerProgressPanel(props: MiniPlayerSectionProps) {
  const progress = usePlayerProgress(props.player);
  const liveTime = usePlaybackClock(progress, 500);
  const currentDurationSeconds =
    progress.duration || props.currentTrack?.durationSeconds || 0;

  return (
    <SectionCard>
      <PlaybackProgressView progress={progress} />
      {currentDurationSeconds > 0 ? (
        <HStack spacing={8}>
          <Text font={"caption"} foregroundColor={"secondary"}>
            {formatDuration(liveTime)} / {formatDuration(currentDurationSeconds)}
          </Text>
          <Spacer />
          <Text font={"caption"} foregroundColor={"secondary"}>
            {props.playbackLabel}
          </Text>
        </HStack>
      ) : null}
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
        <PrimaryActionRow
          title="全屏播放"
          subtitle="查看封面、歌词、队列状态"
          systemName="rectangle.expand.vertical"
          trailing="打开"
        />
      </NavigationLink>
    </SectionCard>
  );
}

type PlayerStageProps = MiniPlayerSectionProps & {
  showLyrics: boolean;
  currentIndex: number;
  queueLength: number;
  queueDestination: any;
  onToggleLyrics: () => void;
};

function PlayerStage(props: PlayerStageProps) {
  const progress = usePlayerProgress(props.player);
  const liveTime = usePlaybackClock(progress, 500);
  const currentDurationSeconds =
    progress.duration || props.currentTrack?.durationSeconds || 0;

  return (
    <VStack alignment={"center"} spacing={18}>
      {props.showLyrics ? (
        <InlineLyricsPanel
          compact
          track={props.currentTrack}
          onShowArtwork={props.onToggleLyrics}
        />
      ) : (
        <Button action={props.onToggleLyrics}>
          <VStack alignment={"center"} spacing={16}>
            <ArtworkView
              cover={props.currentTrack?.cover || props.sourceCover}
              size={276}
              contentMode="fit"
              backgroundStyle="soft"
              cornerRadius={28}
              fallbackColor={
                props.playbackState === "playing" ? "systemBlue" : "systemGray3"
              }
            />
            <VStack alignment={"center"} spacing={5}>
              <Text font={"title2"}>
                {displayTrackTitle(props.currentTrack, props.sourceTitle)}
              </Text>
              <Text font={"subheadline"} foregroundColor={"secondary"}>
                {props.currentTrack?.artist || props.ownerName || "Azusa"}
              </Text>
              <Text font={"caption"} foregroundColor={"secondary"}>
                点击封面查看歌词
              </Text>
            </VStack>
          </VStack>
        </Button>
      )}

      <VStack alignment={"leading"} spacing={8}>
        <PlaybackProgressView progress={progress} />
        <HStack spacing={8}>
          <Text font={"caption"} foregroundColor={"secondary"}>
            {formatDuration(liveTime) || "0:00"} /{" "}
            {formatDuration(currentDurationSeconds) || "0:00"}
          </Text>
          <Spacer />
          <Text font={"caption"} foregroundColor={"secondary"}>
            {props.playbackLabel}
          </Text>
        </HStack>
      </VStack>

      <TransportControls
        playbackState={props.playbackState}
        onPrevious={props.onPrevious}
        onPrimaryAction={props.onPrimaryAction}
        onNext={props.onNext}
      />

      <HStack spacing={10}>
        <PlaybackModeControl
          playbackMode={props.playbackMode}
          onCyclePlaybackMode={props.onCyclePlaybackMode}
        />
        <NavigationLink destination={props.queueDestination}>
          <PrimaryActionRow
            title="队列"
            subtitle={
              props.queueLength
                ? `当前 ${Math.max(props.currentIndex + 1, 0)}/${props.queueLength}`
                : "暂无歌曲"
            }
            systemName="music.note.list"
            trailing="打开"
          />
        </NavigationLink>
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

        <CompactPager
          page={pageState.page}
          totalPages={pageState.totalPages}
          startResult={pageState.startResult}
          endResult={pageState.endResult}
          resultCount={pageState.resultCount}
          pageInput={pageInput}
          onPageInputChange={setPageInput}
          onJumpToPage={jumpToPage}
        />

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
          {filteredTracks.map(({ track, index, displayIndex, isActive, rowId }) => (
            <TrackListRow
              key={rowId}
              track={track}
              sourceTitle={props.sourceTitle}
              displayIndex={displayIndex}
              isActive={isActive}
              playbackState={props.playbackState}
              playLoading={props.playLoading}
              onPress={() => props.onPlayTrackAt(index)}
            />
          ))}
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

        <CompactPager
          page={pageState.page}
          totalPages={pageState.totalPages}
          startResult={pageState.startResult}
          endResult={pageState.endResult}
          resultCount={pageState.resultCount}
          pageInput={pageInput}
          onPageInputChange={setPageInput}
          onJumpToPage={jumpToPage}
        />

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

        <CompactPager
          page={pageState.page}
          totalPages={pageState.totalPages}
          startResult={pageState.startResult}
          endResult={pageState.endResult}
          resultCount={pageState.resultCount}
          pageInput={pageInput}
          onPageInputChange={setPageInput}
          onJumpToPage={jumpToPage}
        />

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
              {visibleTracks.map(({ track, index, displayIndex, isActive, rowId }) => (
                <TrackListRow
                  key={rowId}
                  track={track}
                  sourceTitle={props.sourceTitle}
                  displayIndex={displayIndex}
                  isActive={isActive}
                  playbackState={props.playbackState}
                  playLoading={props.playLoading}
                  onPress={() => props.onPlayTrackAt(index)}
                />
              ))}
            </LazyVStack>
          )}
        </VStack>

        <VStack spacing={1} />
      </LazyVStack>
    </ScrollView>
  );
}

function QueueTabPanel(props: QueueManagementPageProps) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(pageForTrackIndex(props.currentIndex));
  const [pageInput, setPageInput] = useState(String(page));
  const pageState = useMemo(
    () =>
      buildPaginatedTrackState({
        tracks: props.tracks,
        query,
        page,
        currentIndex: props.currentIndex,
      }),
    [props.tracks, query, page, props.currentIndex],
  );

  useEffect(() => {
    if (!query && props.currentIndex >= 0) {
      setPage(pageForTrackIndex(props.currentIndex));
    }
  }, [props.currentIndex, query]);

  useEffect(() => {
    setPageInput(String(pageState.page));
  }, [pageState.page]);

  function handleQueryChange(nextQuery: string) {
    setQuery(nextQuery);
    setPage(1);
  }

  function jumpToPage(nextPage: number) {
    setPage(clampPage(nextPage, pageState.totalPages));
  }

  return (
    <AppPage
      title="队列"
      subtitle={`${props.playlist?.title || props.sourceTitle} · ${props.tracks.length} 首`}>
      <VStack alignment={"leading"} spacing={14}>
        <SectionCard>
          <HStack spacing={12}>
            <VStack alignment={"leading"} spacing={4}>
              <Text font={"headline"}>
                {props.playlist?.title || props.sourceTitle}
              </Text>
              <Text font={"caption"} foregroundColor={"secondary"}>
                {props.currentIndex >= 0
                  ? `当前 ${props.currentIndex + 1}/${props.tracks.length}`
                  : `共 ${props.tracks.length} 首`}
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
              <PrimaryActionRow
                title="工具"
                subtitle="搜索、批量、管理"
                systemName="slider.horizontal.3"
                trailing="打开"
              />
            </NavigationLink>
          </HStack>
        </SectionCard>

        <TextField
          title="搜索队列"
          placeholder="搜索全量歌曲"
          value={query}
          onChanged={handleQueryChange}
        />

        <CompactPager
          page={pageState.page}
          totalPages={pageState.totalPages}
          startResult={pageState.startResult}
          endResult={pageState.endResult}
          resultCount={pageState.resultCount}
          pageInput={pageInput}
          onPageInputChange={setPageInput}
          onJumpToPage={jumpToPage}
        />

        {pageState.rows.length === 0 ? (
          <SectionCard>
            <Text font={"body"} foregroundColor={"secondary"}>
              没有匹配的歌曲。
            </Text>
          </SectionCard>
        ) : (
          <LazyVStack alignment={"leading"} spacing={12}>
            {pageState.rows.map((row) => (
              <TrackListRow
                key={row.id}
                track={row.track}
                sourceTitle={props.sourceTitle}
                displayIndex={row.displayIndex}
                isActive={row.isActive}
                playbackState={props.playbackState}
                playLoading={props.playLoading}
                onPress={() => props.onPlayTrackAt(row.index)}
              />
            ))}
          </LazyVStack>
        )}
      </VStack>
    </AppPage>
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
  const externalSurfaceBridge = useMemo(
    () => ({
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
  const [activeTab, setActiveTab] = useState("player" as AzusaTab);
  const [showPlayerLyrics, setShowPlayerLyrics] = useState(false);
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
      syncFromState(clearPendingExternalCommand(pending.id));
    } catch (commandError) {
      setError(
        commandError instanceof Error ? commandError.message : String(commandError),
      );
      commandBridge.lastHandledId = pending.id;
      syncFromState(clearPendingExternalCommand(pending.id));
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
    persistPlaybackSnapshot({
      sourceDescriptor: playbackSource,
      sourceTitle,
      playbackMode,
      currentTrackId: currentTrack?.id,
      playbackSnapshot,
    });

    const nextExternalKey = JSON.stringify({
      sourceInput: playbackSource.input,
      sourceTitle,
      queueLength: tracks.length,
      currentTrackId: currentTrack?.id ?? "",
      currentIndex,
      playbackState,
      playbackMode,
      playbackDetail,
    });

    if (nextExternalKey !== externalSurfaceBridge.lastKey) {
      externalSurfaceBridge.lastKey = nextExternalKey;
      reloadExternalSurfaces();
    }
  }, [
    playbackSource.input,
    sourceTitle,
    tracks.length,
    currentTrack?.id,
    currentIndex,
    playbackState,
    playbackMode,
    playbackDetail,
    playbackSnapshot.updatedAt,
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
  const queueDestination = (
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
  );

  return (
    <NavigationStack>
      <VStack spacing={0}>
        {activeTab === "search" ? (
          <SourceLibraryPage
            mode="search"
            activePlaylistId={activePlaylistId}
            playlists={playlistLibrary}
            recentSources={visibleRecentSources.slice(0, 12)}
            loading={loading}
            errorMessage={error}
            defaultQuery={playbackSource.input}
            onSearchInput={async (input) => {
              await loadSourceFromInput(input);
              setActiveTab("player");
            }}
            onOpenPlaylist={async (playlistId) => {
              await openPlaylist(playlistId);
              setActiveTab("player");
            }}
            onCreatePlaylist={handleCreatePlaylist}
            onRenamePlaylist={handleRenamePlaylist}
            onDeletePlaylist={handleDeletePlaylist}
            onRefreshPlaylist={refreshPlaylistSource}
            onDuplicatePlaylistToNew={handleDuplicatePlaylistToNew}
            onAddPlaylistToTitle={handleAddPlaylistToTitle}
            onLoadSource={async (source) => {
              await importSourceToSearch(source);
              setActiveTab("player");
            }}
          />
        ) : null}

        {activeTab === "player" ? (
          <AppPage
            title="正在播放"
            subtitle={`${currentSourceKind} · ${currentSourceSummary || queueSummary}`}>
            <VStack alignment={"leading"} spacing={16}>
              <SectionCard accent>
                <PlayerStage
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
                  currentIndex={currentIndex}
                  queueLength={tracks.length}
                  queueDestination={queueDestination}
                  showLyrics={showPlayerLyrics}
                  onToggleLyrics={() => setShowPlayerLyrics((current) => !current)}
                  onPrimaryAction={() => void handlePrimaryAction()}
                  onPrevious={() => void skipBy(-1)}
                  onNext={() => void skipBy(1)}
                  onCyclePlaybackMode={cyclePlaybackMode}
                />
              </SectionCard>

              <SectionCard>
                <HStack spacing={12}>
                  <VStack alignment={"leading"} spacing={5}>
                    <Text font={"headline"}>{sourceTitle}</Text>
                    <Text font={"caption"} foregroundColor={"secondary"}>
                      {queueSummary} · 已缓存 {cachedTrackCount} / {tracks.length} 首
                    </Text>
                    <Text font={"caption"} foregroundColor={"secondary"}>
                      {modeLabel} · {modeHint}
                      {currentTrackDuration ? ` · ${currentTrackDuration}` : ""}
                    </Text>
                  </VStack>
                  <Spacer />
                  {activePlaylist?.source ? (
                    <Button
                      title={loading ? "同步中..." : "刷新"}
                      buttonStyle="bordered"
                      action={() => void refreshPlaylistSource(activePlaylist.id)}
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
                        外部命令待处理：{commandLabel(pendingCommand.type)}
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
              </SectionCard>
            </VStack>
          </AppPage>
        ) : null}

        {activeTab === "library" ? (
          <SourceLibraryPage
            mode="library"
            activePlaylistId={activePlaylistId}
            playlists={playlistLibrary}
            recentSources={visibleRecentSources.slice(0, 8)}
            loading={loading}
            errorMessage={error}
            defaultQuery={playbackSource.input}
            onSearchInput={async (input) => {
              await loadSourceFromInput(input);
              setActiveTab("player");
            }}
            onOpenPlaylist={async (playlistId) => {
              await openPlaylist(playlistId);
              setActiveTab("player");
            }}
            onCreatePlaylist={handleCreatePlaylist}
            onRenamePlaylist={handleRenamePlaylist}
            onDeletePlaylist={handleDeletePlaylist}
            onRefreshPlaylist={refreshPlaylistSource}
            onDuplicatePlaylistToNew={handleDuplicatePlaylistToNew}
            onAddPlaylistToTitle={handleAddPlaylistToTitle}
            onLoadSource={async (source) => {
              await importSourceToSearch(source);
              setActiveTab("player");
            }}
          />
        ) : null}

        <AppTabBar activeTab={activeTab} onChange={setActiveTab} />
      </VStack>
    </NavigationStack>
  );

}
