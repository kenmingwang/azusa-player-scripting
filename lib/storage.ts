import { Storage } from "scripting";

import { coerceSourceDescriptor, parseSourceInput } from "./sources";
import type {
  PendingExternalCommand,
  PersistedState,
  PlaybackSnapshot,
  SourceDescriptor,
  Track,
} from "./types";

const STATE_KEY = "azusa.scripting.poc.state";
const DOWNLOADS_KEY = "azusa.scripting.poc.downloads";
const RECENT_SOURCE_LIMIT = 8;

type DownloadIndex = Record<string, string>;

const defaultState: PersistedState = {
  lastInput: "",
  queue: [],
  recentSources: [],
  playbackSnapshot: null,
  pendingExternalCommand: null,
};

const globalRuntime = globalThis as any;
const storageApi = (Storage as any) ?? globalRuntime.Storage;
const memoryStore = new Map<string, unknown>();

function safeGet<T>(key: string): T | null {
  try {
    if (storageApi?.get) {
      return (storageApi.get(key) as T | null) ?? null;
    }
  } catch {}

  return (memoryStore.get(key) as T | null) ?? null;
}

function safeSet<T>(key: string, value: T) {
  try {
    if (storageApi?.set) {
      storageApi.set(key, value);
      return;
    }
  } catch {}

  memoryStore.set(key, value);
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
  return normalizeState(safeGet<PersistedState>(STATE_KEY) ?? defaultState);
}

export function saveState(nextState: PersistedState) {
  safeSet(STATE_KEY, normalizeState(nextState));
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
  queue: Track[];
  currentTrackId?: string;
  playbackSnapshot?: PlaybackSnapshot | null;
}) {
  return updateState((current) => ({
    ...current,
    lastInput: input.sourceDescriptor?.input ?? current.lastInput,
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
  return safeGet<DownloadIndex>(DOWNLOADS_KEY) ?? {};
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
  safeSet(DOWNLOADS_KEY, current);
}
