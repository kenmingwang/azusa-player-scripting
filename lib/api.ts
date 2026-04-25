import { attachDownloadedPaths } from "./storage";
import { parseSourceInput } from "./sources";
import type { ImportResult, SourceDescriptor, Track } from "./types";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const VIDEO_INFO_URL =
  "https://api.bilibili.com/x/web-interface/view?bvid={bvid}";
const PLAY_URL =
  "https://api.bilibili.com/x/player/playurl?cid={cid}&bvid={bvid}&qn=64&fnval=16";
const FAVORITE_URL =
  "https://api.bilibili.com/x/v3/fav/resource/list?media_id={mediaId}&pn={page}&ps={pageSize}&platform=web";
const SERIES_URL =
  "https://api.bilibili.com/x/series/archives?mid={mid}&series_id={id}&only_normal=true&sort=desc&pn={page}&ps={pageSize}";
const SEASON_URL =
  "https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?mid={mid}&season_id={id}&page_num={page}&page_size={pageSize}";
const CHANNEL_URL =
  "https://api.bilibili.com/x/space/arc/search?mid={mid}&pn={page}&ps={pageSize}&order=pubdate&jsonp=jsonp";

type VideoInfoData = {
  bvid: string;
  title: string;
  pic?: string;
  owner: {
    name: string;
  };
  pages: Array<{
    cid: number;
    part: string;
  }>;
};

type VideoInfoResponse = {
  code: number;
  message?: string;
  data?: VideoInfoData;
};

type FavoriteResponse = {
  code: number;
  message?: string;
  data?: {
    info?: {
      title?: string;
      cover?: string;
      upper?: {
        name?: string;
      };
      media_count?: number;
    };
    medias?: Array<{
      bvid?: string;
      bv_id?: string;
    }>;
    has_more?: boolean;
  };
};

type SeriesResponse = {
  code: number;
  message?: string;
  data?: {
    meta?: {
      name?: string;
      mid?: number;
      cover?: string;
      upper?: {
        name?: string;
      };
    };
    archives?: Array<{
      bvid?: string;
      pic?: string;
      title?: string;
    }> | null;
    page?: {
      num?: number;
      size?: number;
      total?: number;
    };
  };
};

type SeasonResponse = {
  code: number;
  message?: string;
  data?: {
    meta?: {
      name?: string;
      mid?: number;
      cover?: string;
      upper?: {
        name?: string;
      };
    };
    archives?: Array<{
      bvid?: string;
      pic?: string;
      title?: string;
    }> | null;
  };
};

type ChannelResponse = {
  code: number;
  message?: string;
  data?: {
    page?: {
      count?: number;
      pn?: number;
      ps?: number;
    };
    list?: {
      vlist?: Array<{
        bvid?: string;
        title?: string;
        pic?: string;
        author?: string;
      }>;
    };
  };
};

type PlayUrlResponse = {
  code: number;
  message?: string;
  data?: {
    timelength?: number;
    dash?: {
      audio?: Array<{
        id?: number;
        bandwidth?: number;
        baseUrl?: string;
        backupUrl?: string[];
        mimeType?: string;
        codecs?: string;
      }>;
    };
    durl?: Array<{
      url: string;
    }>;
  };
};

