import {
  Button,
  Dialog,
  DocumentPicker,
  FileManager,
  HStack,
  LazyVStack,
  NavigationLink,
  ScrollView,
  Spacer,
  Text,
  TextField,
  VStack,
  useEffect,
  useMemo,
  useState,
} from "scripting";

import {
  activeLyricLine,
  activeLyricLineIndex,
  parseLyrics,
} from "./lyrics";
import {
  extractSongName,
  fetchLyricBySongMid,
  searchLyricOptions,
} from "./lyricSearch";
import { PlaybackProgressView } from "./playbackProgressView";
import { getSharedPlayer } from "./player";
import {
  clearTrackLyrics,
  loadTrackLyricsEntry,
  saveTrackLyricsEntry,
  setTrackLyricOffset,
} from "./storage";
import { usePlaybackClock, usePlayerProgress } from "./usePlayerProgress";
import type { LyricSearchOption, Track, TrackLyricsEntry } from "./types";

type LyricsPageProps = {
  track: Track | null;
};

type LyricsFollowPageProps = {
  player: ReturnType<typeof getSharedPlayer>;
  track: Track | null;
  rawLyrics: string;
  lyricsEntry: TrackLyricsEntry | null;
  onLyricsEntryChange: (entry: TrackLyricsEntry | null) => void;
  onRawLyricsChange: (raw: string) => void;
};

type LyricsToolsPageProps = {
  player: ReturnType<typeof getSharedPlayer>;
  track: Track | null;
  rawLyrics: string;
  lyricsEntry: TrackLyricsEntry | null;
  onLyricsEntryChange: (entry: TrackLyricsEntry | null) => void;
  onRawLyricsChange: (raw: string) => void;
};

const LYRIC_SLOT_OFFSETS = [-3, -2, -1, 0, 1, 2, 3] as const;

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function trackStorageInput(track: Track | null) {
  return {
    id: track?.id,
    title: track?.title,
    artist: track?.artist,
  };
}

function displayTrackTitle(track: Track | null) {
  if (!track) {
    return "";
  }

  return track.title.startsWith(`${track.sourceTitle} · `)
    ? track.title.slice(track.sourceTitle.length + 3)
    : track.title;
}

function defaultSearchKey(track: Track | null) {
  return extractSongName(displayTrackTitle(track)).trim();
}

function lyricSourceLabel(entry: TrackLyricsEntry | null, hasLyrics: boolean) {
  if (!hasLyrics) {
    return "还没有歌词";
  }

  if (entry?.songMid) {
    return "在线歌词";
  }

  return "本地歌词";
}

