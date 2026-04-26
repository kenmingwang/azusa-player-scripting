import {
  AVPlayer,
  Button,
  Form,
  Navigation,
  Script,
  Section,
  SharedAudioSession,
  Text,
  TextField,
  VStack,
  useState,
} from "scripting";

import {
  importFromInput,
  requestHeaders,
  resolveTrackStream,
} from "./lib/api";
import type { Track } from "./lib/types";

const DEFAULT_REFERER = "https://www.bilibili.com/";
const REPRO_VERSION = "avplayer-bvid-queue-repro-2026-04-26.4";

const globalRuntime = globalThis as any;
const AVPlayerCtor = (AVPlayer as any) ?? globalRuntime.AVPlayer;
const SharedAudioSessionApi =
  (SharedAudioSession as any) ?? globalRuntime.SharedAudioSession;
const setTimeoutApi =
  typeof globalRuntime.setTimeout === "function"
    ? globalRuntime.setTimeout.bind(globalRuntime)
    : null;
const clearTimeoutApi =
  typeof globalRuntime.clearTimeout === "function"
    ? globalRuntime.clearTimeout.bind(globalRuntime)
    : null;

let player: any | null = null;
let reproQueue: Track[] = [];
let reproIndex = -1;
let runSerial = 0;

function now() {
  return new Date().toLocaleTimeString();
}

function streamHeaders(source: string, referer: string, cookie: string) {
  return requestHeaders(source, {
    Referer: referer || DEFAULT_REFERER,
    Cookie: cookie.trim() || undefined,
    Accept: "*/*",
    "Accept-Encoding": "identity;q=1, *;q=0",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7",
    Range: "bytes=0-",
    Priority: "i",
    "Sec-CH-UA":
      '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
    "Sec-Fetch-Dest": "audio",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Storage-Access": "active",
  });
}

function minimalHeaders(source: string, referer: string, cookie: string) {
  const headers = requestHeaders(source, {
    Referer: referer || DEFAULT_REFERER,
    Cookie: cookie.trim() || undefined,
    Accept: "*/*",
    Range: "bytes=0-",
  });

  return Object.fromEntries(
    Object.entries(headers).filter(([key]) =>
      [
        "accept",
        "cookie",
        "range",
        "referer",
        "user-agent",
      ].includes(key.toLowerCase()),
    ),
  );
}

function badRefererHeaders(source: string, referer: string, cookie: string) {
  return {
    ...streamHeaders(source, referer, cookie),
    Referer: "https://example.com/",
  };
}

function lowerCaseRefererHeaders(source: string, referer: string, cookie: string) {
  const headers = streamHeaders(source, referer, cookie);
  const next: Record<string, string> = {
    ...headers,
    referer: headers.Referer || referer || DEFAULT_REFERER,
  };
  delete next.Referer;
  return next;
}

function headerDump(headers: Record<string, string>) {
  return Object.entries(logHeaders(headers))
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function logHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      key.toLowerCase() === "cookie"
        ? `present len=${value.length} prefix=${value.slice(0, 24)}...`
        : value,
    ]),
  );
}

function sourceCandidates(track: Track) {
  return [
    track.streamUrl,
    ...(track.backupStreamUrls ?? []),
  ].filter(Boolean) as string[];
}

function summarizeUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const fileName = url.pathname.split("/").filter(Boolean).pop() ?? "";
    const params = ["os", "og", "bw", "mid", "deadline"]
      .map((key) => {
        const value = url.searchParams.get(key);
        return value ? `${key}=${value}` : "";
      })
      .filter(Boolean)
      .join(" ");
    return `${url.hostname}\n${fileName}${params ? `\n${params}` : ""}`;
  } catch {
    return rawUrl.slice(0, 160);
  }
}

function summarizeTrack(track?: Track | null) {
  if (!track) {
    return null;
  }

  return {
    id: track.id,
    bvid: track.bvid,
    cid: track.cid,
    title: track.title,
    artist: track.artist,
    durationSeconds: track.durationSeconds,
  };
}

