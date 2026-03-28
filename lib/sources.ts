import type {
  ChannelSourceDescriptor,
  CollectionKind,
  CollectionSourceDescriptor,
  FavoriteSourceDescriptor,
  SourceDescriptor,
  SourceKind,
  VideoSourceDescriptor,
} from "./types";

const BVID_PATTERN = /BV[0-9A-Za-z]{10}/i;

function cleanInput(input: string) {
  return input.trim();
}

function matchFirst(input: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

export function parseBvid(input: string) {
  const match = cleanInput(input).match(BVID_PATTERN);
  if (!match?.[0]) {
    return null;
  }

  const raw = match[0];
  return `BV${raw.slice(2)}`;
}

export function createVideoSource(bvid: string, titleHint?: string): VideoSourceDescriptor {
  return {
    kind: "video",
    bvid,
    input: bvid,
    titleHint,
  };
}

export function createFavoriteSource(
  mediaId: string,
  titleHint?: string,
): FavoriteSourceDescriptor {
  return {
    kind: "favorite",
    mediaId,
    input: `favorite:${mediaId}`,
    titleHint,
  };
}

export function createCollectionSource(
  collectionKind: CollectionKind,
  ownerMid: string,
  collectionId: string,
  titleHint?: string,
): CollectionSourceDescriptor {
  return {
    kind: "collection",
    collectionKind,
    ownerMid,
    collectionId,
    input: `${collectionKind}:${ownerMid}:${collectionId}`,
    titleHint,
  };
}

export function createChannelSource(
  ownerMid: string,
  titleHint?: string,
): ChannelSourceDescriptor {
  return {
    kind: "channel",
    ownerMid,
    input: `channel:${ownerMid}`,
    titleHint,
  };
}

function parseCollectionInput(input: string): CollectionSourceDescriptor | null {
  const trimmed = cleanInput(input);

  const directMatch = trimmed.match(
    /^(season|series)\s*:\s*(\d+)\s*:\s*(\d+)$/i,
  );
  if (directMatch) {
    return createCollectionSource(
      directMatch[1].toLowerCase() as CollectionKind,
      directMatch[2],
      directMatch[3],
    );
  }

  const ownerMid = matchFirst(trimmed, [
    /space\.bilibili\.com\/(\d+)/i,
    /\bmid\s*[:=]\s*(\d+)/i,
  ]);
  const collectionId = matchFirst(trimmed, [
    /[?&](?:sid|season_id|series_id)=(\d+)/i,
    /\/lists\/(\d+)/i,
    /\/channel\/(?:seriesdetail|collectiondetail)\/?(\d+)/i,
  ]);

  if (!ownerMid || !collectionId) {
    return null;
  }

  const lowered = trimmed.toLowerCase();
  const collectionKind: CollectionKind =
    lowered.includes("series")
      ? "series"
      : lowered.includes("season") ||
          lowered.includes("collectiondetail") ||
          lowered.includes("type=season")
        ? "season"
        : "season";

  return createCollectionSource(collectionKind, ownerMid, collectionId);
}

function parseFavoriteInput(input: string): FavoriteSourceDescriptor | null {
  const trimmed = cleanInput(input);
  const mediaId = matchFirst(trimmed, [
    /^(?:favorite|fav)\s*:\s*(\d+)$/i,
    /^ml(\d+)$/i,
    /\/(?:medialist\/play\/)?ml(\d+)/i,
    /[?&]media_id=(\d+)/i,
  ]);

  if (!mediaId) {
    return null;
  }

  return createFavoriteSource(mediaId);
}

function parseChannelInput(input: string): ChannelSourceDescriptor | null {
  const trimmed = cleanInput(input);
  const ownerMid = matchFirst(trimmed, [
    /^(?:channel|mid)\s*:\s*(\d+)$/i,
    /space\.bilibili\.com\/(\d+)(?:[/?#]|$)/i,
  ]);

  if (!ownerMid) {
    return null;
  }

  if (
    /favlist|collectiondetail|seriesdetail|\/lists\//i.test(trimmed) ||
    /[?&](?:fid|media_id|sid|season_id|series_id)=/i.test(trimmed)
  ) {
    return null;
  }

  return createChannelSource(ownerMid);
}

export function parseSourceInput(input: string): SourceDescriptor | null {
  const trimmed = cleanInput(input);
  if (!trimmed) {
    return null;
  }

  const bvid = parseBvid(trimmed);
  if (bvid) {
    return createVideoSource(bvid);
  }

  return (
    parseFavoriteInput(trimmed) ??
    parseCollectionInput(trimmed) ??
    parseChannelInput(trimmed)
  );
}

export function coerceSourceDescriptor(value: unknown): SourceDescriptor | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<SourceDescriptor>;
  const input = typeof candidate.input === "string" ? candidate.input : "";
  if (!input) {
    return null;
  }

  const parsed = parseSourceInput(input);
  if (!parsed) {
    return null;
  }

  return typeof candidate.titleHint === "string" && candidate.titleHint
    ? {
        ...parsed,
        titleHint: candidate.titleHint,
      }
    : parsed;
}

export function sourceKindLabel(kind: SourceKind) {
  switch (kind) {
    case "video":
      return "视频";
    case "favorite":
      return "收藏夹";
    case "collection":
      return "合集";
    case "channel":
      return "频道";
    default:
      return kind;
  }
}

export function sourceShortLabel(source: SourceDescriptor) {
  if (source.titleHint) {
    return source.titleHint;
  }

  switch (source.kind) {
    case "video":
      return source.bvid;
    case "favorite":
      return `收藏夹 ${source.mediaId}`;
    case "collection":
      return `${source.collectionKind === "season" ? "合集" : "系列"} ${source.collectionId}`;
    case "channel":
      return `频道 ${source.ownerMid}`;
  }
}

export function sourceSecondaryLabel(source: SourceDescriptor) {
  switch (source.kind) {
    case "video":
      return source.bvid;
    case "favorite":
      return `media_id ${source.mediaId}`;
    case "collection":
      return `${source.collectionKind} · UP ${source.ownerMid}`;
    case "channel":
      return `UP ${source.ownerMid}`;
  }
}

export function isSameSource(
  left?: SourceDescriptor | null,
  right?: SourceDescriptor | null,
) {
  if (!left || !right) {
    return false;
  }

  return left.input === right.input;
}
