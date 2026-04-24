import type { Track } from "./types";

export const DEFAULT_QUEUE_PAGE_SIZE = 50;

export type PaginatedTrackRow = {
  id: string;
  track: Track;
  index: number;
  displayIndex: number;
  isActive: boolean;
};

export type PaginatedTrackState = {
  rows: PaginatedTrackRow[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  resultCount: number;
  startResult: number;
  endResult: number;
  query: string;
};

function normalizeQuery(query?: string) {
  return (query ?? "").trim().toLowerCase();
}

function trackMatchesQuery(track: Track, query: string) {
  if (!query) {
    return true;
  }

  return [
    track.title,
    track.artist,
    track.sourceTitle,
    track.cid,
    track.bvid,
    track.id,
  ].some((value) => value.toLowerCase().includes(query));
}

export function clampPage(page: number, totalPages: number) {
  if (!Number.isFinite(page)) {
    return 1;
  }

  return Math.max(1, Math.min(Math.floor(page), Math.max(totalPages, 1)));
}

export function pageForTrackIndex(
  trackIndex: number,
  pageSize = DEFAULT_QUEUE_PAGE_SIZE,
) {
  if (trackIndex < 0) {
    return 1;
  }

  return Math.floor(trackIndex / pageSize) + 1;
}

export function buildPaginatedTrackState(input: {
  tracks: Track[];
  query?: string;
  page?: number;
  pageSize?: number;
  currentIndex?: number;
}): PaginatedTrackState {
  const pageSize = Math.max(1, Math.floor(input.pageSize ?? DEFAULT_QUEUE_PAGE_SIZE));
  const query = normalizeQuery(input.query);
  const allRows = input.tracks
    .map((track, index) => ({
      id: `${track.id}:${index}`,
      track,
      index,
      displayIndex: index + 1,
      isActive: input.currentIndex === index,
    }))
    .filter((row) => trackMatchesQuery(row.track, query));
  const resultCount = allRows.length;
  const totalPages = Math.max(1, Math.ceil(resultCount / pageSize));
  const page = clampPage(input.page ?? 1, totalPages);
  const startOffset = (page - 1) * pageSize;
  const rows = allRows.slice(startOffset, startOffset + pageSize);

  return {
    rows,
    page,
    pageSize,
    totalPages,
    totalCount: input.tracks.length,
    resultCount,
    startResult: resultCount ? startOffset + 1 : 0,
    endResult: startOffset + rows.length,
    query,
  };
}
