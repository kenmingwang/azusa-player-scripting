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
const REPRO_VERSION = "avplayer-bvid-queue-repro-2026-04-26.1";

const globalRuntime = globalThis as any;
const AVPlayerCtor = (AVPlayer as any) ?? globalRuntime.AVPlayer;
const SharedAudioSessionApi =
  (SharedAudioSession as any) ?? globalRuntime.SharedAudioSession;

let player: any | null = null;
let reproQueue: Track[] = [];
let reproIndex = -1;
let runSerial = 0;

function now() {
  return new Date().toLocaleTimeString();
}

function streamHeaders(source: string, referer: string) {
  return requestHeaders(source, {
    Referer: referer || DEFAULT_REFERER,
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

function headerDump(headers: Record<string, string>) {
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
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
  const [referer, setReferer] = useState(DEFAULT_REFERER);
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

    const headers = streamHeaders(source, referer);
    append("fetch probe input", {
      track: summarizeTrack(track),
      sourceIndex,
      source,
      summary: summarizeUrl(source),
      headerKeys: Object.keys(headers),
      headers,
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

  async function runCurrentTrackProbes() {
    const index = reproIndex >= 0 ? reproIndex : 0;
    const track = await prepareTrack(index);
    const candidates = sourceCandidates(track);

    for (let sourceIndex = 0; sourceIndex < candidates.length; sourceIndex += 1) {
      await runFetchProbeForSource(track, sourceIndex);
    }
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
    const headers = streamHeaders(source, referer);

    append("AVPlayer candidate start", {
      run: activeRun,
      autoAdvance,
      queueIndex: reproIndex,
      sourceIndex,
      track: summarizeTrack(track),
      source,
      sourceSummary: summarizeUrl(source),
      headerKeys: Object.keys(headers),
      headers,
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
          title="Referer"
          placeholder={DEFAULT_REFERER}
          value={referer}
          onChanged={setReferer}
        />
        <Button title="Resolve BVID" action={() => void resolveBvidQueue()} />
        <Button
          title="Probe current track"
          action={() => void runCurrentTrackProbes()}
        />
        <Button title="Play first track" action={() => void playTrackAt(0)} />
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
