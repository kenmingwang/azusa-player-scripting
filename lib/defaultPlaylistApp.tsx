import {
  Button,
  Form,
  Section,
  Text,
  useEffect,
  useState,
  VStack,
} from "scripting";

type PlaylistTrack = {
  id: string;
  cid: string;
  title: string;
};

type VideoInfoResponse = {
  code: number;
  message?: string;
  data?: {
    bvid: string;
    title: string;
    owner: {
      name: string;
    };
    pages: Array<{
      cid: number;
      part: string;
    }>;
  };
};

const DEFAULT_BVID = "BV1wr4y1v7TA";
const VIDEO_INFO_URL =
  "https://api.bilibili.com/x/web-interface/view?bvid={bvid}";

const BILI_HEADERS = {
  Referer: "https://www.bilibili.com/",
  Origin: "https://www.bilibili.com",
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  Accept: "application/json,text/plain,*/*",
};

async function fetchDefaultPlaylist() {
  const response = await fetch(
    VIDEO_INFO_URL.replace("{bvid}", DEFAULT_BVID),
    { headers: BILI_HEADERS } as any,
  );

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`);
  }

  const json = (await response.json()) as VideoInfoResponse;
  if (json.code !== 0 || !json.data) {
    throw new Error(json.message || "Bilibili 返回异常");
  }

  return {
    sourceTitle: json.data.title,
    ownerName: json.data.owner.name,
    tracks: json.data.pages.map((page, index) => ({
      id: `${json.data!.bvid}:${page.cid}`,
      cid: String(page.cid),
      title: page.part || `P${index + 1}`,
    })),
  };
}

export function DefaultPlaylistApp() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null as string | null);
  const [sourceTitle, setSourceTitle] = useState("Azusa 默认歌单");
  const [ownerName, setOwnerName] = useState("");
  const [tracks, setTracks] = useState([] as PlaylistTrack[]);

  async function loadPlaylist() {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchDefaultPlaylist();
      setSourceTitle(result.sourceTitle);
      setOwnerName(result.ownerName);
      setTracks(result.tracks);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPlaylist();
  }, []);

  return (
    <Form formStyle="grouped">
      <Section
        header={<Text>默认歌单</Text>}
        footer={
          <VStack alignment="leading">
            <Text>BVID: {DEFAULT_BVID}</Text>
            <Text>{loading ? "正在获取歌单..." : `共 ${tracks.length} 首`}</Text>
            {error ? <Text>错误: {error}</Text> : null}
          </VStack>
        }
      >
        <Text>{sourceTitle}</Text>
        <Text>{ownerName ? `UP: ${ownerName}` : "UP 信息加载中"}</Text>
        <Button
          title={loading ? "加载中..." : "重新获取默认歌单"}
          buttonStyle="borderedProminent"
          action={() => void loadPlaylist()}
        />
      </Section>

      <Section header={<Text>歌曲列表</Text>}>
        {tracks.length === 0 ? (
          <Text>{loading ? "列表加载中..." : "还没有拿到歌单数据"}</Text>
        ) : (
          tracks.map((track: PlaylistTrack, index: number) => (
            <VStack alignment="leading" key={track.id}>
              <Text>{index + 1}. {track.title}</Text>
              <Text>CID: {track.cid}</Text>
            </VStack>
          ))
        )}
      </Section>
    </Form>
  );
}
