import type { LyricSearchOption } from "./types";

const QQ_SEARCH_URL =
  "https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?key={keyword}";
const QQ_LYRIC_URL =
  "https://i.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid={songMid}&g_tk=5381&format=json&inCharset=utf8&outCharset=utf-8&nobase64=1";
const QQ_SEARCH_FALLBACK_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg";

const QQ_HEADERS = {
  Referer: "https://y.qq.com/",
  Origin: "https://y.qq.com",
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  Accept: "application/json,text/plain,*/*",
};

type QQSmartboxResponse = {
  data?: {
    song?: {
      itemlist?: Array<{
        mid?: string;
        name?: string;
        singer?: string;
      }>;
    };
  };
};

type QQSearchFallbackResponse = {
  req?: {
    data?: {
      body?: {
        song?: {
          list?: Array<{
            mid?: string;
            name?: string;
            singer?: Array<{
              name?: string;
            }>;
          }>;
        };
      };
    };
  };
};

type QQLyricResponse = {
  lyric?: string;
  trans?: string;
};

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

function normalizeLineBreak(text = "") {
  return String(text).replace(/\r\n/g, "\n");
}

function tryFixMojibake(text = "") {
  const source = String(text);
  if (!/[??D???é]/.test(source)) {
    return source;
  }

  try {
    return decodeURIComponent(escape(source));
  } catch {
    return source;
  }
}

function normalizeLyricText(text = "") {
  return normalizeLineBreak(tryFixMojibake(text));
}

async function fetchJson<T>(url: string, init?: Record<string, unknown>) {
  const response = await fetch(url, {
    timeout: 15,
    ...init,
  } as any);

  if (!response.ok) {
    throw new Error(`歌词请求失败 ${response.status}`);
  }

  return (await response.json()) as T;
}

function optionLabel(name?: string, singer?: string, index = 0) {
  const songName = (name ?? "").trim() || "未知歌曲";
  const artistName = (singer ?? "").trim() || "未知歌手";
  return `${index + 1}. ${songName} / ${artistName}`;
}

function dedupeOptions(options: LyricSearchOption[]) {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (!option.songMid || seen.has(option.songMid)) {
      return false;
    }
    seen.add(option.songMid);
    return true;
  });
}

export function extractSongName(name: string) {
  const source = String(name || "");
  const match = source.match(/《([^》]+)》/);
  if (match?.[1]) {
    return match[1];
  }
  return source.trim();
}

async function searchLyricOptionsFallback(searchKey: string) {
  const body = {
    comm: {
      ct: "19",
      cv: "1859",
      uin: "0",
    },
    req: {
      method: "DoSearchForQQMusicDesktop",
      module: "music.search.SearchCgiService",
      param: {
        grp: 1,
        num_per_page: 20,
        page_num: 1,
        query: searchKey,
        search_type: 0,
      },
    },
  };

  const response = await fetchJson<QQSearchFallbackResponse>(
    QQ_SEARCH_FALLBACK_URL,
    {
      method: "POST",
      headers: {
        ...QQ_HEADERS,
        "Content-Type": "application/json",
        Referer: "https://u.y.qq.com/",
        Origin: "https://u.y.qq.com",
      },
      body: JSON.stringify(body),
    },
  );

  return dedupeOptions(
    (response.req?.data?.body?.song?.list ?? []).map((item, index) => ({
      key: item.mid ?? `${index}`,
      songMid: item.mid ?? "",
      label: optionLabel(item.name, item.singer?.[0]?.name, index),
    })),
  );
}

export async function searchLyricOptions(searchKey: string) {
  const normalizedKey = extractSongName(searchKey).trim();
  if (!normalizedKey) {
    return [] as LyricSearchOption[];
  }

  try {
    const response = await fetchJson<QQSmartboxResponse>(
      replaceUrlTokens(QQ_SEARCH_URL, { keyword: normalizedKey }),
      {
        headers: QQ_HEADERS,
      },
    );

    const options = dedupeOptions(
      (response.data?.song?.itemlist ?? []).map((item, index) => ({
        key: item.mid ?? `${index}`,
        songMid: item.mid ?? "",
        label: optionLabel(item.name, item.singer, index),
      })),
    );

    if (options.length) {
      return options;
    }
  } catch {}

  return searchLyricOptionsFallback(normalizedKey);
}

export async function fetchLyricBySongMid(songMid: string) {
  const response = await fetchJson<QQLyricResponse>(
    replaceUrlTokens(QQ_LYRIC_URL, { songMid }),
    {
      headers: QQ_HEADERS,
    },
  );

  if (!response.lyric) {
    throw new Error("无法找到歌词");
  }

  let finalLyric = normalizeLyricText(response.lyric);
  if (response.trans) {
    finalLyric = `${normalizeLyricText(response.trans)}\n${finalLyric}`;
  }

  return finalLyric;
}