function LyricsFollowPage(props: LyricsFollowPageProps) {
  const progress = usePlayerProgress(props.player);
  const parsedLyrics = useMemo(() => parseLyrics(props.rawLyrics), [props.rawLyrics]);
  const offsetMs = props.lyricsEntry?.offsetMs ?? 0;
  const liveTime = usePlaybackClock(progress, 420);
  const effectiveCurrentTime = useMemo(
    () => Math.max(0, liveTime + offsetMs / 1000),
    [liveTime, offsetMs],
  );
  const activeIndex = useMemo(
    () => activeLyricLineIndex(parsedLyrics, effectiveCurrentTime),
    [parsedLyrics, effectiveCurrentTime],
  );
  const anchorIndex = activeIndex >= 0 ? activeIndex : 0;
  const lyricStatus = lyricSourceLabel(props.lyricsEntry, parsedLyrics.lines.length > 0);
  const focusedLyric = activeIndex >= 0 ? parsedLyrics.lines[activeIndex] ?? null : null;

  const lyricSlots = useMemo(
    () =>
      LYRIC_SLOT_OFFSETS.map((offset) => {
        const index = anchorIndex + offset;
        const line =
          index >= 0 && index < parsedLyrics.lines.length
            ? parsedLyrics.lines[index]
            : null;

        return {
          slotKey: `slot-${offset}`,
          offset,
          line,
        };
      }),
    [anchorIndex, parsedLyrics.lines],
  );

  return (
    <ScrollView
      navigationTitle={"歌词"}
      navigationBarTitleDisplayMode={"inline"}>
      <LazyVStack
        alignment={"leading"}
        spacing={24}
        padding={{ horizontal: 16, vertical: 16 }}>
        <VStack alignment={"leading"} spacing={12}>
          <Text font={"caption"} foregroundColor={"secondary"}>
            当前歌词
          </Text>
          {!props.track ? (
            <Text font={"body"} foregroundColor={"secondary"}>
              先开始播放，再进入歌词页。
            </Text>
          ) : (
            <VStack alignment={"leading"} spacing={10}>
              <Text font={"title3"}>
                {displayTrackTitle(props.track)}
              </Text>
              <Text font={"subheadline"} foregroundColor={"secondary"}>
                {props.track.artist || "Azusa"}
              </Text>
              <PlaybackProgressView progress={progress} />
              <HStack spacing={8}>
                <Text font={"caption"} foregroundColor={"secondary"}>
                  播放时间 {formatTime(effectiveCurrentTime)}
                </Text>
                <Spacer />
                <Text font={"caption"} foregroundColor={"secondary"}>
                  偏移 {offsetMs}ms
                </Text>
              </HStack>
              <Text font={"caption"} foregroundColor={"secondary"}>
                {lyricStatus}
                {props.lyricsEntry?.selectedLabel
                  ? ` · ${props.lyricsEntry.selectedLabel}`
                  : ""}
                {props.lyricsEntry?.sourceKind
                  ? ` · ${props.lyricsEntry.sourceKind}`
                  : ""}
              </Text>
            </VStack>
          )}
        </VStack>

        <VStack
          alignment={"center"}
          spacing={12}
          padding={{ vertical: 8 }}>
          {!props.track ? null : !parsedLyrics.lines.length ? (
            <VStack alignment={"center"} spacing={10}>
              <Text font={"body"}>这首歌还没有歌词。</Text>
              <Text font={"caption"} foregroundColor={"secondary"}>
                打开工具页后可以搜索 QQ 候选，也支持导入本地 `.lrc` / `.txt`。
              </Text>
            </VStack>
          ) : (
            lyricSlots.map(({ slotKey, offset, line }) => {
              const isActive = offset === 0 && activeIndex >= 0 && Boolean(line);
              const isNearActive = Math.abs(offset) === 1 && Boolean(line);
              const font = isActive
                ? "largeTitle"
                : isNearActive
                  ? "title3"
                  : "body";

              return (
                <Text
                  key={slotKey}
                  font={font}
                  multilineTextAlignment={"center"}
                  foregroundColor={isActive ? "systemBlue" : "secondary"}>
                  {line?.text || " "}
                </Text>
              );
            })
          )}

          {focusedLyric?.timeSeconds != null ? (
            <Text font={"caption"} foregroundColor={"secondary"}>
              {formatTime(
                focusedLyric.timeSeconds + parsedLyrics.offsetMs / 1000,
              )}
            </Text>
          ) : null}
        </VStack>

        <NavigationLink
          destination={
            <LyricsToolsPage
              player={props.player}
              track={props.track}
              rawLyrics={props.rawLyrics}
              lyricsEntry={props.lyricsEntry}
              onLyricsEntryChange={props.onLyricsEntryChange}
              onRawLyricsChange={props.onRawLyricsChange}
            />
          }>
          <HStack spacing={12}>
            <VStack alignment={"leading"} spacing={4}>
              <Text font={"body"}>打开歌词工具</Text>
              <Text font={"caption"} foregroundColor={"secondary"}>
                搜索候选、导入本地歌词、调整偏移、查看诊断
              </Text>
            </VStack>
            <Spacer />
            <Text font={"caption"} foregroundColor={"systemBlue"}>
              打开
            </Text>
          </HStack>
        </NavigationLink>

        <VStack spacing={1} />
      </LazyVStack>
    </ScrollView>
  );
}

