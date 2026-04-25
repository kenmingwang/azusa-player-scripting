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
  sourceKindLabel,
  sourceSecondaryLabel,
  sourceShortLabel,
} from "./sources";
import type { PlaylistRecord, SourceDescriptor } from "./types";

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
  onLoadSource: (source: SourceDescriptor) => Promise<void>;
};

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

function PlaylistArtwork(props: { playlist: PlaylistRecord; active?: boolean }) {
  return (
    <ArtworkView
      cover={props.playlist.cover}
      width={58}
      height={58}
      contentMode="fill"
      backgroundStyle="none"
      cornerRadius={12}
      fallbackColor={props.active ? "systemBlue" : "systemGray3"}
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
        <Button
          title={props.loading ? "处理中..." : "刷新"}
          buttonStyle="bordered"
          action={() => void props.onRefreshPlaylist(props.playlist.id)}
        />
      ) : null}
      <Button title="另存为" buttonStyle="bordered" action={() => void promptDuplicate()} />
      <Button title="整单加入" buttonStyle="bordered" action={() => void promptAddToPlaylist()} />
      <Button title="重命名" buttonStyle="bordered" action={() => void promptRename()} />
      {props.playlist.kind === "user" ? (
        <Button title="删除" buttonStyle="bordered" action={() => void promptDelete()} />
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
    <VStack alignment={"leading"} spacing={10}>
      <HStack spacing={12}>
        <Button action={() => void props.onOpenPlaylist(props.playlist.id)}>
          <HStack spacing={12}>
            <PlaylistArtwork playlist={props.playlist} active={props.active} />
            <VStack alignment={"leading"} spacing={4}>
              <Text
                font={props.active ? "headline" : "body"}
                foregroundColor={props.active ? "systemBlue" : "primary"}>
                {props.playlist.title}
              </Text>
              <Text font={"caption"} foregroundColor={"secondary"}>
                {playlistSummary(props.playlist)}
              </Text>
            </VStack>
          </HStack>
        </Button>
        <Spacer />
        <Button
          title={showActions ? "收起" : "管理"}
          buttonStyle="bordered"
          action={() => setShowActions((current) => !current)}
        />
      </HStack>
      {showActions ? (
        <PlaylistActionButtons
          playlist={props.playlist}
          loading={props.loading}
          onRenamePlaylist={props.onRenamePlaylist}
          onDeletePlaylist={props.onDeletePlaylist}
          onRefreshPlaylist={props.onRefreshPlaylist}
          onDuplicatePlaylistToNew={props.onDuplicatePlaylistToNew}
          onAddPlaylistToTitle={props.onAddPlaylistToTitle}
        />
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
    <VStack alignment={"leading"} spacing={12}>
      <Text font={"caption"} foregroundColor={"secondary"}>
        {props.title}
      </Text>
      {!props.playlists.length ? (
        <Text font={"subheadline"} foregroundColor={"secondary"}>
          {props.emptyText ?? "暂无歌单"}
        </Text>
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

function RecentSourceRow(props: {
  key?: any;
  source: SourceDescriptor;
  onLoadSource: (source: SourceDescriptor) => Promise<void>;
}) {
  return (
    <Button action={() => void props.onLoadSource(props.source)} key={props.source.input}>
      <HStack spacing={12}>
        <Image
          systemName="clock.arrow.circlepath"
          resizable
          aspectRatio={{ contentMode: "fit" }}
          frame={{ width: 22, height: 22 }}
        />
        <VStack alignment={"leading"} spacing={3}>
          <Text font={"body"}>{sourceShortLabel(props.source)}</Text>
          <Text font={"caption"} foregroundColor={"secondary"}>
            {sourceKindLabel(props.source.kind)} · {sourceSecondaryLabel(props.source)}
          </Text>
        </VStack>
        <Spacer />
        <Text font={"caption"} foregroundColor={"systemBlue"}>
          导入
        </Text>
      </HStack>
    </Button>
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
      scrollDismissesKeyboard={"interactively"}>
      <LazyVStack
        alignment={"leading"}
        spacing={22}
        padding={{ horizontal: 16, vertical: 16 }}>
        {showSearch ? (
          <VStack alignment={"leading"} spacing={14}>
            <Text font={"title2"}>搜索</Text>
            <TextField
              title="来源"
              placeholder="BV / 视频链接 / 收藏夹 / 合集 / 频道"
              value={query}
              onChanged={setQuery}
            />
            <Text font={"caption"} foregroundColor={"secondary"}>
              支持 BV、视频链接、收藏夹 ID、收藏夹链接、season / series 链接、channel / UP 主页链接。
            </Text>
            <HStack spacing={10}>
              <Button
                title={props.loading ? "导入中..." : "导入"}
                buttonStyle="borderedProminent"
                action={() => void props.onSearchInput(query)}
              />
              <Button
                title="新建歌单"
                buttonStyle="bordered"
                action={() => void promptCreatePlaylist()}
              />
            </HStack>
            {props.errorMessage ? (
              <Text font={"caption"} foregroundColor={"systemRed"}>
                {props.errorMessage}
              </Text>
            ) : null}

            {searchPlaylist ? (
              <VStack alignment={"leading"} spacing={12}>
                <Text font={"caption"} foregroundColor={"secondary"}>
                  当前搜索歌单
                </Text>
                <PlaylistRow
                  playlist={searchPlaylist}
                  active={props.activePlaylistId === searchPlaylist.id}
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

            {props.recentSources.length > 0 ? (
              <VStack alignment={"leading"} spacing={12}>
                <Text font={"caption"} foregroundColor={"secondary"}>
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
          <VStack alignment={"leading"} spacing={20}>
            <HStack spacing={10}>
              <VStack alignment={"leading"} spacing={4}>
                <Text font={"title2"}>歌单库</Text>
                <Text font={"caption"} foregroundColor={"secondary"}>
                  {props.playlists.length} 个歌单
                </Text>
              </VStack>
              <Spacer />
              <Button
                title="新建"
                buttonStyle="bordered"
                action={() => void promptCreatePlaylist()}
              />
            </HStack>

            {searchPlaylist ? (
              <PlaylistGroup
                title="搜索歌单"
                playlists={[searchPlaylist]}
                activePlaylistId={props.activePlaylistId}
                loading={props.loading}
                onOpenPlaylist={props.onOpenPlaylist}
                onRenamePlaylist={props.onRenamePlaylist}
                onDeletePlaylist={props.onDeletePlaylist}
                onRefreshPlaylist={props.onRefreshPlaylist}
                onDuplicatePlaylistToNew={props.onDuplicatePlaylistToNew}
                onAddPlaylistToTitle={props.onAddPlaylistToTitle}
              />
            ) : null}

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
