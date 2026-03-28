import {
  Button,
  Form,
  Section,
  Text,
  useEffect,
  useState,
  VStack,
} from "scripting";

import { importFromInput } from "./api";
import {
  getNativePlayerCompatibilityMessage,
  getSharedPlayer,
} from "./player";
import type { PlaybackUiState, Track } from "./types";

const DEFAULT_BVID = "BV1wr4y1v7TA";

type DefaultPlaylistAppProps = {
  initialInput?: string;
};

function describeState(state: PlaybackUiState, detail?: string) {
  if (detail) return `${state}: ${detail}`;

  switch (state) {
    case "idle":
      return "idle: 还没开始播放";
    case "loading":
      return "loading: 正在准备音频流";
    case "playing":
      return "playing: 正在播放";
    case "paused":
      return "paused: 已暂停";
    case "error":
      return "error: 播放失败";
    default:
      return state;
  }
}

export function DefaultPlaylistApp(props: DefaultPlaylistAppProps) {
  const player = getSharedPlayer();
  const requestedInput = props.initialInput?.trim();
  const effectiveInput = requestedInput || DEFAULT_BVID;

  const [loading, setLoading] = useState(false);
  const [playLoading, setPlayLoading] = useState(false);
  const [error, setError] = useState(null as string | null);
  const [sourceTitle, setSourceTitle] = useState("Azusa 默认歌单");
  const [ownerName, setOwnerName] = useState("");
  const [tracks, setTracks] = useState([] as Track[]);
  const [playbackState, setPlaybackState] = useState("idle" as PlaybackUiState);
  const [playbackDetail, setPlaybackDetail] = useState("");
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [currentTrack, setCurrentTrack] = useState(null as Track | null);
  const [playerMessage] = useState(getNativePlayerCompatibilityMessage());

  async function loadPlaylist() {
    setLoading(true);
    setError(null);

    try {
      const result = await importFromInput(effectiveInput);
      setSourceTitle(result.sourceTitle);
      setOwnerName(result.ownerName);
      setTracks(result.tracks);
      player.setQueue(result.tracks);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      setTracks([]);
      player.setQueue([]);
    } finally {
      setLoading(false);
    }
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
      setError(playError instanceof Error ? playError.message : String(playError));
    } finally {
      setPlayLoading(false);
    }
  }

  function togglePlayback() {
    try {
      player.toggle();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : String(toggleError));
    }
  }

  useEffect(() => {
    player.bind({
      onQueueChange: (queue) => {
        setTracks(queue);
      },
      onCurrentTrackChange: (track, index) => {
        setCurrentTrack(track);
        setCurrentIndex(index);
      },
      onStateChange: (state, detail) => {
        setPlaybackState(state);
        setPlaybackDetail(detail ?? "");
      },
      onError: (message) => {
        setError(message);
      },
    });

    void loadPlaylist();

    return () => {
      player.bind({});
    };
  }, []);

  return (
    <Form formStyle="grouped">
      <Section
        header={<Text>播放测试</Text>}
        footer={
          <VStack alignment="leading">
            <Text>输入源: {requestedInput || DEFAULT_BVID}</Text>
            <Text>{loading ? "正在获取歌单..." : `共 ${tracks.length} 首`}</Text>
            <Text>{describeState(playbackState, playbackDetail)}</Text>
            {playerMessage ? <Text>播放器状态: {playerMessage}</Text> : null}
            {error ? <Text>错误: {error}</Text> : null}
          </VStack>
        }
      >
        <Text>{sourceTitle}</Text>
        <Text>{ownerName ? `UP: ${ownerName}` : "UP 信息加载中"}</Text>
        <Text>{currentTrack ? `当前: ${currentTrack.title}` : "当前: 还没开始播放"}</Text>
        <Button
          title={loading ? "加载中..." : "重新获取歌单"}
          buttonStyle="bordered"
          action={() => void loadPlaylist()}
        />
        <Button
          title={playLoading ? "正在准备..." : "播放第 1 首"}
          buttonStyle="borderedProminent"
          action={() => void playTrackAt(0)}
        />
        <Button
          title={playbackState === "playing" ? "暂停 / 继续" : "尝试继续播放"}
          buttonStyle="bordered"
          action={togglePlayback}
        />
      </Section>

      <Section header={<Text>歌曲列表</Text>}>
        {tracks.length === 0 ? (
          <Text>{loading ? "列表加载中..." : "还没有拿到歌单数据"}</Text>
        ) : (
          tracks.map((track: Track, index: number) => (
            <VStack alignment="leading" key={track.id}>
              <Button
                title={`${currentIndex === index ? "正在播放" : "播放"} ${index + 1}. ${track.title}`}
                buttonStyle={currentIndex === index ? "borderedProminent" : "bordered"}
                action={() => void playTrackAt(index)}
              />
              <Text>CID: {track.cid}</Text>
            </VStack>
          ))
        )}
      </Section>
    </Form>
  );
}
