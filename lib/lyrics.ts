export type LyricLine = {
  id: string;
  timeSeconds?: number;
  text: string;
};

export type ParsedLyrics = {
  raw: string;
  lines: LyricLine[];
  timed: boolean;
  offsetMs: number;
};

function parseTimestampToken(token: string) {
  const matched = token.match(/^(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?$/);
  if (!matched) {
    return null;
  }

  const minutes = Number(matched[1] ?? "0");
  const seconds = Number(matched[2] ?? "0");
  const fractionText = matched[3] ?? "0";
  const fraction =
    fractionText.length === 3
      ? Number(fractionText) / 1000
      : Number(fractionText) / 100;

  return minutes * 60 + seconds + fraction;
}

function parseMetadataLine(line: string) {
  const matched = line.match(/^\[([a-zA-Z]+):(.*)\]$/);
  if (!matched) {
    return null;
  }

  return {
    key: String(matched[1] ?? "").trim().toLowerCase(),
    value: String(matched[2] ?? "").trim(),
  };
}

export function parseLyrics(raw: string): ParsedLyrics {
  const normalized = raw.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return {
      raw: "",
      lines: [],
      timed: false,
      offsetMs: 0,
    };
  }

  const lines: LyricLine[] = [];
  let hasTimestamp = false;
  let offsetMs = 0;

  normalized.split("\n").forEach((sourceLine, lineIndex) => {
    const line = sourceLine.trim();
    if (!line) {
      return;
    }

    const metadata = parseMetadataLine(line);
    if (metadata) {
      if (metadata.key === "offset") {
        const parsedOffset = Number(metadata.value);
        if (Number.isFinite(parsedOffset)) {
          offsetMs = parsedOffset;
        }
      }

      if (
        [
          "ti",
          "ar",
          "al",
          "by",
          "offset",
          "kana",
          "language",
          "lang",
          "re",
          "ve",
        ].includes(metadata.key)
      ) {
        return;
      }
    }

    const matches = [...line.matchAll(/\[(\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    const text = line.replace(/\[(\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?)\]/g, "").trim();

    if (!matches.length) {
      lines.push({
        id: `plain-${lineIndex}`,
        text: line,
      });
      return;
    }

    hasTimestamp = true;

    for (const [match, token] of matches) {
      const timeSeconds = parseTimestampToken(token);
      if (timeSeconds == null) {
        continue;
      }

      lines.push({
        id: `${lineIndex}-${match}-${timeSeconds}`,
        timeSeconds,
        text: text || "…",
      });
    }
  });

  const sortedLines = hasTimestamp
    ? [...lines].sort(
        (left, right) =>
          (left.timeSeconds ?? Number.MAX_SAFE_INTEGER) -
          (right.timeSeconds ?? Number.MAX_SAFE_INTEGER),
      )
    : lines;

  return {
    raw: normalized,
    lines: sortedLines,
    timed: hasTimestamp,
    offsetMs,
  };
}

export function activeLyricLineIndex(
  lyrics: ParsedLyrics,
  currentTimeSeconds: number,
) {
  if (!lyrics.timed || !lyrics.lines.length) {
    return -1;
  }

  let activeIndex = -1;
  for (let index = 0; index < lyrics.lines.length; index += 1) {
    const line = lyrics.lines[index];
    if (typeof line.timeSeconds !== "number") {
      continue;
    }

    const effectiveLineTime = line.timeSeconds + lyrics.offsetMs / 1000;

    if (effectiveLineTime <= currentTimeSeconds + 0.15) {
      activeIndex = index;
      continue;
    }

    break;
  }

  return activeIndex;
}

export function activeLyricLine(
  lyrics: ParsedLyrics,
  currentTimeSeconds: number,
) {
  const index = activeLyricLineIndex(lyrics, currentTimeSeconds);
  return index >= 0 ? lyrics.lines[index] ?? null : null;
}
