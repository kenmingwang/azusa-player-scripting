import { IntentMemoryStorage, Storage } from "scripting";

import { coerceSourceDescriptor, parseSourceInput } from "./sources";
import type {
  PendingExternalCommand,
  PlaybackMode,
  PersistedState,
  PlaybackSnapshot,
  SourceDescriptor,
  TrackLyricsEntry,
  Track,
} from "./types";

const STATE_KEY = "azusa.scripting.poc.state";
const DOWNLOADS_KEY = "azusa.scripting.poc.downloads";
const LYRICS_KEY = "azusa.scripting.poc.lyrics";
const IMMEDIATE_SNAPSHOT_KEY = "azusa.scripting.poc.snapshot.immediate";
const RECENT_SOURCE_LIMIT = 8;
const SHARED_OPTIONS = { shared: true } as const;

type DownloadIndex = Record<string, string>;
type LyricsIndex = Record<string, string | TrackLyricsEntry>;

const defaultState: PersistedState = {
  lastInput: "",
  playbackMode: "normal",
  queue: [],
  recentSources: [],
  playbackSnapshot: null,
  pendingExternalCommand: null,
};

const globalRuntime = globalThis as any;
const storageApi = (Storage as any) ?? globalRuntime.Storage;
const intentMemoryStorageApi =
  (IntentMemoryStorage as any) ?? globalRuntime.IntentMemoryStorage;
const memoryStore = new Map<string, unknown>();

function safeGet<T>(key: string, shared = false): T | null {
  try {
    if (storageApi?.get) {
      return (
        (storageApi.get(
          key,
          shared ? SHARED_OPTIONS : undefined,
        ) as T | null) ?? null
      );
    }
  } catch {}

  return (memoryStore.get(key) as T | null) ?? null;
}

function safeSet<T>(key: string, value: T, shared = false) {
  try {
    if (storageApi?.set) {
      storageApi.set(key, value, shared ? SHARED_OPTIONS : undefined);
      return;
    }
  } catch {}

  memoryStore.set(key, value);
}

function safeIntentMemoryGet<T>(key: string, shared = false): T | null {
  try {
    if (intentMemoryStorageApi?.get) {
      return (
        (intentMemoryStorageApi.get(
          key,
          shared ? SHARED_OPTIONS : undefined,
        ) as T | null) ?? null
      );
    }
  } catch {}

  return (memoryStore.get(`intent-memory:${key}`) as T | null) ?? null;
}

function safeIntentMemorySet<T>(key: string, value: T, shared = false) {
  try {
    if (value == null) {
      intentMemoryStorageApi?.remove?.(
        key,
        shared ? SHARED_OPTIONS : undefined,
      );
      memoryStore.delete(`intent-memory:${key}`);
      return;
    }

    if (intentMemoryStorageApi?.set) {
      intentMemoryStorageApi.set(
        key,
        value,
        shared ? SHARED_OPTIONS : undefined,
      );
      return;
    }
  } catch {}

  if (value == null) {
    memoryStore.delete(`intent-memory:${key}`);
    return;
  }

  memoryStore.set(`intent-memory:${key}`, value);
}

function normalizeRecentSources(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as SourceDescriptor[];
  }

  const normalized: SourceDescriptor[] = [];
  for (const item of value) {
    const source = coerceSourceDescriptor(item);
    if (!source) continue;
    if (normalized.some((existing) => existing.input === source.input)) continue;
    normalized.push(source);
    if (normalized.length >= RECENT_SOURCE_LIMIT) {
      break;
    }
  }

  return normalized;
}

