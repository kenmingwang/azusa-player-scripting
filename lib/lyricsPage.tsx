import {
  Button,
  Dialog,
  DocumentPicker,
  FileManager,
  HStack,
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

import { activeLyricLineIndex, parseLyrics } from "./lyrics";
import {
  extractSongName,
  fetchLyricBySongMid,
  searchLyricOptions,
} from "./lyricSearch";
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
  onLyricsEntryChange?: (entry: TrackLyricsEntry | null) => void;
};

type InlineLyricsPanelProps = LyricsPageProps & {
  compact?: boolean;
  onShowArtwork?: () => void;
};

const LYRIC_SLOT_OFFSETS = [-2, -1, 0, 1, 2] as const;

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
  if (!hasLyrics) return "暂无歌词";
  if (entry?.songMid) return "在线歌词";
  return "本地歌词";
}

export function InlineLyricsPanel(props: InlineLyricsPanelProps) {
  const player = getSharedPlayer();
  const [lyricsEntry, setLyricsEntry] = useState(
    (props.track ? loadTrackLyricsEntry(trackStorageInput(props.track)) : null) as
      | TrackLyricsEntry
      | null,
  );
  const [rawLyrics, setRawLyrics] = useState(lyricsEntry?.rawLyric ?? "");
  const [options, setOptions] = useState([] as LyricSearchOption[]);
  const [selectedSongMid, setSelectedSongMid] = useState(
    lyricsEntry?.songMid ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");
  const [searchNonce, setSearchNonce] = useState(0);
  const [searchText, setSearchText] = useState(defaultSearchKey(props.track));
  const [showSearch, setShowSearch] = useState(false);

  const progress = usePlayerProgress(player);
  const parsedLyrics = useMemo(() => parseLyrics(rawLyrics), [rawLyrics]);
  const offsetMs = lyricsEntry?.offsetMs ?? 0;
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
  const focusedLyric = activeIndex >= 0 ? parsedLyrics.lines[activeIndex] ?? null : null;
  const lyricSource = lyricSourceLabel(lyricsEntry, parsedLyrics.lines.length > 0);

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

  useEffect(() => {
    if (!props.track) {
      setLyricsEntry(null);
      setRawLyrics("");
      setOptions([]);
      setSelectedSongMid("");
      setSearchText("");
      setMessage("");
      return;
    }

    const nextEntry = loadTrackLyricsEntry(trackStorageInput(props.track));
    setLyricsEntry(nextEntry);
    setRawLyrics(nextEntry?.rawLyric ?? "");
    setSelectedSongMid(nextEntry?.songMid ?? "");
    setSearchText(nextEntry?.searchKey ?? defaultSearchKey(props.track));
    setOptions([]);
    setMessage("");
    setSearchNonce((current) => current + 1);
  }, [props.track?.id]);

  function handleLyricsEntryChange(entry: TrackLyricsEntry | null) {
    setLyricsEntry(entry);
    props.onLyricsEntryChange?.(entry);
  }

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
        offsetMs: lyricsEntry?.offsetMs ?? 0,
        sourceKind: auto ? "qq-auto" : "qq-manual",
        updatedAt: new Date().toISOString(),
      };

      saveTrackLyricsEntry(trackStorageInput(props.track), nextEntry);
      handleLyricsEntryChange(nextEntry);
      setRawLyrics(nextLyrics);
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

        const preferredOption =
          (currentEntry?.songMid
            ? nextOptions.find((option) => option.songMid === currentEntry.songMid)
            : undefined) ?? nextOptions[0];

        if (!currentEntry?.rawLyric && preferredOption) {
          await applyOnlineLyrics(preferredOption, true);
        } else if (!nextOptions.length && !currentEntry?.rawLyric) {
          setMessage("没有找到可用歌词");
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
        offsetMs: lyricsEntry?.offsetMs ?? 0,
        sourceKind: "local",
        updatedAt: new Date().toISOString(),
      };

      saveTrackLyricsEntry(trackStorageInput(props.track), nextEntry);
      handleLyricsEntryChange(nextEntry);
      setRawLyrics(nextLyrics);
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
    handleLyricsEntryChange(null);
    setRawLyrics("");
    setSelectedSongMid("");
    setMessage("歌词已清除");
  }

  function adjustOffset(deltaMs: number) {
    if (!props.track) {
      return;
    }

    const nextEntry = setTrackLyricOffset(
      trackStorageInput(props.track),
      (lyricsEntry?.offsetMs ?? 0) + deltaMs,
    );

    if (!nextEntry) {
      return;
    }

    handleLyricsEntryChange(nextEntry);
    setMessage(`偏移 ${nextEntry.offsetMs ?? 0}ms`);
  }

  function resetOffset() {
    adjustOffset(-(lyricsEntry?.offsetMs ?? 0));
  }

  return (
    <VStack
      alignment={"center"}
      spacing={props.compact ? 14 : 20}
      padding={{ horizontal: props.compact ? 4 : 16, vertical: props.compact ? 6 : 16 }}
      background={
        props.compact
          ? undefined
          : {
              style: {
                light: "rgba(244, 246, 250, 0.9)",
                dark: "rgba(255, 255, 255, 0.035)",
              },
              shape: {
                type: "rect",
                cornerRadius: 24,
                style: "continuous",
              },
            }
      }>
      <VStack alignment={"center"} spacing={5}>
        {props.onShowArtwork ? (
          <Button
            title="返回封面"
            buttonStyle="bordered"
            action={() => props.onShowArtwork?.()}
          />
        ) : null}
        <Text font={"headline"}>{displayTrackTitle(props.track)}</Text>
        <Text font={"caption"} foregroundColor={"secondary"}>
          {props.track?.artist || "Azusa"} · {lyricSource} · 偏移 {offsetMs}ms
        </Text>
      </VStack>

      <VStack alignment={"center"} spacing={12} padding={{ vertical: 18 }}>
        {!props.track ? (
          <Text font={"body"} foregroundColor={"secondary"}>
            先开始播放，再查看歌词。
          </Text>
        ) : !parsedLyrics.lines.length ? (
          <VStack alignment={"center"} spacing={8}>
            <Text font={"title3"}>还没有歌词</Text>
            <Text font={"caption"} foregroundColor={"secondary"}>
              可以搜索在线歌词，或导入本地 LRC / TXT。
            </Text>
          </VStack>
        ) : (
          lyricSlots.map(({ slotKey, offset, line }) => {
            const isActive = offset === 0 && activeIndex >= 0 && Boolean(line);
            const isNearActive = Math.abs(offset) === 1 && Boolean(line);
            const font = isActive ? "largeTitle" : isNearActive ? "title3" : "body";

            return (
              <Text
                key={slotKey}
                font={font}
                multilineTextAlignment={"center"}
                foregroundColor={isActive ? "primary" : "secondary"}>
                {line?.text || " "}
              </Text>
            );
          })
        )}

        {focusedLyric?.timeSeconds != null ? (
          <Text font={"caption"} foregroundColor={"secondary"}>
            {formatTime(focusedLyric.timeSeconds + parsedLyrics.offsetMs / 1000)}
          </Text>
        ) : null}
      </VStack>

      <VStack alignment={"leading"} spacing={10}>
        <HStack spacing={8}>
          <Button
            title={showSearch ? "收起搜索" : "搜索歌词"}
            buttonStyle="borderedProminent"
            action={() => setShowSearch((current) => !current)}
          />
          <Button
            title={busy ? "处理中..." : "导入"}
            buttonStyle="bordered"
            action={() => void importLyricsFile()}
          />
          {rawLyrics ? (
            <Button
              title="清除"
              buttonStyle="bordered"
              action={() => void clearLyrics()}
            />
          ) : null}
        </HStack>

        {showSearch ? (
          <VStack alignment={"leading"} spacing={10}>
            <TextField
              title="关键词"
              placeholder="歌名 / 歌手"
              value={searchText}
              onChanged={setSearchText}
            />
            <Button
              title={searching ? "搜索中..." : "重新搜索"}
              buttonStyle="bordered"
              action={() => setSearchNonce((current) => current + 1)}
            />
            {!options.length ? (
              <Text font={"caption"} foregroundColor={"secondary"}>
                {searching ? "正在搜索歌词候选..." : "暂无候选"}
              </Text>
            ) : (
              <VStack alignment={"leading"} spacing={8}>
                {options.map((option) => {
                  const isSelected = selectedSongMid === option.songMid;
                  return (
                    <Button
                      key={option.songMid}
                      buttonStyle={isSelected ? "borderedProminent" : "bordered"}
                      title={isSelected ? `使用中 · ${option.label}` : option.label}
                      action={() => void applyOnlineLyrics(option)}
                    />
                  );
                })}
              </VStack>
            )}
          </VStack>
        ) : null}

        <HStack spacing={8}>
          <Button title="-100ms" buttonStyle="bordered" action={() => adjustOffset(-100)} />
          <Button title="-50ms" buttonStyle="bordered" action={() => adjustOffset(-50)} />
          <Button title="归零" buttonStyle="bordered" action={resetOffset} />
          <Button title="+50ms" buttonStyle="bordered" action={() => adjustOffset(50)} />
          <Button title="+100ms" buttonStyle="bordered" action={() => adjustOffset(100)} />
        </HStack>

        {message ? (
          <Text font={"caption"} foregroundColor={"secondary"}>
            {message}
          </Text>
        ) : null}
      </VStack>
    </VStack>
  );
}

export function LyricsPage(props: LyricsPageProps) {
  return (
    <ScrollView
      navigationTitle={"歌词"}
      navigationBarTitleDisplayMode={"inline"}
      scrollDismissesKeyboard={"interactively"}>
      <LazyVStack
        alignment={"leading"}
        spacing={18}
        padding={{ horizontal: 16, vertical: 16 }}>
        <InlineLyricsPanel track={props.track} onLyricsEntryChange={props.onLyricsEntryChange} />
        <VStack spacing={1} />
      </LazyVStack>
    </ScrollView>
  );
}
