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

const DEFAULT_REFERER = "https://www.bilibili.com/";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36 Edg/111.0.1661.62";
const REPRO_VERSION = "avplayer-bili-m4s-repro-2026-04-25.1";

const globalRuntime = globalThis as any;
const AVPlayerCtor = (AVPlayer as any) ?? globalRuntime.AVPlayer;
const SharedAudioSessionApi =
  (SharedAudioSession as any) ?? globalRuntime.SharedAudioSession;

let player: any | null = null;

function now() {
  return new Date().toLocaleTimeString();
}

function streamHeaders(referer: string) {
  return {
    Accept: "*/*",
    "User-Agent": DEFAULT_USER_AGENT,
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7",
    Referer: referer || DEFAULT_REFERER,
    "Accept-Encoding": "identity;q=1, *;q=0",
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
  };
}

function headerDump(headers: Record<string, string>) {
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
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

async function readTinyBody(response: any) {
  try {
    const buffer = await response.arrayBuffer();
    return `bodyBytes=${buffer?.byteLength ?? 0}`;
  } catch (error) {
    return `bodyReadError=${error instanceof Error ? error.message : String(error)}`;
  }
}

function ReproApp() {
  const [url, setUrl] = useState("");
  const [referer, setReferer] = useState(DEFAULT_REFERER);
  const [logs, setLogs] = useState([
    `${REPRO_VERSION}`,
    "Paste a Bilibili m4s URL, then run probes and AVPlayer.",
  ]);

  function append(message: string, data?: unknown) {
    const text =
      data === undefined
        ? `[${now()}] ${message}`
        : `[${now()}] ${message}\n${JSON.stringify(data, null, 2)}`;
    console.log?.("[azusa-repro]", message, data ?? "");
    setLogs((current: string[]) => [text, ...current].slice(0, 60));
  }

  async function runFetchProbes() {
    if (!url.trim()) {
      append("Missing URL");
      return;
    }

    const headers = streamHeaders(referer);
    append("fetch probe input", {
      version: REPRO_VERSION,
      url,
      summary: summarizeUrl(url),
      headerKeys: Object.keys(headers),
      headers,
      headerDump: headerDump(headers),
    });

    try {
      const head = await fetch(url, {
        method: "HEAD",
        headers,
        timeout: 15,
        debugLabel: "BiliM4sHeadProbe",
      } as any);
      append("HEAD result", {
        status: head.status,
        contentRange: head.headers?.get?.("content-range"),
        contentLength: head.headers?.get?.("content-length"),
        acceptRanges: head.headers?.get?.("accept-ranges"),
      });
    } catch (error) {
      append("HEAD error", String(error));
    }

    try {
      const range = await fetch(url, {
        method: "GET",
        headers: {
          ...headers,
          Range: "bytes=0-1",
        },
        timeout: 20,
        debugLabel: "BiliM4sRangeProbe",
      } as any);
      append("GET Range result", {
        status: range.status,
        contentRange: range.headers?.get?.("content-range"),
        contentLength: range.headers?.get?.("content-length"),
        acceptRanges: range.headers?.get?.("accept-ranges"),
        body: await readTinyBody(range),
      });
    } catch (error) {
      append("GET Range error", String(error));
    }
  }

  async function runAVPlayerTest() {
    if (!url.trim()) {
      append("Missing URL");
      return;
    }

    if (typeof AVPlayerCtor !== "function") {
      append("AVPlayer missing", {
        importedType: typeof AVPlayer,
        globalType: typeof globalRuntime.AVPlayer,
      });
      return;
    }

    const headers = streamHeaders(referer);
    append("AVPlayer input", {
      version: REPRO_VERSION,
      url,
      summary: summarizeUrl(url),
      headerKeys: Object.keys(headers),
      headers,
      headerDump: headerDump(headers),
    });

    try {
      await SharedAudioSessionApi?.setCategory?.("playback");
      await SharedAudioSessionApi?.setActive?.(true);
    } catch (error) {
      append("Audio session error", String(error));
    }

    try {
      player?.stop?.();
      player?.dispose?.();
    } catch {}

    player = new AVPlayerCtor();
    player.onReadyToPlay = () => {
      append("AVPlayer onReadyToPlay", {
        currentTime: player?.currentTime,
        duration: player?.duration,
        timeControlStatus: player?.timeControlStatus,
      });
      try {
        player?.play?.();
        append("AVPlayer play() called");
      } catch (error) {
        append("AVPlayer play() error", String(error));
      }
    };
    player.onError = (message: string) => {
      append("AVPlayer onError", {
        message,
        currentTime: player?.currentTime,
        duration: player?.duration,
        timeControlStatus: player?.timeControlStatus,
      });
    };
    player.onTimeControlStatusChanged = (status: unknown) => {
      append("AVPlayer status", {
        status,
        currentTime: player?.currentTime,
        duration: player?.duration,
      });
    };
    player.onEnded = () => {
      append("AVPlayer ended");
    };

    const attempts = [
      {
        label: "setSource(url, { headers })",
        run: () => player!.setSource(url, { headers }),
      },
      {
        label: "setSource({ url, headers })",
        run: () => player!.setSource({ url, headers }),
      },
      {
        label: "setSource(url)",
        run: () => player!.setSource(url),
      },
    ];

    for (const attempt of attempts) {
      try {
        const result = attempt.run();
        append(attempt.label, { result });
        if (result) {
          return;
        }
      } catch (error) {
        append(`${attempt.label} threw`, String(error));
      }
    }
  }

  async function runFullTest() {
    await runFetchProbes();
    await runAVPlayerTest();
  }

  return (
    <Form formStyle="grouped">
      <Section header={<Text>AVPlayer Bili m4s minimum repro</Text>}>
        <Text>{REPRO_VERSION}</Text>
        <TextField
          title="m4s URL"
          placeholder="Paste Bilibili m4s URL"
          value={url}
          onChanged={setUrl}
        />
        <TextField
          title="Referer"
          placeholder={DEFAULT_REFERER}
          value={referer}
          onChanged={setReferer}
        />
        <Button title="Run fetch probes" action={() => void runFetchProbes()} />
        <Button title="Run AVPlayer test" action={() => void runAVPlayerTest()} />
        <Button title="Run full repro" action={() => void runFullTest()} />
        <Button
          title="Stop player"
          action={() => {
            try {
              player?.stop?.();
              append("Player stopped");
            } catch (error) {
              append("Stop error", String(error));
            }
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
