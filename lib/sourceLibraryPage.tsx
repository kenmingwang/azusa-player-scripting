import {
  Button,
  Dialog,
  HStack,
  Image,
  LazyVStack,
  ScrollView,
  Spacer,
  Text,
  TextField,
  VStack,
  useEffect,
  useMemo,
  useState,
} from "scripting";

import { ArtworkView } from "./artworkView";
import {
  AzusaHeader,
  GlassPanel,
  IconLabel,
  IconOnlyButton,
  IconPillButton,
  StatusChip,
  azusaGlassBackground,
  azusaPageBackground,
} from "./azusaTheme";
import {
  sourceKindLabel,
  sourceSecondaryLabel,
  sourceShortLabel,
} from "./sources";
import type { PlaylistRecord, SourceDescriptor, Track } from "./types";

type SourceLibraryPageProps = {
  mode?: "search" | "library" | "all";
  activePlaylistId?: string;
  playlists: PlaylistRecord[];
  recentSources: SourceDescriptor[];
  loading: boolean;
  errorMessage?: string | null;
  defaultQuery?: string;
  onSearchInput: (input: string) => Promise<void>;
  onOpenPlaylist: (playlistId: string) => Promise<void>;
  onCreatePlaylist: (title: string) => Promise<void>;
  onRenamePlaylist: (playlistId: string, title: string) => Promise<void>;
  onDeletePlaylist: (playlistId: string) => Promise<void>;
  onRefreshPlaylist: (playlistId: string) => Promise<void>;
  onDuplicatePlaylistToNew: (playlistId: string, title: string) => Promise<void>;
  onAddPlaylistToTitle: (playlistId: string, targetTitle: string) => Promise<void>;
  onPlayTracks: (tracks: Track[]) => Promise<void>;
  onAddTracksToTitle: (targetTitle: string, tracks: Track[]) => Promise<void>;
  onCreatePlaylistWithTracks: (title: string, tracks: Track[]) => Promise<void>;
  onLoadSource: (source: SourceDescriptor) => Promise<void>;
};

const SEARCH_RESULT_PAGE_SIZE = 50;

