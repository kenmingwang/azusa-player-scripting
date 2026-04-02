export type LyricLine = {
  id: string;
  timeSeconds?: number;
  text: string;
};

export type ParsedLyrics = {
  raw: string;
  lines: LyricLine[];
  timed: boolean;
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

export function parseLyrics(raw: string): ParsedLyrics {
  const normalized = raw.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return {
      raw: "",
      lines: [],
      timed: false,
    };
  }

  const lines: LyricLine[] = [];
  let hasTimestamp = false;

  normalized.split("\n").forEach((sourceLine, lineIndex) => {
    const line = sourceLine.trim();
    if (!line) {
      return;
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

    if (line.timeSeconds <= currentTimeSeconds + 0.15) {
      activeIndex = index;
      continue;
    }

    break;
  }

  return activeIndex;
}
