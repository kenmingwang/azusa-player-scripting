import {
  Button,
  Dialog,
  DocumentPicker,
  FileManager,
  List,
  Section,
  Text,
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
} from "./storage";
import type { LyricSearchOption, Track, TrackLyricsEntry } from "./types";

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
  const [progress, setProgress] = useState(player.getProgressSnapshot());
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

  useEffect(() => {
    return player.subscribeProgress((snapshot) => {
      setProgress(snapshot);
    });
  }, []);

  useEffect(() => {
    if (!track) {
      setLyricsEntry(null);
      setRawLyrics("");
      setOptions([]);
      setSelectedSongMid("");
      setMessage("");
      setAutoApplyAllowed(true);
      return;
    }

    const nextEntry = loadTrackLyricsEntry(trackStorageInput(track));
    setLyricsEntry(nextEntry);
    setRawLyrics(nextEntry?.rawLyric ?? "");
    setOptions([]);
    setSelectedSongMid(nextEntry?.songMid ?? "");
    setMessage("");
    setAutoApplyAllowed(!nextEntry?.rawLyric);
  }, [track?.id]);

  const searchKey = useMemo(
    () => lyricsEntry?.searchKey ?? defaultSearchKey(track),
    [lyricsEntry?.searchKey, track?.id],
  );

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
  const activeIndex = useMemo(
    () => activeLyricLineIndex(parsedLyrics, progress.currentTime),
    [parsedLyrics, progress.currentTime],
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

    const start = Math.max(0, activeIndex - 2);
    const end = Math.min(parsedLyrics.lines.length, activeIndex + 3);
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

  const lyricStatus = parsedLyrics.lines.length
    ? lyricsEntry?.songMid
      ? "在线歌词"
      : "本地歌词"
    : "还没有歌词";

  return (
    <List
      navigationTitle={"歌词"}
      navigationBarTitleDisplayMode={"inline"}
      listStyle={"plain"}
    >
      <Section header={<Text font={"caption"}>当前歌曲</Text>}>
        <VStack alignment={"leading"} spacing={4}>
          <Text font={"title3"}>
            {track ? displayTrackTitle(track) : "还没有正在播放的歌曲"}
          </Text>
          <Text font={"subheadline"} foregroundColor={"secondary"}>
            {track?.artist || "Azusa"}
          </Text>
          <Text font={"caption"} foregroundColor={"secondary"}>
            {track ? `播放时间 ${formatTime(progress.currentTime)}` : "请先播放一首歌"}
          </Text>
          <Text font={"caption"} foregroundColor={"secondary"}>
            搜词关键字: {searchKey || "未识别"}
          </Text>
        </VStack>
      </Section>

      <Section header={<Text font={"caption"}>歌词管理</Text>}>
        <Button
          title={busy ? "处理中..." : "导入 LRC / TXT 文件"}
          buttonStyle="borderedProminent"
          action={() => void importLyricsFile()}
        />
        <Button
          title={searching ? "搜索中..." : "重新搜索 QQ 歌词"}
          buttonStyle="bordered"
          action={() => setSearchNonce((current) => current + 1)}
        />
        {rawLyrics ? (
          <Button
            title="清除当前歌词"
            buttonStyle="bordered"
            action={() => void clearLyrics()}
          />
        ) : null}
        <Text font={"caption"} foregroundColor={"secondary"}>
          当前状态: {lyricStatus}
          {lyricsEntry?.selectedLabel ? ` · ${lyricsEntry.selectedLabel}` : ""}
        </Text>
        {message ? (
          <Text font={"caption"} foregroundColor={"secondary"}>
            {message}
          </Text>
        ) : null}
      </Section>

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

      <Section header={<Text font={"caption"}>歌词内容</Text>}>
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
          visibleLines.map(({ line, index }) => {
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
                  font={isActive ? "title3" : "body"}
                  foregroundColor={isActive ? "systemBlue" : undefined}>
                  {line.text}
                </Text>
              </VStack>
            );
          })
        )}
      </Section>
    </List>
  );
}
