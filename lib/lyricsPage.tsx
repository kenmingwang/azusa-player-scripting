import {
  Button,
  Dialog,
  DocumentPicker,
  FileManager,
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

import { activeLyricLineIndex, parseLyrics } from "./lyrics";
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
import { usePlayerProgress } from "./usePlayerProgress";
import type { LyricSearchOption, Track, TrackLyricsEntry } from "./types";

const globalRuntime = globalThis as any;
const setIntervalApi =
  typeof globalRuntime.setInterval === "function"
    ? globalRuntime.setInterval.bind(globalRuntime)
    : null;
const clearIntervalApi =
  typeof globalRuntime.clearInterval === "function"
    ? globalRuntime.clearInterval.bind(globalRuntime)
    : null;

type LyricsPageProps = {
  track: Track | null;
};

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

export function LyricsPage(props: LyricsPageProps) {
  const track = props.track;
  const player = getSharedPlayer();
  const progress = usePlayerProgress(player);
  const [lyricsEntry, setLyricsEntry] = useState(
    (track ? loadTrackLyricsEntry(trackStorageInput(track)) : null) as
      | TrackLyricsEntry
      | null,
  );
  const [rawLyrics, setRawLyrics] = useState(lyricsEntry?.rawLyric ?? "");
  const [options, setOptions] = useState([] as LyricSearchOption[]);
  const [selectedSongMid, setSelectedSongMid] = useState(lyricsEntry?.songMid ?? "");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");
  const [searchNonce, setSearchNonce] = useState(0);
  const [autoApplyAllowed, setAutoApplyAllowed] = useState(true);
  const [searchText, setSearchText] = useState(defaultSearchKey(track));
  const [followTick, setFollowTick] = useState(Date.now());

  useEffect(() => {
    if (!track) {
      setLyricsEntry(null);
      setRawLyrics("");
      setOptions([]);
      setSelectedSongMid("");
      setMessage("");
      setAutoApplyAllowed(true);
      setSearchText("");
      return;
    }

    const nextEntry = loadTrackLyricsEntry(trackStorageInput(track));
    setLyricsEntry(nextEntry);
    setRawLyrics(nextEntry?.rawLyric ?? "");
    setOptions([]);
    setSelectedSongMid(nextEntry?.songMid ?? "");
    setMessage("");
    setAutoApplyAllowed(!nextEntry?.rawLyric);
    setSearchText(nextEntry?.searchKey ?? defaultSearchKey(track));
  }, [track?.id]);

  useEffect(() => {
    if (!setIntervalApi || !track) {
      return;
    }

    const timer = setIntervalApi(() => {
      setFollowTick(Date.now());
    }, 300) as unknown as number;

    return () => {
      if (clearIntervalApi) {
        clearIntervalApi(timer);
      }
    };
  }, [track?.id]);

  const searchKey = searchText.trim();

  useEffect(() => {
    if (!track || !searchKey.trim()) {
      setOptions([]);
      return;
    }

    let cancelled = false;
    const currentEntry = loadTrackLyricsEntry(trackStorageInput(track));

    async function runSearch() {
      setSearching(true);

      try {
        const nextOptions = await searchLyricOptions(searchKey);
        if (cancelled) {
          return;
        }

        setOptions(nextOptions);

        if (currentEntry?.songMid) {
          setSelectedSongMid(currentEntry.songMid);
        }

        if (!nextOptions.length && !currentEntry?.rawLyric) {
          setMessage("无法找到歌词");
          return;
        }

        const preferredOption =
          (currentEntry?.songMid
            ? nextOptions.find((option) => option.songMid === currentEntry.songMid)
            : undefined) ?? nextOptions[0];

        if (autoApplyAllowed && !currentEntry?.rawLyric && preferredOption) {
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
  }, [track?.id, searchKey, searchNonce, autoApplyAllowed]);

  const parsedLyrics = useMemo(() => parseLyrics(rawLyrics), [rawLyrics]);
  const offsetMs = lyricsEntry?.offsetMs ?? 0;
  const effectiveCurrentTime = useMemo(() => {
    const baseTime =
      progress.isRunning && progress.timerFrom
        ? Math.max(0, (followTick - progress.timerFrom) / 1000)
        : progress.currentTime;
    return Math.max(0, baseTime + offsetMs / 1000);
  }, [progress.currentTime, progress.isRunning, progress.timerFrom, followTick, offsetMs]);
  const activeIndex = useMemo(
    () => activeLyricLineIndex(parsedLyrics, effectiveCurrentTime),
    [parsedLyrics, effectiveCurrentTime],
  );
  const visibleLines = useMemo(() => {
    if (!parsedLyrics.lines.length) {
      return [] as Array<{ line: (typeof parsedLyrics.lines)[number]; index: number }>;
    }

    if (!parsedLyrics.timed || activeIndex < 0) {
      return parsedLyrics.lines
        .slice(0, 12)
        .map((line, index) => ({ line, index }));
    }

    const start = Math.max(0, activeIndex - 4);
    const end = Math.min(parsedLyrics.lines.length, activeIndex + 5);
    return parsedLyrics.lines
      .slice(start, end)
      .map((line, offset) => ({ line, index: start + offset }));
  }, [parsedLyrics, activeIndex]);

  async function applyOnlineLyrics(option: LyricSearchOption, auto = false) {
    if (!track) {
      return;
    }

    setBusy(true);

    try {
      const nextLyrics = await fetchLyricBySongMid(option.songMid);
      const nextEntry: TrackLyricsEntry = {
        rawLyric: nextLyrics,
        songMid: option.songMid,
        selectedLabel: option.label,
        searchKey,
        offsetMs: lyricsEntry?.offsetMs ?? 0,
        sourceKind: auto ? "qq-auto" : "qq-manual",
        updatedAt: new Date().toISOString(),
      };

      saveTrackLyricsEntry(trackStorageInput(track), nextEntry);
      setLyricsEntry(nextEntry);
      setRawLyrics(nextLyrics);
      setSelectedSongMid(option.songMid);
      setAutoApplyAllowed(false);
      setMessage(auto ? `已自动匹配 ${option.label}` : `已切换到 ${option.label}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function importLyricsFile() {
    if (!track) {
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
        searchKey,
        offsetMs: lyricsEntry?.offsetMs ?? 0,
        sourceKind: "local",
        updatedAt: new Date().toISOString(),
      };
      saveTrackLyricsEntry(trackStorageInput(track), nextEntry);
      setLyricsEntry(nextEntry);
      setRawLyrics(nextLyrics);
      setSelectedSongMid("");
      setAutoApplyAllowed(false);
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
    if (!track) {
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

    clearTrackLyrics(trackStorageInput(track));
    setLyricsEntry(null);
    setRawLyrics("");
    setSelectedSongMid("");
    setAutoApplyAllowed(false);
    setMessage("歌词已清除");
    setSearchNonce((current) => current + 1);
  }

  function adjustOffset(deltaMs: number) {
    if (!track) {
      return;
    }

    const nextEntry = setTrackLyricOffset(
      trackStorageInput(track),
      (lyricsEntry?.offsetMs ?? 0) + deltaMs,
    );

    if (!nextEntry) {
      return;
    }

    setLyricsEntry(nextEntry);
    setMessage(`歌词偏移已调整到 ${nextEntry.offsetMs ?? 0}ms`);
  }

  const lyricStatus = parsedLyrics.lines.length
    ? lyricsEntry?.songMid
      ? "在线歌词"
      : "本地歌词"
    : "还没有歌词";
  const focusedLyric = activeIndex >= 0 ? parsedLyrics.lines[activeIndex] ?? null : null;
  const previousLines =
    activeIndex >= 0
      ? visibleLines.filter(({ index }) => index < activeIndex)
      : visibleLines.slice(0, Math.max(0, visibleLines.length - 1));
  const nextLines =
    activeIndex >= 0
      ? visibleLines.filter(({ index }) => index > activeIndex)
      : [];

  return (
    <List
      navigationTitle={"歌词"}
      navigationBarTitleDisplayMode={"inline"}
      listStyle={"plain"}
    >
      <Section header={<Text font={"caption"}>当前歌曲</Text>}>
        <VStack alignment={"leading"} spacing={8}>
          <Text font={"title3"}>
            {track ? displayTrackTitle(track) : "还没有正在播放的歌曲"}
          </Text>
          <Text font={"subheadline"} foregroundColor={"secondary"}>
            {track?.artist || "Azusa"}
          </Text>
          {track ? <PlaybackProgressView progress={progress} /> : null}
          <HStack spacing={8}>
            <Text font={"caption"} foregroundColor={"secondary"}>
              {track ? `播放时间 ${formatTime(effectiveCurrentTime)}` : "请先播放一首歌"}
            </Text>
            <Spacer />
            <Text font={"caption"} foregroundColor={"secondary"}>
              偏移 {offsetMs}ms
            </Text>
          </HStack>
        </VStack>
      </Section>

      <Section header={<Text font={"caption"}>搜索歌词</Text>}>
        <VStack alignment={"leading"} spacing={10}>
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
                setAutoApplyAllowed(false);
                setSearchNonce((current) => current + 1);
              }}
            />
            <Button
              title={busy ? "处理中..." : "导入 LRC / TXT"}
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
        </VStack>
      </Section>

      <Section header={<Text font={"caption"}>歌词偏移</Text>}>
        <VStack alignment={"leading"} spacing={10}>
          <HStack spacing={10}>
            <Button
              title="-50ms"
              buttonStyle="bordered"
              action={() => adjustOffset(-50)}
            />
            <Button
              title="归零"
              buttonStyle="bordered"
              action={() => adjustOffset(-(lyricsEntry?.offsetMs ?? 0))}
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
      </Section>

      <Section header={<Text font={"caption"}>当前歌词</Text>}>
        {!track ? (
          <Text foregroundColor={"secondary"}>
            先开始播放，再进入歌词页。
          </Text>
        ) : !parsedLyrics.lines.length ? (
          <VStack alignment={"leading"} spacing={4}>
            <Text font={"body"}>这首歌还没有歌词。</Text>
            <Text font={"caption"} foregroundColor={"secondary"}>
              现在会自动搜索 QQ 候选，也支持手动导入本地 `.lrc` / `.txt`。
            </Text>
          </VStack>
        ) : (
          <VStack
            alignment={"center"}
            spacing={10}
            padding={{ vertical: 8 }}
            listRowSeparator="hidden">
            {previousLines.map(({ line }) => (
              <Text
                key={line.id}
                font={"body"}
                foregroundColor={"secondary"}>
                {line.text}
              </Text>
            ))}
            <Text font={"caption"} foregroundColor={"secondary"}>
              {lyricStatus}
              {lyricsEntry?.selectedLabel ? ` · ${lyricsEntry.selectedLabel}` : ""}
              {lyricsEntry?.sourceKind ? ` · ${lyricsEntry.sourceKind}` : ""}
            </Text>
            <Text
              font={"largeTitle"}
              multilineTextAlignment={"center"}
              foregroundColor={"systemBlue"}>
              {focusedLyric?.text || visibleLines[0]?.line.text || "…"}
            </Text>
            {focusedLyric?.timeSeconds != null ? (
              <Text font={"caption"} foregroundColor={"secondary"}>
                {formatTime(focusedLyric.timeSeconds)}
              </Text>
            ) : null}
            {nextLines.map(({ line }) => (
              <Text
                key={line.id}
                font={"body"}
                foregroundColor={"secondary"}>
                {line.text}
              </Text>
            ))}
          </VStack>
        )}
      </Section>

      {message ? (
        <Section header={<Text font={"caption"}>状态</Text>}>
          <Text font={"caption"} foregroundColor={"secondary"}>
            {message}
          </Text>
        </Section>
      ) : null}

      {track ? (
        <Section header={<Text font={"caption"}>歌词候选</Text>}>
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
        </Section>
      ) : null}

      {parsedLyrics.lines.length ? (
        <Section header={<Text font={"caption"}>全部歌词片段</Text>}>
          {visibleLines.map(({ line, index }) => {
            const isActive = activeIndex === index;
            return (
              <VStack
                alignment={"leading"}
                spacing={3}
                key={line.id}>
                {parsedLyrics.timed && typeof line.timeSeconds === "number" ? (
                  <Text
                    font={"caption"}
                    foregroundColor={isActive ? "systemBlue" : "secondary"}>
                    {formatTime(line.timeSeconds)}
                  </Text>
                ) : null}
                <Text
                  font={isActive ? "headline" : "body"}
                  foregroundColor={isActive ? "systemBlue" : undefined}>
                  {line.text}
                </Text>
              </VStack>
            );
          })}
        </Section>
      ) : null}
    </List>
  );
}