function normalizeSnapshot(value: unknown): PlaybackSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const snapshot = value as Partial<PlaybackSnapshot>;
  const source = coerceSourceDescriptor(snapshot.source);
  if (!source) {
    return null;
  }

  return {
    source,
    sourceTitle:
      typeof snapshot.sourceTitle === "string" ? snapshot.sourceTitle : source.input,
    ownerName: typeof snapshot.ownerName === "string" ? snapshot.ownerName : "",
    cover: typeof snapshot.cover === "string" ? snapshot.cover : undefined,
    queueLength:
      typeof snapshot.queueLength === "number" ? snapshot.queueLength : 0,
    currentIndex:
      typeof snapshot.currentIndex === "number" ? snapshot.currentIndex : -1,
    currentTrack:
      snapshot.currentTrack && typeof snapshot.currentTrack === "object"
        ? {
            id:
              typeof snapshot.currentTrack.id === "string"
                ? snapshot.currentTrack.id
                : "",
            title:
              typeof snapshot.currentTrack.title === "string"
                ? snapshot.currentTrack.title
                : "",
            artist:
              typeof snapshot.currentTrack.artist === "string"
                ? snapshot.currentTrack.artist
                : "",
            sourceTitle:
              typeof snapshot.currentTrack.sourceTitle === "string"
                ? snapshot.currentTrack.sourceTitle
                : typeof snapshot.sourceTitle === "string"
                  ? snapshot.sourceTitle
                  : source.input,
            cover:
              typeof snapshot.currentTrack.cover === "string"
                ? snapshot.currentTrack.cover
                : undefined,
            durationSeconds:
              typeof snapshot.currentTrack.durationSeconds === "number"
                ? snapshot.currentTrack.durationSeconds
                : undefined,
          }
        : undefined,
    playbackState:
      typeof snapshot.playbackState === "string"
        ? snapshot.playbackState
        : "idle",
    playbackMode:
      typeof snapshot.playbackMode === "string"
        ? (snapshot.playbackMode as PlaybackMode)
        : "normal",
    playbackDetail:
      typeof snapshot.playbackDetail === "string"
        ? snapshot.playbackDetail
        : undefined,
    updatedAt:
      typeof snapshot.updatedAt === "string"
        ? snapshot.updatedAt
        : new Date().toISOString(),
  };
}

function normalizePendingCommand(value: unknown): PendingExternalCommand | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const command = value as Partial<PendingExternalCommand>;
  if (
    typeof command.id !== "string" ||
    typeof command.type !== "string" ||
    typeof command.createdAt !== "string"
  ) {
    return null;
  }

  return {
    id: command.id,
    type: command.type as PendingExternalCommand["type"],
    createdAt: command.createdAt,
    requestedFrom:
      typeof command.requestedFrom === "string"
        ? command.requestedFrom
        : undefined,
    source: coerceSourceDescriptor(command.source),
  };
}