function playUrlApiUrl(track: Track) {
  return `https://api.bilibili.com/x/player/playurl?cid=${encodeURIComponent(track.cid)}&bvid=${encodeURIComponent(track.bvid)}&qn=64&fnval=16`;
}

function summarizePlayUrlAudio(audio: any, index: number) {
  const urls = [audio?.baseUrl, ...(audio?.backupUrl ?? [])].filter(Boolean);
  return {
    index,
    id: audio?.id,
    bandwidth: audio?.bandwidth,
    mimeType: audio?.mimeType,
    codecs: audio?.codecs,
    urlCount: urls.length,
    urls: urls.map((url: string, urlIndex: number) => ({
      urlIndex,
      summary: summarizeUrl(url),
      url,
    })),
  };
}

async function readTinyBody(response: any) {
  try {
    const buffer = await response.arrayBuffer();
    return `bodyBytes=${buffer?.byteLength ?? 0}`;
  } catch (error) {
    return `bodyReadError=${error instanceof Error ? error.message : String(error)}`;
  }
}

function stopPlayer() {
  runSerial += 1;

  try {
    if (player) {
      player.onReadyToPlay = undefined;
      player.onError = undefined;
      player.onTimeControlStatusChanged = undefined;
      player.onEnded = undefined;
      player.stop?.();
      player.dispose?.();
    }
  } catch {}

  player = null;
}

function disposeCurrentPlayerForCandidate() {
  try {
    if (player) {
      player.onReadyToPlay = undefined;
      player.onError = undefined;
      player.onTimeControlStatusChanged = undefined;
      player.onEnded = undefined;
      player.stop?.();
      player.dispose?.();
    }
  } catch {}

  player = null;
}

