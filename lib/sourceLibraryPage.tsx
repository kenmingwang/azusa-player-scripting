import {
  Button,
  Dialog,
  HStack,
  List,
  Section,
  Spacer,
  Text,
  TextField,
  VStack,
  useEffect,
  useMemo,
  useState,
} from "scripting";

import {
  sourceKindLabel,
  sourceSecondaryLabel,
  sourceShortLabel,
} from "./sources";
import type { PlaylistRecord, SourceDescriptor } from "./types";

type SourceLibraryPageProps = {
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
  return `${playlistKindLabel(playlist)} · 共 ${playlist.tracks.length} 首${sourceLabel}`;
}

function PlaylistActionsRow(props: {
  playlist: PlaylistRecord;
  loading: boolean;
  onOpenPlaylist: (playlistId: string) => Promise<void>;
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

    if (title == null) {
      return;
    }

    await props.onRenamePlaylist(props.playlist.id, title);
  }

  async function promptDelete() {
    const confirmed = await Dialog.confirm({
      title: "删除这个歌单？",
      message: `将删除「${props.playlist.title}」的本地记录。`,
      confirmLabel: "删除",
      cancelLabel: "取消",
    });

    if (!confirmed) {
      return;
    }

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

    if (title == null) {
      return;
    }

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

    if (title == null) {
      return;
    }

    await props.onAddPlaylistToTitle(props.playlist.id, title);
  }

  return (
    <VStack alignment={"leading"} spacing={10}>
      <Button action={() => void props.onOpenPlaylist(props.playlist.id)}>
        <HStack spacing={12}>
          <VStack alignment={"leading"} spacing={3}>
            <Text font={"body"}>{props.playlist.title}</Text>
            <Text font={"caption"} foregroundColor={"secondary"}>
              {playlistSummary(props.playlist)}
            </Text>
          </VStack>
          <Spacer />
          <Text font={"caption"} foregroundColor={"systemBlue"}>
            打开
          </Text>
        </HStack>
      </Button>

      <HStack spacing={8}>
        {props.playlist.kind !== "user" ? (
          <Button
            title={props.loading ? "处理中..." : "刷新"}
            buttonStyle="bordered"
            action={() => void props.onRefreshPlaylist(props.playlist.id)}
          />
        ) : null}
        <Button
          title="另存为"
          buttonStyle="bordered"
          action={() => void promptDuplicate()}
        />
        <Button
          title="整单加入"
          buttonStyle="bordered"
          action={() => void promptAddToPlaylist()}
        />
        <Button
          title="重命名"
          buttonStyle="bordered"
          action={() => void promptRename()}
        />
        {props.playlist.kind === "user" ? (
          <Button
            title="删除"
            buttonStyle="bordered"
            action={() => void promptDelete()}
          />
        ) : null}
      </HStack>
    </VStack>
  );
}

export function SourceLibraryPage(props: SourceLibraryPageProps) {
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

  async function promptCreatePlaylist() {
    const title = await Dialog.prompt({
      title: "新建歌单",
      message: "输入新的歌单名。",
      placeholder: "歌单名",
      confirmLabel: "创建",
      cancelLabel: "取消",
      selectAll: true,
    });

    if (title == null) {
      return;
    }

    await props.onCreatePlaylist(title);
  }

  return (
    <List
      navigationTitle={"歌单库"}
      navigationBarTitleDisplayMode={"inline"}
      listStyle={"plain"}
    >
      <Section header={<Text font={"caption"}>搜索并导入来源</Text>}>
        <VStack alignment={"leading"} spacing={10}>
          <TextField
            title="来源输入"
            placeholder="BV / 视频链接 / 收藏夹 / 合集 / 频道"
            value={query}
            onChanged={setQuery}
          />
          <Text font={"caption"} foregroundColor={"secondary"}>
            支持 BV、视频链接、纯收藏夹 ID、收藏夹链接、season / series 链接、channel / UP 主页链接。
          </Text>
          <HStack spacing={10}>
            <Button
              title={props.loading ? "导入中..." : "导入到搜索歌单"}
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
        </VStack>
      </Section>

      {searchPlaylist ? (
        <Section header={<Text font={"caption"}>搜索歌单</Text>}>
          <PlaylistActionsRow
            playlist={searchPlaylist}
            loading={props.loading}
            onOpenPlaylist={props.onOpenPlaylist}
            onRenamePlaylist={props.onRenamePlaylist}
            onDeletePlaylist={props.onDeletePlaylist}
            onRefreshPlaylist={props.onRefreshPlaylist}
            onDuplicatePlaylistToNew={props.onDuplicatePlaylistToNew}
            onAddPlaylistToTitle={props.onAddPlaylistToTitle}
          />
        </Section>
      ) : null}

      {sourcePlaylists.length > 0 ? (
        <Section header={<Text font={"caption"}>来源歌单</Text>}>
          {sourcePlaylists.map((playlist) => (
            <VStack key={playlist.id} alignment={"leading"} spacing={0}>
              <PlaylistActionsRow
                playlist={playlist}
                loading={props.loading}
                onOpenPlaylist={props.onOpenPlaylist}
                onRenamePlaylist={props.onRenamePlaylist}
                onDeletePlaylist={props.onDeletePlaylist}
                onRefreshPlaylist={props.onRefreshPlaylist}
                onDuplicatePlaylistToNew={props.onDuplicatePlaylistToNew}
                onAddPlaylistToTitle={props.onAddPlaylistToTitle}
              />
            </VStack>
          ))}
        </Section>
      ) : null}

      <Section header={<Text font={"caption"}>自定义歌单</Text>}>
        {userPlaylists.length === 0 ? (
          <Text font={"subheadline"} foregroundColor={"secondary"}>
            还没有自定义歌单。可以先从搜索结果另存为，或者直接新建一个空歌单。
          </Text>
        ) : (
          userPlaylists.map((playlist) => (
            <VStack key={playlist.id} alignment={"leading"} spacing={0}>
              <PlaylistActionsRow
                playlist={playlist}
                loading={props.loading}
                onOpenPlaylist={props.onOpenPlaylist}
                onRenamePlaylist={props.onRenamePlaylist}
                onDeletePlaylist={props.onDeletePlaylist}
                onRefreshPlaylist={props.onRefreshPlaylist}
                onDuplicatePlaylistToNew={props.onDuplicatePlaylistToNew}
                onAddPlaylistToTitle={props.onAddPlaylistToTitle}
              />
            </VStack>
          ))
        )}
      </Section>

      {props.recentSources.length > 0 ? (
        <Section header={<Text font={"caption"}>最近来源</Text>}>
          {props.recentSources.map((source) => (
            <Button
              action={() => void props.onLoadSource(source)}
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
                  导入
                </Text>
              </HStack>
            </Button>
          ))}
        </Section>
      ) : null}
    </List>
  );
}