function snapshotTimestamp(snapshot?: PlaybackSnapshot | null) {
  if (!snapshot?.updatedAt) {
    return 0;
  }

  const parsed = Date.parse(snapshot.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function loadImmediatePlaybackSnapshot() {
  return normalizeSnapshot(
    safeIntentMemoryGet<PlaybackSnapshot | null>(IMMEDIATE_SNAPSHOT_KEY, true),
  );
}

function saveImmediatePlaybackSnapshot(snapshot?: PlaybackSnapshot | null) {
  safeIntentMemorySet(IMMEDIATE_SNAPSHOT_KEY, snapshot ?? null, true);
}

function normalizeState(value: unknown): PersistedState {
  if (!value || typeof value !== "object") {
    return { ...defaultState };
  }

  const raw = value as Partial<PersistedState>;
  const lastInput =
    typeof raw.lastInput === "string" ? raw.lastInput : defaultState.lastInput;
  const sourceDescriptor =
    coerceSourceDescriptor(raw.sourceDescriptor) ??
    (lastInput ? parseSourceInput(lastInput) : null) ??
    undefined;

  return {
    lastInput: sourceDescriptor?.input ?? lastInput,
    playbackMode:
      typeof raw.playbackMode === "string"
        ? (raw.playbackMode as PlaybackMode)
        : defaultState.playbackMode,
    sourceTitle:
      typeof raw.sourceTitle === "string" ? raw.sourceTitle : undefined,
    sourceDescriptor,
    recentSources: normalizeRecentSources(raw.recentSources),
    queue: Array.isArray(raw.queue) ? raw.queue : [],
    currentTrackId:
      typeof raw.currentTrackId === "string" ? raw.currentTrackId : undefined,
    playbackSnapshot: normalizeSnapshot(raw.playbackSnapshot),
    pendingExternalCommand: normalizePendingCommand(raw.pendingExternalCommand),
  };
}

export function loadState(): PersistedState {
  const sharedState = safeGet<PersistedState>(STATE_KEY, true);
  const privateState = safeGet<PersistedState>(STATE_KEY, false);
  const nextState = normalizeState(sharedState ?? privateState ?? defaultState);
  const immediateSnapshot = loadImmediatePlaybackSnapshot();

  if (!sharedState && privateState) {
    safeSet(STATE_KEY, nextState, true);
  }

  if (
    immediateSnapshot &&
    snapshotTimestamp(immediateSnapshot) >=
      snapshotTimestamp(nextState.playbackSnapshot)
  ) {
    nextState.playbackSnapshot = immediateSnapshot;
    nextState.currentTrackId =
      immediateSnapshot.currentTrack?.id ?? nextState.currentTrackId;
    nextState.sourceDescriptor =
      immediateSnapshot.source ?? nextState.sourceDescriptor;
    nextState.sourceTitle =
      immediateSnapshot.sourceTitle ?? nextState.sourceTitle;
    nextState.lastInput = immediateSnapshot.source.input ?? nextState.lastInput;
  }

  return nextState;
}

export function saveState(nextState: PersistedState) {
  const normalized = normalizeState(nextState);
  saveImmediatePlaybackSnapshot(normalized.playbackSnapshot);
  safeSet(STATE_KEY, normalized, true);
  safeSet(STATE_KEY, normalized, false);
}

export function updateState(
  update: (current: PersistedState) => PersistedState,
): PersistedState {
  const nextState = normalizeState(update(loadState()));
  saveState(nextState);
  return nextState;
}

export function persistPlayerState(input: {
  sourceDescriptor?: SourceDescriptor;
  sourceTitle?: string;
  playbackMode?: PlaybackMode;
  queue: Track[];
  currentTrackId?: string;
  playbackSnapshot?: PlaybackSnapshot | null;
}) {
  return updateState((current) => ({
    ...current,
    lastInput: input.sourceDescriptor?.input ?? current.lastInput,
    playbackMode: input.playbackMode ?? current.playbackMode,
    sourceDescriptor: input.sourceDescriptor ?? current.sourceDescriptor,
    sourceTitle: input.sourceTitle ?? current.sourceTitle,
    queue: input.queue,
    currentTrackId: input.currentTrackId,
    playbackSnapshot:
      input.playbackSnapshot === undefined
        ? current.playbackSnapshot
        : input.playbackSnapshot,
  }));
}

export function rememberRecentSource(source: SourceDescriptor) {
  return updateState((current) => ({
    ...current,
    recentSources: [source, ...(current.recentSources ?? []).filter(
      (item) => item.input !== source.input,
    )].slice(0, RECENT_SOURCE_LIMIT),
  }));
}

export function setPendingExternalCommand(
  command: PendingExternalCommand | null,
) {
  return updateState((current) => ({
    ...current,
    pendingExternalCommand: command,
  }));
}

export function clearPendingExternalCommand(commandId?: string) {
  return updateState((current) => {
    if (
      commandId &&
      current.pendingExternalCommand &&
      current.pendingExternalCommand.id !== commandId
    ) {
      return current;
    }

    return {
      ...current,
      pendingExternalCommand: null,
    };
  });
}

export function setPlaybackSnapshot(snapshot: PlaybackSnapshot | null) {
  return updateState((current) => ({
    ...current,
    playbackSnapshot: snapshot,
  }));
}

export function loadDownloads(): DownloadIndex {
  const sharedDownloads = safeGet<DownloadIndex>(DOWNLOADS_KEY, true);
  const privateDownloads = safeGet<DownloadIndex>(DOWNLOADS_KEY, false);
  const nextDownloads = sharedDownloads ?? privateDownloads ?? {};

  if (!sharedDownloads && privateDownloads) {
    safeSet(DOWNLOADS_KEY, nextDownloads, true);
  }

  return nextDownloads;
}

export function attachDownloadedPaths(tracks: Track[]) {
  const downloads = loadDownloads();
  return tracks.map((track) => ({
    ...track,
    localFilePath: downloads[track.id] ?? track.localFilePath,
  }));
}

export function rememberDownload(trackId: string, localFilePath: string) {
  const current = loadDownloads();
  current[trackId] = localFilePath;
  safeSet(DOWNLOADS_KEY, current, true);
  safeSet(DOWNLOADS_KEY, current, false);
}

function lyricLookupKeys(input: {
  id?: string;
  title?: string;
  artist?: string;
}) {
  const normalizedTitle = (input.title ?? "").trim().toLowerCase();
  const normalizedArtist = (input.artist ?? "").trim().toLowerCase();
  const fingerprint =
    normalizedTitle || normalizedArtist
      ? `song:${normalizedArtist}::${normalizedTitle}`
      : null;

  return [input.id, fingerprint].filter(Boolean) as string[];
}

export function loadLyricsIndex(): LyricsIndex {
  const sharedLyrics = safeGet<LyricsIndex>(LYRICS_KEY, true);
  const privateLyrics = safeGet<LyricsIndex>(LYRICS_KEY, false);
  const nextLyrics = sharedLyrics ?? privateLyrics ?? {};

  if (!sharedLyrics && privateLyrics) {
    safeSet(LYRICS_KEY, nextLyrics, true);
  }

  return nextLyrics;
}

function normalizeLyricsEntry(
  value: string | TrackLyricsEntry | null | undefined,
): TrackLyricsEntry | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return {
      rawLyric: value,
      updatedAt: new Date().toISOString(),
    };
  }

  if (typeof value !== "object") {
    return null;
  }

  return {
    rawLyric: typeof value.rawLyric === "string" ? value.rawLyric : "",
    songMid: typeof value.songMid === "string" ? value.songMid : undefined,
    selectedLabel:
      typeof value.selectedLabel === "string" ? value.selectedLabel : undefined,
    searchKey: typeof value.searchKey === "string" ? value.searchKey : undefined,
    updatedAt:
      typeof value.updatedAt === "string"
        ? value.updatedAt
        : new Date().toISOString(),
  };
}