function LyricsToolsPage(props: LyricsToolsPageProps) {
  const [options, setOptions] = useState([] as LyricSearchOption[]);
  const [selectedSongMid, setSelectedSongMid] = useState(
    props.lyricsEntry?.songMid ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");
  const [searchNonce, setSearchNonce] = useState(0);
  const [searchText, setSearchText] = useState(defaultSearchKey(props.track));

  const progress = usePlayerProgress(props.player);
  const liveTime = usePlaybackClock(progress, 500);
  const parsedLyrics = useMemo(() => parseLyrics(props.rawLyrics), [props.rawLyrics]);
  const offsetMs = props.lyricsEntry?.offsetMs ?? 0;
  const effectiveCurrentTime = useMemo(
    () => Math.max(0, liveTime + offsetMs / 1000),
    [liveTime, offsetMs],
  );
  const activeIndex = useMemo(
    () => activeLyricLineIndex(parsedLyrics, effectiveCurrentTime),
    [parsedLyrics, effectiveCurrentTime],
  );
  const activeLine = useMemo(
    () => activeLyricLine(parsedLyrics, effectiveCurrentTime),
    [parsedLyrics, effectiveCurrentTime],
  );

  useEffect(() => {
    if (!props.track) {
      setOptions([]);
      setSelectedSongMid("");
      setMessage("");
      setSearchText("");
      return;
    }

    setOptions([]);
    setSelectedSongMid(props.lyricsEntry?.songMid ?? "");
    setMessage("");
    setSearchText(props.lyricsEntry?.searchKey ?? defaultSearchKey(props.track));
    setSearchNonce((current) => current + 1);
  }, [props.track?.id]);

  async function applyOnlineLyrics(option: LyricSearchOption, auto = false) {
    if (!props.track) {
      return;
    }

    setBusy(true);

    try {
      const nextLyrics = await fetchLyricBySongMid(option.songMid);
      const nextEntry: TrackLyricsEntry = {
        rawLyric: nextLyrics,
        songMid: option.songMid,
        selectedLabel: option.label,
        searchKey: searchText.trim(),
        offsetMs: props.lyricsEntry?.offsetMs ?? 0,
        sourceKind: auto ? "qq-auto" : "qq-manual",
        updatedAt: new Date().toISOString(),
      };

      saveTrackLyricsEntry(trackStorageInput(props.track), nextEntry);
      props.onLyricsEntryChange(nextEntry);
      props.onRawLyricsChange(nextLyrics);
      setSelectedSongMid(option.songMid);
      setMessage(auto ? `已自动匹配 ${option.label}` : `已切换到 ${option.label}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const searchKey = searchText.trim();
    if (!props.track || !searchKey) {
      setOptions([]);
      return;
    }

    let cancelled = false;
    const currentEntry = loadTrackLyricsEntry(trackStorageInput(props.track));

    async function runSearch() {
      setSearching(true);

      try {
        const nextOptions = await searchLyricOptions(searchKey);
        if (cancelled) {
          return;
        }

        setOptions(nextOptions);
        setSelectedSongMid(currentEntry?.songMid ?? "");

        if (!nextOptions.length && !currentEntry?.rawLyric) {
          setMessage("无法找到歌词");
          return;
        }

        const preferredOption =
          (currentEntry?.songMid
            ? nextOptions.find((option) => option.songMid === currentEntry.songMid)
            : undefined) ?? nextOptions[0];

        if (!currentEntry?.rawLyric && preferredOption) {
          await applyOnlineLyrics(preferredOption, true);
        }
      } catch (error) {
        if (!cancelled) {
          setOptions([]);
          if (!currentEntry?.rawLyric) {
            setMessage(error instanceof Error ? error.message : String(error));
          }
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    }

    void runSearch();

    return () => {
      cancelled = true;
    };
  }, [searchNonce]);

  async function importLyricsFile() {
    if (!props.track) {
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const filePath = (
        await DocumentPicker.pickFiles({
          allowsMultipleSelection: false,
          types: ["public.plain-text"],
        })
      )?.at(0);

      if (!filePath) {
        return;
      }

      const nextLyrics = await FileManager.readAsString(filePath);
      const nextEntry: TrackLyricsEntry = {
        rawLyric: nextLyrics,
        searchKey: searchText.trim(),
        offsetMs: props.lyricsEntry?.offsetMs ?? 0,
        sourceKind: "local",
        updatedAt: new Date().toISOString(),
      };

      saveTrackLyricsEntry(trackStorageInput(props.track), nextEntry);
      props.onLyricsEntryChange(nextEntry);
      props.onRawLyricsChange(nextLyrics);
      setSelectedSongMid("");
      setMessage("歌词已导入");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      try {
        DocumentPicker.stopAcessingSecurityScopedResources?.();
      } catch {}
      setBusy(false);
    }
  }

  async function clearLyrics() {
    if (!props.track) {
      return;
    }

    const confirmed = await Dialog.confirm({
      title: "清除这首歌的歌词？",
      message: "只会删除当前项目里保存的歌词缓存。",
      confirmLabel: "清除",
      cancelLabel: "取消",
    });

    if (!confirmed) {
      return;
    }

    clearTrackLyrics(trackStorageInput(props.track));
    props.onLyricsEntryChange(null);
    props.onRawLyricsChange("");
    setSelectedSongMid("");
    setMessage("歌词已清除");
  }

  function adjustOffset(deltaMs: number) {
    if (!props.track) {
      return;
    }

    const nextEntry = setTrackLyricOffset(
      trackStorageInput(props.track),
      (props.lyricsEntry?.offsetMs ?? 0) + deltaMs,
    );

    if (!nextEntry) {
      return;
    }

    props.onLyricsEntryChange(nextEntry);
    setMessage(`歌词偏移已调整到 ${nextEntry.offsetMs ?? 0}ms`);
  }

  const lyricSource = lyricSourceLabel(props.lyricsEntry, parsedLyrics.lines.length > 0);

  return (
    <ScrollView
      navigationTitle={"歌词工具"}
      navigationBarTitleDisplayMode={"inline"}
      scrollDismissesKeyboard={"interactively"}>
      <LazyVStack
        alignment={"leading"}
        spacing={24}
        padding={{ horizontal: 16, vertical: 16 }}>
        <VStack alignment={"leading"} spacing={12}>
          <Text font={"caption"} foregroundColor={"secondary"}>
            搜索歌词
          </Text>
          <TextField
            title="搜索关键字"
            placeholder="手动输入歌名重新搜词"
            value={searchText}
            onChanged={setSearchText}
          />
          <HStack spacing={10}>
            <Button
              title={searching ? "搜索中..." : "重新搜索"}
              buttonStyle="borderedProminent"
              action={() => {
                setSearchNonce((current) => current + 1);
              }}
            />
            <Button
              title={busy ? "处理中..." : "导入 LRC / TXT"}
              buttonStyle="bordered"
              action={() => void importLyricsFile()}
            />
            {props.rawLyrics ? (
              <Button
                title="清除"
                buttonStyle="bordered"
                action={() => void clearLyrics()}
              />
            ) : null}
          </HStack>
        </VStack>

        <VStack alignment={"leading"} spacing={12}>
          <Text font={"caption"} foregroundColor={"secondary"}>
            歌词偏移
          </Text>
          <HStack spacing={10}>
            <Button
              title="-50ms"
              buttonStyle="bordered"
              action={() => adjustOffset(-50)}
            />
            <Button
              title="归零"
              buttonStyle="bordered"
              action={() => adjustOffset(-(props.lyricsEntry?.offsetMs ?? 0))}
            />
            <Button
              title="+50ms"
              buttonStyle="bordered"
              action={() => adjustOffset(50)}
            />
          </HStack>
          <Text font={"caption"} foregroundColor={"secondary"}>
            正值会让歌词更早进入高亮，负值会更晚。步进固定 50ms。
          </Text>
        </VStack>

        <VStack alignment={"leading"} spacing={12}>
          <Text font={"caption"} foregroundColor={"secondary"}>
            诊断
          </Text>
          <Text font={"caption"} foregroundColor={"secondary"}>
            当前播放时间：{formatTime(effectiveCurrentTime)}
          </Text>
          <Text font={"caption"} foregroundColor={"secondary"}>
            当前高亮索引：{activeIndex >= 0 ? String(activeIndex) : "未命中"}
          </Text>
          <Text font={"caption"} foregroundColor={"secondary"}>
            当前高亮时间：
            {activeLine?.timeSeconds != null
              ? formatTime(activeLine.timeSeconds + parsedLyrics.offsetMs / 1000)
              : "无"}
          </Text>
          <Text font={"caption"} foregroundColor={"secondary"}>
            当前歌词来源：
            {[
              lyricSource,
              props.lyricsEntry?.selectedLabel,
              props.lyricsEntry?.sourceKind,
            ]
              .filter(Boolean)
              .join(" · ") || "无"}
          </Text>
        </VStack>

        {message ? (
          <VStack alignment={"leading"} spacing={12}>
            <Text font={"caption"} foregroundColor={"secondary"}>
              状态
            </Text>
            <Text font={"caption"} foregroundColor={"secondary"}>
              {message}
            </Text>
          </VStack>
        ) : null}

        {props.track ? (
          <VStack alignment={"leading"} spacing={12}>
            <Text font={"caption"} foregroundColor={"secondary"}>
              歌词候选
            </Text>
            {!options.length ? (
              <Text foregroundColor={"secondary"}>
                {searching ? "正在搜索歌词候选..." : "还没有找到可用候选。"}
              </Text>
            ) : (
              options.map((option) => {
                const isSelected = selectedSongMid === option.songMid;
                return (
                  <Button
                    key={option.songMid}
                    buttonStyle={isSelected ? "borderedProminent" : "bordered"}
                    title={isSelected ? `使用中 · ${option.label}` : option.label}
                    action={() => void applyOnlineLyrics(option)}
                  />
                );
              })
            )}
          </VStack>
        ) : null}

        <VStack spacing={1} />
      </LazyVStack>
    </ScrollView>
  );
}

export function LyricsPage(props: LyricsPageProps) {
  const player = getSharedPlayer();
  const [lyricsEntry, setLyricsEntry] = useState(
    (props.track ? loadTrackLyricsEntry(trackStorageInput(props.track)) : null) as
      | TrackLyricsEntry
      | null,
  );
  const [rawLyrics, setRawLyrics] = useState(lyricsEntry?.rawLyric ?? "");

  useEffect(() => {
    if (!props.track) {
      setLyricsEntry(null);
      setRawLyrics("");
      return;
    }

    const nextEntry = loadTrackLyricsEntry(trackStorageInput(props.track));
    setLyricsEntry(nextEntry);
    setRawLyrics(nextEntry?.rawLyric ?? "");
  }, [props.track?.id]);

  return (
    <LyricsFollowPage
      player={player}
      track={props.track}
      rawLyrics={rawLyrics}
      lyricsEntry={lyricsEntry}
      onLyricsEntryChange={setLyricsEntry}
      onRawLyricsChange={setRawLyrics}
    />
  );
}