function ReproApp() {
  const [bvid, setBvid] = useState("");
  const [m4sUrl, setM4sUrl] = useState("");
  const [referer, setReferer] = useState(DEFAULT_REFERER);
  const [cookie, setCookie] = useState("");
  const [queueSummary, setQueueSummary] = useState("No BVID loaded");
  const [currentLabel, setCurrentLabel] = useState("Idle");
  const [logs, setLogs] = useState([
    `${REPRO_VERSION}`,
    "Input a BVID, resolve tracks, then play the minimum AVPlayer queue.",
  ]);

  function append(message: string, data?: unknown) {
    const text =
      data === undefined
        ? `[${now()}] ${message}`
        : `[${now()}] ${message}\n${JSON.stringify(data, null, 2)}`;
    console.log?.("[azusa-repro][avplayer-compare]", {
      version: REPRO_VERSION,
      message,
      data,
    });
    setLogs((current: string[]) => [text, ...current].slice(0, 120));
  }

  function setCurrent(index: number) {
    reproIndex = index;
    const track = reproQueue[index];
    setCurrentLabel(
      track ? `${index + 1}/${reproQueue.length} ${track.title}` : "Idle",
    );
  }

  async function resolveBvidQueue() {
    const input = bvid.trim();
    if (!input) {
      append("Missing BVID");
      return;
    }

    append("resolve bvid input", { input });
    const result = await importFromInput(input);
    reproQueue = result.tracks;
    setCurrent(reproQueue.length ? 0 : -1);
    setQueueSummary(`${result.sourceTitle} · ${reproQueue.length} tracks`);
    append("resolve bvid result", {
      source: result.source,
      sourceTitle: result.sourceTitle,
      ownerName: result.ownerName,
      trackCount: reproQueue.length,
      tracks: reproQueue.map(summarizeTrack),
    });
  }

  async function prepareTrack(index: number) {
    const track = reproQueue[index];
    if (!track) {
      throw new Error(`No track at index ${index}`);
    }

    append("resolve track stream input", {
      queueIndex: index,
      track: summarizeTrack(track),
    });

    const resolved = await resolveTrackStream(track);
    reproQueue[index] = resolved;
    append("resolve track stream result", {
      queueIndex: index,
      track: summarizeTrack(resolved),
      streamUrl: resolved.streamUrl,
      backupStreamUrls: resolved.backupStreamUrls ?? [],
      candidates: sourceCandidates(resolved).map((source, sourceIndex) => ({
        sourceIndex,
        summary: summarizeUrl(source),
        url: source,
      })),
    });
    return resolved;
  }

  async function runFetchProbeForSource(track: Track, sourceIndex: number) {
    const source = sourceCandidates(track)[sourceIndex];
    if (!source) {
      append("fetch probe missing source", {
        track: summarizeTrack(track),
        sourceIndex,
      });
      return;
    }

    const headers = streamHeaders(source, referer, cookie);
    append("fetch probe input", {
      track: summarizeTrack(track),
      sourceIndex,
      source,
      summary: summarizeUrl(source),
      headerKeys: Object.keys(headers),
      headers: logHeaders(headers),
      headerDump: headerDump(headers),
    });

    try {
      const head = await fetch(source, {
        method: "HEAD",
        headers,
        timeout: 15,
        debugLabel: `ReproHead ${track.bvid}/${track.cid}#${sourceIndex}`,
      } as any);
      append("HEAD result", {
        sourceIndex,
        status: head.status,
        contentRange: head.headers?.get?.("content-range"),
        contentLength: head.headers?.get?.("content-length"),
        acceptRanges: head.headers?.get?.("accept-ranges"),
      });
    } catch (error) {
      append("HEAD error", {
        sourceIndex,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const range = await fetch(source, {
        method: "GET",
        headers: {
          ...headers,
          Range: "bytes=0-1",
        },
        timeout: 20,
        debugLabel: `ReproRange ${track.bvid}/${track.cid}#${sourceIndex}`,
      } as any);
      append("GET Range result", {
        sourceIndex,
        status: range.status,
        contentRange: range.headers?.get?.("content-range"),
        contentLength: range.headers?.get?.("content-length"),
        acceptRanges: range.headers?.get?.("accept-ranges"),
        body: await readTinyBody(range),
      });
    } catch (error) {
      append("GET Range error", {
        sourceIndex,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function runFetchProbeForRawSource(
    label: string,
    source: string,
    headers?: Record<string, string>,
  ) {
    append("raw fetch probe input", {
      label,
      source,
      summary: summarizeUrl(source),
      headerKeys: headers ? Object.keys(headers) : [],
      headers: headers ? logHeaders(headers) : "none",
      headerDump: headers ? headerDump(headers) : "none",
    });

    try {
      const head = await fetch(source, {
        method: "HEAD",
        headers,
        timeout: 15,
        debugLabel: `HeaderMatrixHead ${label}`,
      } as any);
      append("raw HEAD result", {
        label,
        status: head.status,
        contentRange: head.headers?.get?.("content-range"),
        contentLength: head.headers?.get?.("content-length"),
        acceptRanges: head.headers?.get?.("accept-ranges"),
      });
    } catch (error) {
      append("raw HEAD error", {
        label,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const range = await fetch(source, {
        method: "GET",
        headers: {
          ...(headers ?? {}),
          Range: "bytes=0-1",
        },
        timeout: 20,
        debugLabel: `HeaderMatrixRange ${label}`,
      } as any);
      append("raw GET Range result", {
        label,
        status: range.status,
        contentRange: range.headers?.get?.("content-range"),
        contentLength: range.headers?.get?.("content-length"),
        acceptRanges: range.headers?.get?.("accept-ranges"),
        body: await readTinyBody(range),
      });
    } catch (error) {
      append("raw GET Range error", {
        label,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function runCurrentTrackProbes() {
    const index = reproIndex >= 0 ? reproIndex : 0;
    const track = await prepareTrack(index);
    const candidates = sourceCandidates(track);

    for (let sourceIndex = 0; sourceIndex < candidates.length; sourceIndex += 1) {
      await runFetchProbeForSource(track, sourceIndex);
    }
  }

  async function probeCurrentTrackPlayUrlApi() {
    const index = reproIndex >= 0 ? reproIndex : 0;
    if (!reproQueue.length) {
      await resolveBvidQueue();
    }

    const track = reproQueue[index];
    if (!track) {
      append("playurl API missing track", {
        index,
        queueLength: reproQueue.length,
      });
      return;
    }

    const url = playUrlApiUrl(track);
    const headers = requestHeaders(url, {
      Referer: referer || DEFAULT_REFERER,
      Cookie: cookie.trim() || undefined,
      Accept: "application/json,text/plain,*/*",
    });
    append("playurl API input", {
      track: summarizeTrack(track),
      url,
      headerKeys: Object.keys(headers),
      headers: logHeaders(headers),
      headerDump: headerDump(headers),
    });

    try {
      const response = await fetch(url, {
        headers,
        timeout: 15,
        debugLabel: `ReproPlayUrl ${track.bvid}/${track.cid}`,
      } as any);
      const json = await response.json();
      append("playurl API result", {
        status: response.status,
        ok: response.ok,
        code: json?.code,
        message: json?.message,
        timelength: json?.data?.timelength,
        audioCount: json?.data?.dash?.audio?.length ?? 0,
        audios: (json?.data?.dash?.audio ?? []).map(summarizePlayUrlAudio),
        durl: json?.data?.durl ?? [],
      });
    } catch (error) {
      append("playurl API error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function directUrlTrack(url: string): Track {
    return {
      id: `direct:${Date.now()}`,
      bvid: "direct-m4s",
      cid: "direct-m4s",
      title: "Direct m4s URL",
      artist: "Manual input",
      sourceTitle: "Direct m4s",
      streamUrl: url,
    };
  }

  async function runDirectM4sProbe() {
    const url = m4sUrl.trim();
    if (!url) {
      append("Missing m4s URL");
      return;
    }

    await runFetchProbeForSource(directUrlTrack(url), 0);
  }

  async function playDirectM4sUrl() {
    const url = m4sUrl.trim();
    if (!url) {
      append("Missing m4s URL");
      return;
    }

    const activeRun = ++runSerial;
    reproIndex = -1;
    setCurrentLabel("Direct m4s URL");
    await ensureAudioSession();
    await playCandidate(directUrlTrack(url), 0, activeRun, false);
  }

  function playHeaderMatrixVariant(
    label: string,
    source: string,
    runSetSource: (localPlayer: any) => unknown,
    loggedHeaders?: Record<string, string>,
  ) {
    return new Promise<void>((resolve) => {
      if (typeof AVPlayerCtor !== "function") {
        append("AVPlayer missing", {
          label,
          importedType: typeof AVPlayer,
          globalType: typeof globalRuntime.AVPlayer,
        });
        resolve();
        return;
      }

      const activeRun = ++runSerial;
      disposeCurrentPlayerForCandidate();
      const localPlayer = new AVPlayerCtor();
      player = localPlayer;
      let settled = false;
      let timer: number | undefined;

      const finish = (reason: string) => {
        if (settled) return;
        settled = true;
        if (timer && clearTimeoutApi) {
          clearTimeoutApi(timer);
        }
        append("AVPlayer header matrix finish", {
          label,
          reason,
          currentTime: localPlayer.currentTime,
          duration: localPlayer.duration,
          timeControlStatus: localPlayer.timeControlStatus,
        });
        resolve();
      };

      if (setTimeoutApi) {
        timer = setTimeoutApi(() => {
          finish("timeout");
        }, 15000) as unknown as number;
      }

      append("AVPlayer header matrix start", {
        label,
        run: activeRun,
        source,
        sourceSummary: summarizeUrl(source),
        headerKeys: loggedHeaders ? Object.keys(loggedHeaders) : [],
        headers: loggedHeaders ? logHeaders(loggedHeaders) : "none",
        headerDump: loggedHeaders ? headerDump(loggedHeaders) : "none",
      });

      localPlayer.onReadyToPlay = () => {
        if (activeRun !== runSerial || player !== localPlayer) return;
        append("AVPlayer header matrix ready", {
          label,
          currentTime: localPlayer.currentTime,
          duration: localPlayer.duration,
          timeControlStatus: localPlayer.timeControlStatus,
        });
        try {
          localPlayer.play?.();
          append("AVPlayer header matrix play called", {
            label,
            currentTime: localPlayer.currentTime,
            duration: localPlayer.duration,
            timeControlStatus: localPlayer.timeControlStatus,
          });
        } catch (error) {
          append("AVPlayer header matrix play error", {
            label,
            error: error instanceof Error ? error.message : String(error),
          });
          finish("play-error");
        }
      };

      localPlayer.onError = (message: string) => {
        if (activeRun !== runSerial || player !== localPlayer) return;
        append("AVPlayer header matrix error", {
          label,
          message,
          currentTime: localPlayer.currentTime,
          duration: localPlayer.duration,
          timeControlStatus: localPlayer.timeControlStatus,
        });
        finish("error");
      };

      localPlayer.onTimeControlStatusChanged = (status: unknown) => {
        if (activeRun !== runSerial || player !== localPlayer) return;
        append("AVPlayer header matrix status", {
          label,
          status,
          currentTime: localPlayer.currentTime,
          duration: localPlayer.duration,
        });
        if (status === "playing" || status === 2) {
          if (setTimeoutApi) {
            setTimeoutApi(() => finish("playing"), 1500);
          } else {
            finish("playing");
          }
        }
      };

      localPlayer.onEnded = () => {
        if (activeRun !== runSerial || player !== localPlayer) return;
        append("AVPlayer header matrix ended", { label });
        finish("ended");
      };

      try {
        const result = runSetSource(localPlayer);
        append("AVPlayer header matrix setSource result", {
          label,
          result,
        });
        if (!result) {
          finish("setSource-false");
        }
      } catch (error) {
        append("AVPlayer header matrix setSource threw", {
          label,
          error: error instanceof Error ? error.message : String(error),
        });
        finish("setSource-throw");
      }
    });
  }

  async function runM4sHeaderTransportMatrix() {
    const source = m4sUrl.trim();
    if (!source) {
      append("Missing m4s URL");
      return;
    }

    const fullGood = streamHeaders(source, referer, cookie);
    const minGood = minimalHeaders(source, referer, cookie);
    const fullBad = badRefererHeaders(source, referer, cookie);
    const lowerGood = lowerCaseRefererHeaders(source, referer, cookie);
    append("header matrix plan", {
      source,
      sourceSummary: summarizeUrl(source),
      variants: [
        "fetch no headers",
        "fetch full good",
        "fetch full bad Referer",
        "fetch minimal good",
        "AVPlayer no headers",
        "AVPlayer full good setSource(url, { headers })",
        "AVPlayer full bad Referer setSource(url, { headers })",
        "AVPlayer full good setSource({ url, headers })",
        "AVPlayer lowercase referer setSource(url, { headers })",
        "AVPlayer minimal good setSource(url, { headers })",
      ],
    });

    await runFetchProbeForRawSource("no-headers", source);
    await runFetchProbeForRawSource("full-good", source, fullGood);
    await runFetchProbeForRawSource("full-bad-referer", source, fullBad);
    await runFetchProbeForRawSource("minimal-good", source, minGood);

    await ensureAudioSession();
    await playHeaderMatrixVariant(
      "no-headers:setSource(url)",
      source,
      (localPlayer) => localPlayer.setSource(source),
    );
    await playHeaderMatrixVariant(
      "full-good:setSource(url,{headers})",
      source,
      (localPlayer) => localPlayer.setSource(source, { headers: fullGood }),
      fullGood,
    );
    await playHeaderMatrixVariant(
      "full-bad-referer:setSource(url,{headers})",
      source,
      (localPlayer) => localPlayer.setSource(source, { headers: fullBad }),
      fullBad,
    );
    await playHeaderMatrixVariant(
      "full-good:setSource({url,headers})",
      source,
      (localPlayer) => localPlayer.setSource({ url: source, headers: fullGood }),
      fullGood,
    );
    await playHeaderMatrixVariant(
      "lowercase-referer:setSource(url,{headers})",
      source,
      (localPlayer) => localPlayer.setSource(source, { headers: lowerGood }),
      lowerGood,
    );
    await playHeaderMatrixVariant(
      "minimal-good:setSource(url,{headers})",
      source,
      (localPlayer) => localPlayer.setSource(source, { headers: minGood }),
      minGood,
    );
  }

  async function ensureAudioSession() {
    try {
      await SharedAudioSessionApi?.setCategory?.("playback");
      await SharedAudioSessionApi?.setActive?.(true);
      append("audio session ready");
    } catch (error) {
      append("audio session error", String(error));
    }
  }

  async function playCandidate(
    track: Track,
    sourceIndex: number,
    activeRun: number,
    autoAdvance: boolean,
  ) {
    if (activeRun !== runSerial) return;

    const candidates = sourceCandidates(track);
    const source = candidates[sourceIndex];
    if (!source) {
      append("track exhausted all candidates", {
        queueIndex: reproIndex,
        track: summarizeTrack(track),
        candidateCount: candidates.length,
      });

      if (autoAdvance && reproIndex + 1 < reproQueue.length) {
        await playTrackAt(reproIndex + 1, activeRun, true);
      }
      return;
    }

    if (typeof AVPlayerCtor !== "function") {
      append("AVPlayer missing", {
        importedType: typeof AVPlayer,
        globalType: typeof globalRuntime.AVPlayer,
      });
      return;
    }

    disposeCurrentPlayerForCandidate();
    const localPlayer = new AVPlayerCtor();
    player = localPlayer;
    const headers = streamHeaders(source, referer, cookie);

    append("AVPlayer candidate start", {
      run: activeRun,
      autoAdvance,
      queueIndex: reproIndex,
      sourceIndex,
      track: summarizeTrack(track),
      source,
      sourceSummary: summarizeUrl(source),
      headerKeys: Object.keys(headers),
      headers: logHeaders(headers),
      headerDump: headerDump(headers),
    });

    localPlayer.onReadyToPlay = () => {
      if (activeRun !== runSerial || player !== localPlayer) return;
      append("AVPlayer onReadyToPlay", {
        run: activeRun,
        queueIndex: reproIndex,
        sourceIndex,
        currentTime: localPlayer.currentTime,
        duration: localPlayer.duration,
        timeControlStatus: localPlayer.timeControlStatus,
      });
      try {
        localPlayer.play?.();
        append("AVPlayer play() called", {
          run: activeRun,
          queueIndex: reproIndex,
          sourceIndex,
          currentTime: localPlayer.currentTime,
          duration: localPlayer.duration,
          timeControlStatus: localPlayer.timeControlStatus,
        });
      } catch (error) {
        append("AVPlayer play() error", {
          run: activeRun,
          queueIndex: reproIndex,
          sourceIndex,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    localPlayer.onError = (message: string) => {
      if (activeRun !== runSerial || player !== localPlayer) return;
      append("AVPlayer onError", {
        run: activeRun,
        queueIndex: reproIndex,
        sourceIndex,
        message,
        currentTime: localPlayer.currentTime,
        duration: localPlayer.duration,
        timeControlStatus: localPlayer.timeControlStatus,
      });
      void playCandidate(track, sourceIndex + 1, activeRun, autoAdvance);
    };

    localPlayer.onTimeControlStatusChanged = (status: unknown) => {
      if (activeRun !== runSerial || player !== localPlayer) return;
      append("AVPlayer status", {
        run: activeRun,
        queueIndex: reproIndex,
        sourceIndex,
        status,
        currentTime: localPlayer.currentTime,
        duration: localPlayer.duration,
      });
    };

    localPlayer.onEnded = () => {
      if (activeRun !== runSerial || player !== localPlayer) return;
      append("AVPlayer ended", {
        run: activeRun,
        queueIndex: reproIndex,
        sourceIndex,
      });
      if (autoAdvance && reproIndex + 1 < reproQueue.length) {
        void playTrackAt(reproIndex + 1, activeRun, true);
      }
    };

    const attempts = [
      {
        label: "setSource(url, { headers })",
        run: () => localPlayer.setSource(source, { headers }),
      },
      {
        label: "setSource({ url, headers })",
        run: () => localPlayer.setSource({ url: source, headers }),
      },
      {
        label: "setSource(url)",
        run: () => localPlayer.setSource(source),
      },
    ];

    for (const attempt of attempts) {
      try {
        const result = attempt.run();
        append("AVPlayer setSource attempt", {
          run: activeRun,
          queueIndex: reproIndex,
          sourceIndex,
          label: attempt.label,
          result,
        });
        if (result) {
          return;
        }
      } catch (error) {
        append("AVPlayer setSource threw", {
          run: activeRun,
          queueIndex: reproIndex,
          sourceIndex,
          label: attempt.label,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await playCandidate(track, sourceIndex + 1, activeRun, autoAdvance);
  }

  async function playTrackAt(
    index: number,
    activeRun = ++runSerial,
    autoAdvance = false,
  ) {
    if (!reproQueue.length) {
      await resolveBvidQueue();
    }

    if (index < 0 || index >= reproQueue.length) {
      append("play index out of range", {
        index,
        queueLength: reproQueue.length,
      });
      return;
    }

    setCurrent(index);
    await ensureAudioSession();
    const track = await prepareTrack(index);
    if (activeRun !== runSerial) return;
    await playCandidate(track, 0, activeRun, autoAdvance);
  }

  return (
    <Form formStyle="grouped">
      <Section header={<Text>AVPlayer BVID queue repro</Text>}>
        <Text>{REPRO_VERSION}</Text>
        <Text>{queueSummary}</Text>
        <Text>{currentLabel}</Text>
        <TextField
          title="BVID"
          placeholder="BV..."
          value={bvid}
          onChanged={setBvid}
        />
        <TextField
          title="m4s URL"
          placeholder="Paste direct m4s URL"
          value={m4sUrl}
          onChanged={setM4sUrl}
        />
        <TextField
          title="Referer"
          placeholder={DEFAULT_REFERER}
          value={referer}
          onChanged={setReferer}
        />
        <TextField
          title="Cookie"
          placeholder="Optional Bilibili Cookie"
          value={cookie}
          onChanged={setCookie}
        />
        <Button title="Resolve BVID" action={() => void resolveBvidQueue()} />
        <Button
          title="Probe playurl API"
          action={() => void probeCurrentTrackPlayUrlApi()}
        />
        <Button
          title="Probe current track"
          action={() => void runCurrentTrackProbes()}
        />
        <Button
          title="Probe m4s URL"
          action={() => void runDirectM4sProbe()}
        />
        <Button
          title="Run m4s header matrix"
          action={() => void runM4sHeaderTransportMatrix()}
        />
        <Button title="Play first track" action={() => void playTrackAt(0)} />
        <Button
          title="Play m4s URL"
          action={() => void playDirectM4sUrl()}
        />
        <Button
          title="Play queue continuously"
          action={() => void playTrackAt(0, ++runSerial, true)}
        />
        <Button
          title="Next track"
          action={() => void playTrackAt(reproIndex + 1)}
        />
        <Button
          title="Stop player"
          action={() => {
            stopPlayer();
            setCurrent(-1);
            append("Player stopped");
          }}
        />
      </Section>

      <Section header={<Text>Logs</Text>}>
        <VStack alignment="leading" spacing={10}>
          {logs.map((item, index) => (
            <Text key={`${index}-${item.slice(0, 12)}`} font="caption">
              {item}
            </Text>
          ))}
        </VStack>
      </Section>
    </Form>
  );
}

async function run() {
  await Navigation.present({
    element: <ReproApp />,
  });

  Script.exit();
}

void run();
