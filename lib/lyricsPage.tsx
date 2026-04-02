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
import { getSharedPlayer } from "./player";
import { clearTrackLyrics, loadTrackLyrics, saveTrackLyrics } from "./storage";
import type { Track } from "./types";

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

export function LyricsPage(props: LyricsPageProps) {
  const track = props.track;
  const player = getSharedPlayer();
  const [rawLyrics, setRawLyrics] = useState(
    track
      ? loadTrackLyrics({
          id: track.id,
          title: track.title,
          artist: track.artist,
        })
      : "",
  );
  const [currentTime, setCurrentTime] = useState(player.getCurrentTime());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!track) {
      setRawLyrics("");
      return;
    }

    setRawLyrics(
      loadTrackLyrics({
        id: track.id,
        title: track.title,
        artist: track.artist,
      }),
    );
    setMessage("");
  }, [track?.id]);

  useEffect(() => {
    if (!setIntervalApi) {
      return;
    }

    const timer = setIntervalApi(() => {
      setCurrentTime(player.getCurrentTime());
    }, 450) as unknown as number;

    return () => {
      if (clearIntervalApi) {
        clearIntervalApi(timer);
      }
    };
  }, []);

  const parsedLyrics = useMemo(() => parseLyrics(rawLyrics), [rawLyrics]);
  const activeIndex = useMemo(
    () => activeLyricLineIndex(parsedLyrics, currentTime),
    [parsedLyrics, currentTime],
  );

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
      saveTrackLyrics(
        {
          id: track.id,
          title: track.title,
          artist: track.artist,
        },
        nextLyrics,
      );
      setRawLyrics(nextLyrics);
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

    clearTrackLyrics({
      id: track.id,
      title: track.title,
      artist: track.artist,
    });
    setRawLyrics("");
    setMessage("歌词已清除");
  }

  return (
    <List
      navigationTitle={"歌词"}
      navigationBarTitleDisplayMode={"inline"}
      listStyle={"plain"}
    >
      <Section header={<Text font={"caption"}>当前歌曲</Text>}>
        <VStack alignment={"leading"} spacing={4}>
          <Text font={"title3"}>{track?.title || "还没有正在播放的歌曲"}</Text>
          <Text font={"subheadline"} foregroundColor={"secondary"}>
            {track?.artist || "Azusa"}
          </Text>
          <Text font={"caption"} foregroundColor={"secondary"}>
            {track ? `播放时间 ${formatTime(currentTime)}` : "请先播放一首歌"}
          </Text>
        </VStack>
      </Section>

      <Section header={<Text font={"caption"}>歌词管理</Text>}>
        <Button
          title={busy ? "导入中..." : "导入 LRC / TXT 文件"}
          buttonStyle="borderedProminent"
          action={() => void importLyricsFile()}
        />
        {rawLyrics ? (
          <Button
            title="清除当前歌词"
            buttonStyle="bordered"
            action={() => void clearLyrics()}
          />
        ) : null}
        {message ? (
          <Text font={"caption"} foregroundColor={"secondary"}>
            {message}
          </Text>
        ) : null}
      </Section>

      <Section header={<Text font={"caption"}>歌词内容</Text>}>
        {!track ? (
          <Text foregroundColor={"secondary"}>
            先开始播放，再进入歌词页。
          </Text>
        ) : !parsedLyrics.lines.length ? (
          <VStack alignment={"leading"} spacing={4}>
            <Text font={"body"}>这首歌还没有歌词。</Text>
            <Text font={"caption"} foregroundColor={"secondary"}>
              现在支持导入本地 `.lrc` 或 `.txt` 文件，后面再接自动搜词。
            </Text>
          </VStack>
        ) : (
          parsedLyrics.lines.map((line, index) => {
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