function normalizeHttps(url?: string) {
  if (!url) return "";
  return url.replace(/^http:\/\//i, "https://");
}

function replaceUrlTokens(
  template: string,
  tokens: Record<string, string | number>,
) {
  let next = template;
  for (const [key, value] of Object.entries(tokens)) {
    next = next.replace(`{${key}}`, encodeURIComponent(String(value)));
  }
  return next;
}

async function fetchJson<T>(url: string, debugLabel: string): Promise<T> {
  const response = await fetch(url, {
    headers: requestHeaders(url, {
      Accept: "application/json,text/plain,*/*",
    }),
    timeout: 15,
    debugLabel,
  } as any);

  if (!response.ok) {
    throw new Error(`${debugLabel} failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

function scoreAudio(
  audio: NonNullable<PlayUrlResponse["data"]>["dash"]["audio"][number],
) {
  const codec = (audio.codecs ?? "").toLowerCase();
  const mimeType = (audio.mimeType ?? "").toLowerCase();
  const bandwidth = audio.bandwidth ?? 999999;
  const distanceFromSweetSpot = Math.abs(bandwidth - 132000);

  let score = 0;
  if (codec.includes("mp4a")) score += 120;
  if (mimeType.includes("audio/mp4")) score += 40;
  score -= Math.floor(distanceFromSweetSpot / 2000);
  return score;
}

function scoreStreamHost(url?: string) {
  if (!url) {
    return -999;
  }

  try {
    const host = new URL(url).hostname.toLowerCase();

    if (host.includes("mirrorcosov")) {
      return -260;
    }

    if (
      host.endsWith("bilivideo.com") ||
      host.endsWith("bilivideo.cn") ||
      host.endsWith("hdslb.com")
    ) {
      return 80;
    }

    return 0;
  } catch {
    return 0;
  }
}

function buildAudioCandidateUrls(
  audios: NonNullable<PlayUrlResponse["data"]>["dash"]["audio"] = [],
) {
  if (!audios.length) {
    return [] as string[];
  }

  const entries = audios.flatMap((audio, audioIndex) => {
    const audioQualityScore = scoreAudio(audio);
    const urls = [audio.baseUrl, ...(audio.backupUrl ?? [])]
      .map(normalizeHttps)
      .filter(Boolean);

    return urls.map((url, urlIndex) => ({
      url,
      audioQualityScore,
      hostScore: scoreStreamHost(url),
      audioIndex,
      baseUrlScore: urlIndex === 0 ? 180 : 0,
      urlIndex,
    }));
  });

  return uniq(
    entries
      .sort((left, right) => {
        const scoreDelta =
          right.audioQualityScore + right.hostScore + right.baseUrlScore -
          (left.audioQualityScore + left.hostScore + left.baseUrlScore);
        if (scoreDelta !== 0) {
          return scoreDelta;
        }

        if (left.audioIndex !== right.audioIndex) {
          return left.audioIndex - right.audioIndex;
        }

        return left.urlIndex - right.urlIndex;
      })
      .map((entry) => entry.url),
  );
}

function uniq(items: Array<string | null | undefined>) {
  return [...new Set(items.filter(Boolean) as string[])];
}

function buildTrackTitle(
  videoTitle: string,
  partTitle: string,
  totalPages: number,
) {
  if (totalPages <= 1) {
    return videoTitle;
  }

  const normalizedPart = partTitle.trim();
  if (!normalizedPart || normalizedPart === videoTitle) {
    return videoTitle;
  }

  return `${videoTitle} · ${normalizedPart}`;
}

function buildTracksFromVideoData(
  data: VideoInfoData,
  sourceTitleOverride?: string,
) {
  const sourceTitle = sourceTitleOverride || data.title;
  const cover = normalizeHttps(data.pic);
  return data.pages.map((page) => ({
    id: `${data.bvid}:${page.cid}`,
    bvid: data.bvid,
    cid: String(page.cid),
    title: buildTrackTitle(data.title, page.part || data.title, data.pages.length),
    artist: data.owner.name,
    sourceTitle,
    cover,
  }));
}

async function fetchVideoInfo(bvid: string) {
  const response = await fetchJson<VideoInfoResponse>(
    replaceUrlTokens(VIDEO_INFO_URL, { bvid }),
    `VideoInfo ${bvid}`,
  );

  if (response.code !== 0 || !response.data) {
    throw new Error(response.message || "Bilibili 视频信息获取失败");
  }

  return response.data;
}

async function fetchPlaylistTracks(
  bvids: string[],
  sourceTitle: string,
): Promise<Track[]> {
  const uniqueBvids = uniq(bvids);
  if (!uniqueBvids.length) {
    return [];
  }

  const results: Track[][] = new Array(uniqueBvids.length);
  let nextIndex = 0;
  const concurrency = Math.min(3, uniqueBvids.length);

  async function worker() {
    while (nextIndex < uniqueBvids.length) {
      const currentIndex = nextIndex++;
      const bvid = uniqueBvids[currentIndex];

      try {
        const video = await fetchVideoInfo(bvid);
        results[currentIndex] = buildTracksFromVideoData(video, sourceTitle);
      } catch {
        results[currentIndex] = [];
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return attachDownloadedPaths(results.flat());
}

async function importVideoSource(source: SourceDescriptor): Promise<ImportResult> {
  const responseData = await fetchVideoInfo((source as any).bvid);
  const sourceTitle = responseData.title;
  const ownerName = responseData.owner.name;

  return {
    source: {
      ...source,
      titleHint: sourceTitle,
    },
    sourceTitle,
    ownerName,
    cover: normalizeHttps(responseData.pic),
    tracks: attachDownloadedPaths(buildTracksFromVideoData(responseData)),
  };
}

async function importFavoriteSource(source: SourceDescriptor): Promise<ImportResult> {
  const mediaId = (source as any).mediaId;
  const bvids: string[] = [];
  let page = 1;
  let infoTitle = source.titleHint || `收藏夹 ${mediaId}`;
  let ownerName = "";
  let cover = "";

  while (page <= 10) {
    const response = await fetchJson<FavoriteResponse>(
      replaceUrlTokens(FAVORITE_URL, {
        mediaId,
        page,
        pageSize: 20,
      }),
      `Favorite ${mediaId}#${page}`,
    );

    if (response.code !== 0 || !response.data) {
      throw new Error(response.message || "收藏夹获取失败");
    }

    infoTitle = response.data.info?.title || infoTitle;
    ownerName = response.data.info?.upper?.name || ownerName;
    cover = normalizeHttps(response.data.info?.cover) || cover;
    const medias = response.data.medias ?? [];
    bvids.push(...medias.map((item) => item.bvid || item.bv_id || "").filter(Boolean));

    if (!response.data.has_more || !medias.length) {
      break;
    }

    page += 1;
  }

  const tracks = await fetchPlaylistTracks(bvids, infoTitle);
  if (!tracks.length) {
    throw new Error("收藏夹里还没有拿到可播放的视频");
  }

  return {
    source: {
      ...source,
      titleHint: infoTitle,
    },
    sourceTitle: infoTitle,
    ownerName: ownerName || "Bilibili 收藏夹",
    cover: cover || tracks[0]?.cover,
    tracks,
  };
}

async function importCollectionSource(
  source: SourceDescriptor,
): Promise<ImportResult> {
  const collectionSource = source as any;
  const bvids: string[] = [];
  let page = 1;
  let sourceTitle =
    collectionSource.titleHint ||
    `${collectionSource.collectionKind === "season" ? "合集" : "系列"} ${collectionSource.collectionId}`;
  let ownerName = "";
  let cover = "";

  while (page <= 10) {
    const response =
      collectionSource.collectionKind === "season"
        ? await fetchJson<SeasonResponse>(
            replaceUrlTokens(SEASON_URL, {
              mid: collectionSource.ownerMid,
              id: collectionSource.collectionId,
              page,
              pageSize: 20,
            }),
            `Season ${collectionSource.collectionId}#${page}`,
          )
        : await fetchJson<SeriesResponse>(
            replaceUrlTokens(SERIES_URL, {
              mid: collectionSource.ownerMid,
              id: collectionSource.collectionId,
              page,
              pageSize: 20,
            }),
            `Series ${collectionSource.collectionId}#${page}`,
          );

    if (response.code !== 0 || !response.data) {
      throw new Error(response.message || "合集获取失败");
    }

    const archives = response.data.archives ?? [];
    sourceTitle = response.data.meta?.name || sourceTitle;
    ownerName = response.data.meta?.upper?.name || ownerName;
    cover = normalizeHttps(response.data.meta?.cover) || cover;
    bvids.push(...archives.map((item) => item.bvid || "").filter(Boolean));

    if (!archives.length || archives.length < 20) {
      break;
    }

    page += 1;
  }

  const tracks = await fetchPlaylistTracks(bvids, sourceTitle);
  if (!tracks.length) {
    throw new Error("这个合集里暂时没有拿到可播放的视频");
  }

  return {
    source: {
      ...source,
      titleHint: sourceTitle,
    },
    sourceTitle,
    ownerName: ownerName || `UP ${collectionSource.ownerMid}`,
    cover: cover || tracks[0]?.cover,
    tracks,
  };
}

async function importChannelSource(source: SourceDescriptor): Promise<ImportResult> {
  const ownerMid = (source as any).ownerMid;
  const bvids: string[] = [];
  let page = 1;
  let sourceTitle = source.titleHint || `频道 ${ownerMid}`;
  let ownerName = `UP ${ownerMid}`;

  while (page <= 5) {
    const response = await fetchJson<ChannelResponse>(
      replaceUrlTokens(CHANNEL_URL, {
        mid: ownerMid,
        page,
        pageSize: 20,
      }),
      `Channel ${ownerMid}#${page}`,
    );

    if (response.code === -799) {
      throw new Error("Bilibili 频道接口暂时限流了，请稍后再试");
    }

    if (response.code !== 0 || !response.data) {
      throw new Error(response.message || "频道获取失败");
    }

    const videos = response.data.list?.vlist ?? [];
    if (videos[0]?.author) {
      ownerName = videos[0].author;
      sourceTitle = `${ownerName} 的频道`;
    }

    bvids.push(...videos.map((item) => item.bvid || "").filter(Boolean));

    if (!videos.length || videos.length < 20) {
      break;
    }

    page += 1;
  }

  const tracks = await fetchPlaylistTracks(bvids, sourceTitle);
  if (!tracks.length) {
    throw new Error("这个频道里还没有拿到可播放的视频");
  }

  return {
    source: {
      ...source,
      titleHint: sourceTitle,
    },
    sourceTitle,
    ownerName,
    cover: tracks[0]?.cover,
    tracks,
  };
}

export async function importFromSource(
  source: SourceDescriptor,
): Promise<ImportResult> {
  switch (source.kind) {
    case "video":
      return importVideoSource(source);
    case "favorite":
      return importFavoriteSource(source);
    case "collection":
      return importCollectionSource(source);
    case "channel":
      return importChannelSource(source);
    default:
      throw new Error("暂不支持这个来源类型");
  }
}

export async function importFromInput(input: string): Promise<ImportResult> {
  const source = parseSourceInput(input);
  if (!source) {
    throw new Error(
      "请输入 BV / 视频链接，或使用 favorite:mediaId、season:mid:id、series:mid:id、channel:mid 这类来源格式",
    );
  }

  return importFromSource(source);
}

export async function resolveTrackStream(track: Track): Promise<Track> {
  if (track.streamUrl || track.localFilePath) {
    return track;
  }

  const response = await fetchJson<PlayUrlResponse>(
    replaceUrlTokens(PLAY_URL, { cid: track.cid, bvid: track.bvid }),
    `PlayUrl ${track.bvid}/${track.cid}`,
  );

  if (response.code !== 0 || !response.data) {
    throw new Error(response.message || "播放地址获取失败");
  }

  const dashCandidates = buildAudioCandidateUrls(response.data.dash?.audio);
  const progressiveCandidates = uniq(
    (response.data.durl ?? []).map((item) => normalizeHttps(item.url)),
  );
  const streamCandidates = uniq([...dashCandidates, ...progressiveCandidates]);
  const streamUrl = streamCandidates[0];
  const backupStreamUrls = streamCandidates.slice(1);

  if (!streamUrl) {
    throw new Error("没有可用的音频流");
  }

  return {
    ...track,
    streamUrl,
    backupStreamUrls,
    durationSeconds: response.data.timelength
      ? Math.floor(response.data.timelength / 1000)
      : undefined,
  };
}

function refererForUrl(rawUrl?: string) {
  if (!rawUrl) {
    return undefined;
  }

  try {
    const target = new URL(rawUrl);
    const host = target.hostname.toLowerCase();

    if (host.endsWith("qq.com")) {
      return "https://y.qq.com/";
    }

    if (
      host.endsWith("bilibili.com") ||
      host.endsWith("bilivideo.com") ||
      host.endsWith("bilivideo.cn") ||
      host.endsWith("hdslb.com") ||
      host.endsWith("akamaized.net")
    ) {
      return "https://www.bilibili.com/";
    }
  } catch {}

  return undefined;
}

export function requestHeaders(
  rawUrl?: string,
  extraHeaders: Record<string, string | undefined> = {},
) {
  const headers: Record<string, string> = {
    Accept: "*/*",
    "User-Agent": DEFAULT_USER_AGENT,
    "Accept-Language": "zh-CN,zh-Hans;q=0.9,en-SG;q=0.8,en;q=0.7",
  };

  const referer = refererForUrl(rawUrl);
  if (referer) {
    headers.Referer = referer;
  }

  try {
    const target = rawUrl ? new URL(rawUrl) : null;
    const host = target?.hostname?.toLowerCase() ?? "";
    if (host.endsWith("qq.com")) {
      headers.Origin = "https://y.qq.com";
    }
  } catch {}

  for (const [key, value] of Object.entries(extraHeaders)) {
    if (value) {
      headers[key] = value;
    }
  }

  return headers;
}