function playlistKindLabel(playlist: PlaylistRecord) {
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

function playlistSummary(playlist: PlaylistRecord) {
  const sourceLabel = playlist.source
    ? ` · ${sourceSecondaryLabel(playlist.source)}`
    : "";
  return `${playlistKindLabel(playlist)} · ${playlist.tracks.length} 首${sourceLabel}`;
}

function shortMessage(message?: string | null) {
  if (!message) {
    return "";
  }

  const firstLine = message.split("\n")[0]?.trim() ?? message.trim();
  return firstLine.length > 48 ? `${firstLine.slice(0, 48)}...` : firstLine;
}

function trackDisplayTitle(track: Track, playlistTitle: string) {
  return track.title.startsWith(`${playlistTitle} · `)
    ? track.title.slice(playlistTitle.length + 3)
    : track.title;
}

function PlaylistArtwork(props: { playlist: PlaylistRecord; active?: boolean }) {
  return (
    <ArtworkView
      cover={props.playlist.cover}
      width={64}
      height={64}
      contentMode="fill"
      backgroundStyle="none"
      cornerRadius={14}
      fallbackColor={props.active ? "systemBlue" : "systemPurple"}
    />
  );
}

function PlaylistActionButtons(props: {
  playlist: PlaylistRecord;
  loading: boolean;
  onRenamePlaylist: (playlistId: string, title: string) => Promise<void>;
  onDeletePlaylist: (playlistId: string) => Promise<void>;
  onRefreshPlaylist: (playlistId: string) => Promise<void>;
  onDuplicatePlaylistToNew: (playlistId: string, title: string) => Promise<void>;
  onAddPlaylistToTitle: (playlistId: string, targetTitle: string) => Promise<void>;
}) {
  async function promptRename() {
    const title = await Dialog.prompt({
      title: "重命名歌单",
      message: "输入新的歌单名。",
      defaultValue: props.playlist.title,
      placeholder: "歌单名",
      confirmLabel: "保存",
      cancelLabel: "取消",
      selectAll: true,
    });

    if (title == null) return;
    await props.onRenamePlaylist(props.playlist.id, title);
  }

  async function promptDelete() {
    const confirmed = await Dialog.confirm({
      title: "删除这个歌单？",
      message: `将删除「${props.playlist.title}」的本地记录。`,
      confirmLabel: "删除",
      cancelLabel: "取消",
    });

    if (!confirmed) return;
    await props.onDeletePlaylist(props.playlist.id);
  }

  async function promptDuplicate() {
    const title = await Dialog.prompt({
      title: "另存为新歌单",
      message: "输入新的歌单名。",
      defaultValue: `${props.playlist.title} 副本`,
      placeholder: "歌单名",
      confirmLabel: "保存",
      cancelLabel: "取消",
      selectAll: true,
    });

    if (title == null) return;
    await props.onDuplicatePlaylistToNew(props.playlist.id, title);
  }

  async function promptAddToPlaylist() {
    const title = await Dialog.prompt({
      title: "整单加入歌单",
      message: "输入目标歌单名。若不存在，会新建一个自定义歌单。",
      placeholder: "目标歌单名",
      confirmLabel: "加入",
      cancelLabel: "取消",
      selectAll: true,
    });

    if (title == null) return;
    await props.onAddPlaylistToTitle(props.playlist.id, title);
  }

  return (
    <HStack spacing={8}>
      {props.playlist.kind !== "user" ? (
        <IconOnlyButton
          systemName="arrow.clockwise"
          action={() => void props.onRefreshPlaylist(props.playlist.id)}
        />
      ) : null}
      <IconOnlyButton systemName="plus.square.on.square" action={() => void promptDuplicate()} />
      <IconOnlyButton systemName="text.badge.plus" action={() => void promptAddToPlaylist()} />
      <IconOnlyButton systemName="pencil" action={() => void promptRename()} />
      {props.playlist.kind === "user" ? (
        <IconOnlyButton systemName="trash" action={() => void promptDelete()} />
      ) : null}
    </HStack>
  );
}

function PlaylistRow(props: {
  key?: any;
  playlist: PlaylistRecord;
  active: boolean;
  loading: boolean;
  onOpenPlaylist: (playlistId: string) => Promise<void>;
  onRenamePlaylist: (playlistId: string, title: string) => Promise<void>;
  onDeletePlaylist: (playlistId: string) => Promise<void>;
  onRefreshPlaylist: (playlistId: string) => Promise<void>;
  onDuplicatePlaylistToNew: (playlistId: string, title: string) => Promise<void>;
  onAddPlaylistToTitle: (playlistId: string, targetTitle: string) => Promise<void>;
}) {
  const [showActions, setShowActions] = useState(false);

  return (
    <VStack
      alignment={"leading"}
      spacing={8}
      padding={{ horizontal: 6, vertical: 8 }}
      background={azusaGlassBackground(props.active ? "accent" : "soft", 14)}>
      <HStack spacing={12}>
        <PlaylistArtwork playlist={props.playlist} active={props.active} />
        <VStack alignment={"leading"} spacing={4}>
          <Text
            font={"body"}
            foregroundColor={"primary"}>
            {props.playlist.title}
          </Text>
          <Text font={"caption"} foregroundColor={"secondary"}>
            {playlistSummary(props.playlist)}
          </Text>
          {props.active ? (
            <Text font={"caption2"} foregroundColor={"systemBlue"}>
              正在使用
            </Text>
          ) : null}
        </VStack>
        <Spacer />
        <IconOnlyButton
          systemName={props.active ? "speaker.wave.2.fill" : "play.fill"}
          prominent={props.active}
          action={() => void props.onOpenPlaylist(props.playlist.id)}
        />
        <IconOnlyButton systemName="ellipsis" action={() => setShowActions((current) => !current)} />
      </HStack>
      {showActions ? (
        <HStack spacing={8}>
          <Spacer />
          <PlaylistActionButtons
            playlist={props.playlist}
            loading={props.loading}
            onRenamePlaylist={props.onRenamePlaylist}
            onDeletePlaylist={props.onDeletePlaylist}
            onRefreshPlaylist={props.onRefreshPlaylist}
            onDuplicatePlaylistToNew={props.onDuplicatePlaylistToNew}
            onAddPlaylistToTitle={props.onAddPlaylistToTitle}
          />
        </HStack>
      ) : null}
    </VStack>
  );
}

function PlaylistGroup(props: {
  title: string;
  emptyText?: string;
  playlists: PlaylistRecord[];
  activePlaylistId?: string;
  loading: boolean;
  onOpenPlaylist: (playlistId: string) => Promise<void>;
  onRenamePlaylist: (playlistId: string, title: string) => Promise<void>;
  onDeletePlaylist: (playlistId: string) => Promise<void>;
  onRefreshPlaylist: (playlistId: string) => Promise<void>;
  onDuplicatePlaylistToNew: (playlistId: string, title: string) => Promise<void>;
  onAddPlaylistToTitle: (playlistId: string, targetTitle: string) => Promise<void>;
}) {
  return (
    <VStack alignment={"leading"} spacing={8}>
      <HStack spacing={8}>
        <Text font={"headline"}>
          {props.title}
        </Text>
        <Text font={"caption"} foregroundColor={"secondary"}>
          {props.playlists.length} 个
        </Text>
      </HStack>
      {!props.playlists.length ? (
        <GlassPanel compact tone="soft">
          <Text font={"subheadline"} foregroundColor={"secondary"}>
            {props.emptyText ?? "暂无歌单"}
          </Text>
        </GlassPanel>
      ) : (
        props.playlists.map((playlist) => (
          <PlaylistRow
            key={playlist.id}
            playlist={playlist}
            active={props.activePlaylistId === playlist.id}
            loading={props.loading}
            onOpenPlaylist={props.onOpenPlaylist}
            onRenamePlaylist={props.onRenamePlaylist}
            onDeletePlaylist={props.onDeletePlaylist}
            onRefreshPlaylist={props.onRefreshPlaylist}
            onDuplicatePlaylistToNew={props.onDuplicatePlaylistToNew}
            onAddPlaylistToTitle={props.onAddPlaylistToTitle}
          />
        ))
      )}
    </VStack>
  );
}

function SearchResultTrackRow(props: {
  key?: any;
  track: Track;
  index: number;
  playlistTitle: string;
  selected: boolean;
  onToggle: (trackId: string) => void;
}) {
  return (
    <Button action={() => props.onToggle(props.track.id)}>
      <HStack
        spacing={10}
        padding={{ horizontal: 10, vertical: 8 }}
        background={azusaGlassBackground(props.selected ? "accent" : "soft", 16)}>
        <Image
          systemName={props.selected ? "checkmark.circle.fill" : "circle"}
          resizable
          aspectRatio={{ contentMode: "fit" }}
          frame={{ width: 18, height: 18 }}
          foregroundColor={props.selected ? "systemBlue" : "secondary"}
        />
        <Text font={"caption"} foregroundColor={"secondary"}>
          {props.index + 1}
        </Text>
        <VStack alignment={"leading"} spacing={3}>
          <Text font={"subheadline"} foregroundColor={"primary"}>
            {trackDisplayTitle(props.track, props.playlistTitle)}
          </Text>
          <Text font={"caption2"} foregroundColor={"secondary"}>
            {props.track.artist}
          </Text>
        </VStack>
        <Spacer />
      </HStack>
    </Button>
  );
}

function SearchResultPanel(props: {
  playlist: PlaylistRecord;
  active: boolean;
  loading: boolean;
  onOpenPlaylist: (playlistId: string) => Promise<void>;
  onRenamePlaylist: (playlistId: string, title: string) => Promise<void>;
  onDeletePlaylist: (playlistId: string) => Promise<void>;
  onRefreshPlaylist: (playlistId: string) => Promise<void>;
  onDuplicatePlaylistToNew: (playlistId: string, title: string) => Promise<void>;
  onAddPlaylistToTitle: (playlistId: string, targetTitle: string) => Promise<void>;
  onPlayTracks: (tracks: Track[]) => Promise<void>;
  onAddTracksToTitle: (targetTitle: string, tracks: Track[]) => Promise<void>;
  onCreatePlaylistWithTracks: (title: string, tracks: Track[]) => Promise<void>;
}) {
  const [showActions, setShowActions] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState([] as string[]);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(
    1,
    Math.ceil(props.playlist.tracks.length / SEARCH_RESULT_PAGE_SIZE),
  );
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * SEARCH_RESULT_PAGE_SIZE;
  const visibleTracks = props.playlist.tracks.slice(
    pageStart,
    pageStart + SEARCH_RESULT_PAGE_SIZE,
  );
  const selectedTracks = props.playlist.tracks.filter((track) =>
    selectedTrackIds.includes(track.id),
  );

  useEffect(() => {
    setSelectedTrackIds([]);
    setPage(1);
  }, [props.playlist.id, props.playlist.tracks.length]);

  function toggleTrack(trackId: string) {
    setSelectedTrackIds((current) =>
      current.includes(trackId)
        ? current.filter((id) => id !== trackId)
        : [...current, trackId],
    );
  }

  function selectVisibleTracks() {
    const visibleIds = visibleTracks.map((track) => track.id);
    setSelectedTrackIds((current) => {
      const next = [...current];
      visibleIds.forEach((id) => {
        if (!next.includes(id)) {
          next.push(id);
        }
      });
      return next;
    });
  }

  function selectAllTracks() {
    setSelectedTrackIds(props.playlist.tracks.map((track) => track.id));
  }

  async function promptAddSelectedToPlaylist() {
    if (!selectedTracks.length) return;
    const title = await Dialog.prompt({
      title: "加入歌单",
      message: `把选中的 ${selectedTracks.length} 首加入目标歌单。若不存在，会新建一个自定义歌单。`,
      placeholder: "目标歌单名",
      confirmLabel: "加入",
      cancelLabel: "取消",
      selectAll: true,
    });

    if (title == null) return;
    await props.onAddTracksToTitle(title, selectedTracks);
  }

  async function promptCreatePlaylistFromSelection() {
    if (!selectedTracks.length) return;
    const title = await Dialog.prompt({
      title: "新建歌单",
      message: `用选中的 ${selectedTracks.length} 首创建一个新歌单。`,
      defaultValue: `${props.playlist.title} 精选`,
      placeholder: "歌单名",
      confirmLabel: "创建",
      cancelLabel: "取消",
      selectAll: true,
    });

    if (title == null) return;
    await props.onCreatePlaylistWithTracks(title, selectedTracks);
  }

  return (
    <VStack alignment={"leading"} spacing={14}>
      <HStack
        spacing={12}
        padding={{ horizontal: 12, vertical: 12 }}
        background={azusaGlassBackground("soft", 22)}>
        <PlaylistArtwork playlist={props.playlist} active={props.active} />
        <VStack alignment={"leading"} spacing={4}>
          <Text font={"body"} foregroundColor={"primary"}>
            {props.playlist.title}
          </Text>
          <Text font={"caption"} foregroundColor={"secondary"}>
            {props.playlist.tracks.length} 首 · {props.playlist.source ? sourceSecondaryLabel(props.playlist.source) : "搜索结果"}
          </Text>
          {props.active ? (
            <Text font={"caption2"} foregroundColor={"systemBlue"}>
              正在使用
            </Text>
          ) : null}
        </VStack>
        <Spacer />
        <IconOnlyButton
          systemName="play.fill"
          prominent
          action={() => void props.onPlayTracks(props.playlist.tracks)}
        />
        <IconOnlyButton
          systemName="ellipsis"
          action={() => setShowActions((current) => !current)}
        />
      </HStack>

      {showActions ? (
        <GlassPanel compact tone="soft">
          <PlaylistActionButtons
            playlist={props.playlist}
            loading={props.loading}
            onRenamePlaylist={props.onRenamePlaylist}
            onDeletePlaylist={props.onDeletePlaylist}
            onRefreshPlaylist={props.onRefreshPlaylist}
            onDuplicatePlaylistToNew={props.onDuplicatePlaylistToNew}
            onAddPlaylistToTitle={props.onAddPlaylistToTitle}
          />
        </GlassPanel>
      ) : null}

      {visibleTracks.length ? (
        <VStack alignment={"leading"} spacing={8}>
          <VStack
            alignment={"leading"}
            spacing={8}
            padding={{ horizontal: 10, vertical: 10 }}
            background={azusaGlassBackground("soft", 18)}>
            <HStack spacing={8}>
              <VStack alignment={"leading"} spacing={3}>
                <Text font={"caption"} foregroundColor={"secondary"}>
                  已选 {selectedTracks.length} 首
                  {totalPages > 1 ? ` · 第 ${safePage}/${totalPages} 页` : ""}
                </Text>
              </VStack>
              <Spacer />
              <IconOnlyButton
                systemName="checkmark.circle"
                action={selectVisibleTracks}
              />
              <IconOnlyButton
                systemName="checkmark.circle.fill"
                action={selectAllTracks}
              />
              <IconOnlyButton
                systemName="xmark.circle"
                action={() => setSelectedTrackIds([])}
              />
            </HStack>
            <HStack spacing={8}>
              <VStack alignment={"leading"} spacing={2}>
                <Text font={"subheadline"}>
                  {selectedTracks.length ? "播放或收藏选中歌曲" : "播放全部，或点歌曲左侧选择"}
                </Text>
                <Text font={"caption"} foregroundColor={"secondary"}>
                  {props.playlist.tracks.length} 首 · {props.playlist.source ? sourceSecondaryLabel(props.playlist.source) : "搜索结果"}
                </Text>
              </VStack>
              <Spacer />
              <IconOnlyButton
                systemName="play.fill"
                prominent
                action={() =>
                  void props.onPlayTracks(
                    selectedTracks.length ? selectedTracks : props.playlist.tracks,
                  )
                }
              />
              <IconOnlyButton
                systemName="text.badge.plus"
                action={() => void promptAddSelectedToPlaylist()}
              />
              <IconOnlyButton
                systemName="folder.badge.plus"
                action={() => void promptCreatePlaylistFromSelection()}
              />
            </HStack>
            {totalPages > 1 ? (
              <HStack spacing={8}>
                <Spacer />
                <IconOnlyButton
                  systemName="chevron.left"
                  action={() => setPage((current) => Math.max(1, current - 1))}
                />
                <Text font={"caption"} foregroundColor={"secondary"}>
                  {safePage}/{totalPages}
                </Text>
                <IconOnlyButton
                  systemName="chevron.right"
                  action={() => setPage((current) => Math.min(totalPages, current + 1))}
                />
              </HStack>
            ) : null}
          </VStack>
          {visibleTracks.map((track, index) => (
            <SearchResultTrackRow
              key={track.id}
              track={track}
              index={pageStart + index}
              playlistTitle={props.playlist.title}
              selected={selectedTrackIds.includes(track.id)}
              onToggle={toggleTrack}
            />
          ))}
        </VStack>
      ) : null}
    </VStack>
  );
}

function RecentSourceRow(props: {
  key?: any;
  source: SourceDescriptor;
  onLoadSource: (source: SourceDescriptor) => Promise<void>;
}) {
  return (
    <HStack
      key={props.source.input}
      spacing={12}
      padding={{ horizontal: 12, vertical: 10 }}
      background={azusaGlassBackground("soft", 18)}>
      <IconLabel
        systemName="clock.arrow.circlepath"
        title={sourceShortLabel(props.source)}
        subtitle={`${sourceKindLabel(props.source.kind)} · ${sourceSecondaryLabel(props.source)}`}
      />
      <Spacer />
      <IconOnlyButton
        systemName="square.and.arrow.down"
        action={() => void props.onLoadSource(props.source)}
      />
    </HStack>
  );
}

function SourceSearchBox(props: {
  value: string;
  onChanged: (value: string) => void;
}) {
  return (
    <HStack
      spacing={12}
      padding={{ horizontal: 14, vertical: 12 }}
      background={azusaGlassBackground("strong", 22)}>
      <Image
        systemName="magnifyingglass"
        resizable
        aspectRatio={{ contentMode: "fit" }}
        frame={{ width: 22, height: 22 }}
        foregroundColor={"systemBlue"}
      />
      <VStack alignment={"leading"} spacing={5}>
        <Text font={"caption"} foregroundColor={"secondary"}>
          输入 BV / 链接 / 收藏夹 ID / 合集
        </Text>
        <TextField
          title="搜索来源"
          placeholder="例如 BV1YQpfzwECM"
          value={props.value}
          onChanged={props.onChanged}
        />
      </VStack>
      {props.value ? (
        <IconOnlyButton
          systemName="xmark.circle.fill"
          action={() => props.onChanged("")}
        />
      ) : null}
    </HStack>
  );
}

export function SourceLibraryPage(props: SourceLibraryPageProps) {
  const mode = props.mode ?? "all";
  const [query, setQuery] = useState(props.defaultQuery ?? "");

  useEffect(() => {
    setQuery(props.defaultQuery ?? "");
  }, [props.defaultQuery]);

  const searchPlaylist = useMemo(
    () => props.playlists.find((playlist) => playlist.kind === "search") ?? null,
    [props.playlists],
  );
  const userPlaylists = useMemo(
    () => props.playlists.filter((playlist) => playlist.kind === "user"),
    [props.playlists],
  );
  const sourcePlaylists = useMemo(
    () => props.playlists.filter((playlist) => playlist.kind === "source"),
    [props.playlists],
  );
  const showSearch = mode === "search" || mode === "all";
  const showLibrary = mode === "library" || mode === "all";

  async function promptCreatePlaylist() {
    const title = await Dialog.prompt({
      title: "新建歌单",
      message: "输入新的歌单名。",
      placeholder: "歌单名",
      confirmLabel: "创建",
      cancelLabel: "取消",
      selectAll: true,
    });

    if (title == null) return;
    await props.onCreatePlaylist(title);
  }

  return (
    <ScrollView
      navigationTitle={mode === "search" ? "搜索" : "歌单库"}
      navigationBarTitleDisplayMode={"inline"}
      scrollDismissesKeyboard={"interactively"}
      background={azusaPageBackground()}>
      <LazyVStack
        alignment={"leading"}
        spacing={22}
        padding={{ horizontal: 16, vertical: 16 }}>
        {showSearch ? (
          <VStack alignment={"leading"} spacing={14}>
            <AzusaHeader
              eyebrow="Azusa import"
              title="导入与挑歌"
              subtitle="先把来源拉成列表，再选择播放或加入歌单。"
            />
            <GlassPanel tone="accent">
              <SourceSearchBox value={query} onChanged={setQuery} />
              <Text font={"caption"} foregroundColor={"secondary"}>
                支持 BV、视频链接、收藏夹 ID、收藏夹链接、season / series、channel / UP 主页。
              </Text>
              <HStack spacing={10}>
                <IconPillButton
                  title={props.loading ? "导入中..." : "导入列表"}
                  systemName="square.and.arrow.down"
                  prominent
                  action={() => void props.onSearchInput(query)}
                />
                <IconPillButton
                  title="新建空歌单"
                  systemName="plus"
                  action={() => void promptCreatePlaylist()}
                />
              </HStack>
            </GlassPanel>
            {props.errorMessage ? (
              <StatusChip title={shortMessage(props.errorMessage)} tone="red" />
            ) : null}

            {searchPlaylist ? (
              <VStack alignment={"leading"} spacing={10}>
                <Text font={"caption"} foregroundColor={"secondary"}>
                  导入结果
                </Text>
                <SearchResultPanel
                  playlist={searchPlaylist}
                  active={props.activePlaylistId === searchPlaylist.id}
                  loading={props.loading}
                  onOpenPlaylist={props.onOpenPlaylist}
                  onRenamePlaylist={props.onRenamePlaylist}
                  onDeletePlaylist={props.onDeletePlaylist}
                  onRefreshPlaylist={props.onRefreshPlaylist}
                  onDuplicatePlaylistToNew={props.onDuplicatePlaylistToNew}
                  onAddPlaylistToTitle={props.onAddPlaylistToTitle}
                  onPlayTracks={props.onPlayTracks}
                  onAddTracksToTitle={props.onAddTracksToTitle}
                  onCreatePlaylistWithTracks={props.onCreatePlaylistWithTracks}
                />
              </VStack>
            ) : null}

            {props.recentSources.length > 0 ? (
              <VStack alignment={"leading"} spacing={12}>
                <Text font={"headline"}>
                  最近来源
                </Text>
                {props.recentSources.map((source) => (
                  <RecentSourceRow
                    key={source.input}
                    source={source}
                    onLoadSource={props.onLoadSource}
                  />
                ))}
              </VStack>
            ) : null}
          </VStack>
        ) : null}

        {showLibrary ? (
          <VStack alignment={"leading"} spacing={18}>
            <AzusaHeader
              eyebrow="Azusa library"
              title="我的歌单"
              subtitle="打开歌单播放，点更多管理。"
              trailing={
                <IconOnlyButton
                  systemName="plus"
                  prominent
                  action={() => void promptCreatePlaylist()}
                />
              }
            />

            <HStack
              spacing={14}
              padding={{ horizontal: 14, vertical: 12 }}
              background={azusaGlassBackground("strong", 22)}>
              <Image
                systemName="music.note.list"
                resizable
                aspectRatio={{ contentMode: "fit" }}
                frame={{ width: 24, height: 24 }}
                foregroundColor={"systemBlue"}
              />
              <VStack alignment={"leading"} spacing={3}>
                <Text font={"headline"}>{props.playlists.length} 个歌单</Text>
                <Text font={"caption"} foregroundColor={"secondary"}>
                  来源 {sourcePlaylists.length} · 自定义 {userPlaylists.length}
                </Text>
              </VStack>
            </HStack>

            <PlaylistGroup
              title="来源歌单"
              playlists={sourcePlaylists}
              activePlaylistId={props.activePlaylistId}
              loading={props.loading}
              onOpenPlaylist={props.onOpenPlaylist}
              onRenamePlaylist={props.onRenamePlaylist}
              onDeletePlaylist={props.onDeletePlaylist}
              onRefreshPlaylist={props.onRefreshPlaylist}
              onDuplicatePlaylistToNew={props.onDuplicatePlaylistToNew}
              onAddPlaylistToTitle={props.onAddPlaylistToTitle}
            />

            <PlaylistGroup
              title="自定义歌单"
              emptyText="还没有自定义歌单。可以先从搜索结果另存为，或者新建一个空歌单。"
              playlists={userPlaylists}
              activePlaylistId={props.activePlaylistId}
              loading={props.loading}
              onOpenPlaylist={props.onOpenPlaylist}
              onRenamePlaylist={props.onRenamePlaylist}
              onDeletePlaylist={props.onDeletePlaylist}
              onRefreshPlaylist={props.onRefreshPlaylist}
              onDuplicatePlaylistToNew={props.onDuplicatePlaylistToNew}
              onAddPlaylistToTitle={props.onAddPlaylistToTitle}
            />
          </VStack>
        ) : null}

        <VStack spacing={1} />
      </LazyVStack>
    </ScrollView>
  );
}