function normalizeLyricsIndex(index: LyricsIndex) {
  const nextIndex: Record<string, TrackLyricsEntry> = {};
  let changed = false;

  for (const [key, value] of Object.entries(index)) {
    const entry = normalizeLyricsEntry(value);
    if (!entry) {
      changed = true;
      continue;
    }

    if (typeof value === "string") {
      changed = true;
    }

    nextIndex[key] = entry;
  }

  return {
    nextIndex,
    changed,
  };
}

function saveLyricsIndex(index: Record<string, TrackLyricsEntry>) {
  safeSet(LYRICS_KEY, index, true);
  safeSet(LYRICS_KEY, index, false);
}

export function loadTrackLyricsEntry(input: {
  id?: string;
  title?: string;
  artist?: string;
}) {
  const lyricsIndex = loadLyricsIndex();
  const { nextIndex, changed } = normalizeLyricsIndex(lyricsIndex);

  if (changed) {
    saveLyricsIndex(nextIndex);
  }

  for (const key of lyricLookupKeys(input)) {
    const entry = nextIndex[key];
    if (entry) {
      return entry;
    }
  }

  return null;
}

export function loadTrackLyrics(input: {
  id?: string;
  title?: string;
  artist?: string;
}) {
  return loadTrackLyricsEntry(input)?.rawLyric ?? "";
}

export function saveTrackLyricsEntry(
  input: {
    id?: string;
    title?: string;
    artist?: string;
  },
  entry: Omit<TrackLyricsEntry, "updatedAt"> & { updatedAt?: string },
) {
  const { nextIndex } = normalizeLyricsIndex(loadLyricsIndex());
  const normalizedEntry: TrackLyricsEntry = {
    rawLyric: entry.rawLyric,
    songMid: entry.songMid,
    selectedLabel: entry.selectedLabel,
    searchKey: entry.searchKey,
    updatedAt: entry.updatedAt ?? new Date().toISOString(),
  };

  for (const key of lyricLookupKeys(input)) {
    nextIndex[key] = normalizedEntry;
  }

  saveLyricsIndex(nextIndex);
}

export function saveTrackLyrics(
  input: {
    id?: string;
    title?: string;
    artist?: string;
  },
  rawLyrics: string,
) {
  saveTrackLyricsEntry(input, { rawLyric: rawLyrics });
}

export function clearTrackLyrics(input: {
  id?: string;
  title?: string;
  artist?: string;
}) {
  const { nextIndex } = normalizeLyricsIndex(loadLyricsIndex());
  for (const key of lyricLookupKeys(input)) {
    delete nextIndex[key];
  }

  saveLyricsIndex(nextIndex);
}
