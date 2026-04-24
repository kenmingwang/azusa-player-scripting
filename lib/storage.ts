import { IntentMemoryStorage, Storage } from "scripting";

import { coerceSourceDescriptor, parseSourceInput } from "./sources";
import type {
  PendingExternalCommand,
  PlaybackMode,
  PersistedState,
  PlaybackSnapshot,
  PlayerSettings,
  PlaylistKind,
  PlaylistRecord,
  PlaylistTableState,
  SourceDescriptor,
  Track,
  TrackLyricsEntry,
} from "./types";

const STATE_KEY = "azusa.scripting.poc.state";
const DOWNLOADS_KEY = "azusa.scripting.poc.downloads";
const LYRICS_KEY = "azusa.scripting.poc.lyrics";
const IMMEDIATE_SNAPSHOT_KEY = "azusa.scripting.poc.snapshot.immediate";
const DEFAULT_SOURCE_INPUT = "BV1wr4y1v7TA";
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
  playlistLibrary: [],
  playerSettings: {},
};

const globalRuntime = globalThis as any;
const storageApi = (Storage as any) ?? globalRuntime.Storage;
const intentMemoryStorageApi =
  (IntentMemoryStorage as any) ?? globalRuntime.IntentMemoryStorage;
const memoryStore = new Map<string, unknown>();

function nowIso() {
  return new Date().toISOString();
}

function createPlaylistId(prefix = "playlist") {
  return `${prefix}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

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

function normalizeTrack(value: unknown): Track | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const track = value as Partial<Track>;
  if (
    typeof track.id !== "string" ||
    typeof track.bvid !== "string" ||
    typeof track.cid !== "string" ||
    typeof track.title !== "string" ||
    typeof track.artist !== "string" ||
    typeof track.sourceTitle !== "string"
  ) {
    return null;
  }

  return {
    id: track.id,
    bvid: track.bvid,
    cid: track.cid,
    title: track.title,
    artist: track.artist,
    sourceTitle: track.sourceTitle,
    cover: typeof track.cover === "string" ? track.cover : undefined,
    streamUrl: typeof track.streamUrl === "string" ? track.streamUrl : undefined,
    backupStreamUrls: Array.isArray(track.backupStreamUrls)
      ? track.backupStreamUrls.filter((item): item is string => typeof item === "string")
      : undefined,
    localFilePath:
      typeof track.localFilePath === "string" ? track.localFilePath : undefined,
    durationSeconds:
      typeof track.durationSeconds === "number"
        ? track.durationSeconds
        : undefined,
  };
}

function normalizeTracks(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as Track[];
  }

  return value
    .map((item) => normalizeTrack(item))
    .filter((track): track is Track => Boolean(track));
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
      typeof snapshot.updatedAt === "string" ? snapshot.updatedAt : nowIso(),
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

function normalizePlayerSettings(value: unknown): PlayerSettings {
  if (!value || typeof value !== "object") {
    return {};
  }

  const settings = value as Partial<PlayerSettings>;
  return {
    lyricFontSize:
      typeof settings.lyricFontSize === "number"
        ? settings.lyricFontSize
        : undefined,
  };
}

function normalizePlaylistTableState(value: unknown): PlaylistTableState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const tableState = value as Partial<PlaylistTableState>;
  const nextState: PlaylistTableState = {};
  if (typeof tableState.filterText === "string") {
    nextState.filterText = tableState.filterText;
  }
  if (typeof tableState.highlightedTrackId === "string") {
    nextState.highlightedTrackId = tableState.highlightedTrackId;
  }

  return Object.keys(nextState).length ? nextState : undefined;
}

function normalizePlaylistRecord(
  value: unknown,
  index: number,
): PlaylistRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<PlaylistRecord>;
  const source = coerceSourceDescriptor(record.source);
  const kind =
    record.kind === "user" || record.kind === "source" || record.kind === "search"
      ? record.kind
      : source
        ? "source"
        : "user";
  const title =
    typeof record.title === "string" && record.title.trim()
      ? record.title.trim()
      : source?.titleHint || source?.input || `歌单 ${index + 1}`;

  return {
    id:
      typeof record.id === "string" && record.id
        ? record.id
        : createPlaylistId(kind),
    title,
    kind,
    source: kind === "user" ? undefined : source ?? undefined,
    ownerName: typeof record.ownerName === "string" ? record.ownerName : undefined,
    cover: typeof record.cover === "string" ? record.cover : undefined,
    tracks: normalizeTracks(record.tracks),
    updatedAt:
      typeof record.updatedAt === "string" ? record.updatedAt : nowIso(),
    tableState: normalizePlaylistTableState(record.tableState),
  };
}

function normalizePlaylistLibrary(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as PlaylistRecord[];
  }

  const normalized: PlaylistRecord[] = [];
  const seenIds = new Set<string>();
  for (const [index, item] of value.entries()) {
    const record = normalizePlaylistRecord(item, index);
    if (!record) continue;
    if (seenIds.has(record.id)) {
      record.id = createPlaylistId(record.kind);
    }
    seenIds.add(record.id);
    normalized.push(record);
  }

  return normalized;
}

function legacySourceFromState(raw: Partial<PersistedState>) {
  return (
    coerceSourceDescriptor(raw.sourceDescriptor) ??
    (typeof raw.lastInput === "string" ? parseSourceInput(raw.lastInput) : null) ??
    parseSourceInput(DEFAULT_SOURCE_INPUT)
  );
}

function createPlaylistRecord(input: {
  id?: string;
  title: string;
  kind: PlaylistKind;
  source?: SourceDescriptor;
  ownerName?: string;
  cover?: string;
  tracks?: Track[];
  tableState?: PlaylistTableState;
  updatedAt?: string;
}): PlaylistRecord {
  return {
    id: input.id ?? createPlaylistId(input.kind),
    title: input.title,
    kind: input.kind,
    source: input.kind === "user" ? undefined : input.source,
    ownerName: input.ownerName,
    cover: input.cover,
    tracks: [...(input.tracks ?? [])],
    updatedAt: input.updatedAt ?? nowIso(),
    tableState: input.tableState,
  };
}

function buildLegacyPlaylist(raw: Partial<PersistedState>, fallbackSource: SourceDescriptor) {
  const snapshot = normalizeSnapshot(raw.playbackSnapshot);
  const source = fallbackSource;
  return createPlaylistRecord({
    id: typeof raw.activePlaylistId === "string" ? raw.activePlaylistId : "source:default",
    title:
      typeof raw.sourceTitle === "string" && raw.sourceTitle
        ? raw.sourceTitle
        : snapshot?.sourceTitle || source.titleHint || source.input,
    kind: "source",
    source,
    ownerName: snapshot?.ownerName,
    cover: snapshot?.cover,
    tracks: normalizeTracks(raw.queue),
    tableState: undefined,
  });
}

function normalizeState(value: unknown): PersistedState {
  if (!value || typeof value !== "object") {
    return { ...defaultState };
  }

  const raw = value as Partial<PersistedState>;
  const legacySource = legacySourceFromState(raw);
  let playlistLibrary = normalizePlaylistLibrary(raw.playlistLibrary);

  if (!playlistLibrary.length && legacySource) {
    playlistLibrary = [buildLegacyPlaylist(raw, legacySource)];
  }

  let searchPlaylistId =
    typeof raw.searchPlaylistId === "string" ? raw.searchPlaylistId : undefined;
  if (
    searchPlaylistId &&
    !playlistLibrary.some(
      (playlist) => playlist.id === searchPlaylistId && playlist.kind === "search",
    )
  ) {
    searchPlaylistId = undefined;
  }

  if (!searchPlaylistId) {
    searchPlaylistId = playlistLibrary.find((playlist) => playlist.kind === "search")?.id;
  }

  let activePlaylistId =
    typeof raw.activePlaylistId === "string" ? raw.activePlaylistId : undefined;
  if (!activePlaylistId || !playlistLibrary.some((playlist) => playlist.id === activePlaylistId)) {
    activePlaylistId = playlistLibrary[0]?.id;
  }

  const activePlaylist = activePlaylistId
    ? playlistLibrary.find((playlist) => playlist.id === activePlaylistId)
    : undefined;
  const sourceDescriptor = activePlaylist?.source ?? legacySource ?? undefined;
  const queue = normalizeTracks(raw.queue);

  return {
    lastInput:
      activePlaylist?.source?.input ??
      (typeof raw.lastInput === "string" ? raw.lastInput : "") ??
      "",
    playbackMode:
      typeof raw.playbackMode === "string"
        ? (raw.playbackMode as PlaybackMode)
        : defaultState.playbackMode,
    sourceTitle:
      typeof raw.sourceTitle === "string"
        ? raw.sourceTitle
        : activePlaylist?.title,
    sourceDescriptor,
    recentSources: normalizeRecentSources(raw.recentSources),
    queue: queue.length ? queue : activePlaylist?.tracks ?? [],
    currentTrackId:
      typeof raw.currentTrackId === "string" ? raw.currentTrackId : undefined,
    playbackSnapshot: normalizeSnapshot(raw.playbackSnapshot),
    pendingExternalCommand: normalizePendingCommand(raw.pendingExternalCommand),
    playlistLibrary,
    activePlaylistId,
    searchPlaylistId,
    playerSettings: normalizePlayerSettings(raw.playerSettings),
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

function saveNormalizedState(nextState: PersistedState) {
  saveImmediatePlaybackSnapshot(nextState.playbackSnapshot);
  safeSet(STATE_KEY, nextState, true);
  safeSet(STATE_KEY, nextState, false);
}

function mutateState(
  current: PersistedState,
  updater: (state: PersistedState) => PersistedState,
) {
  return normalizeState(updater(current));
}

function updatePlaylistInLibrary(
  library: PlaylistRecord[],
  playlistId: string,
  updater: (playlist: PlaylistRecord) => PlaylistRecord,
) {
  return library.map((playlist) =>
    playlist.id === playlistId ? updater(playlist) : playlist,
  );
}

function dedupeTracks(existing: Track[], incoming: Track[]) {
  const next = [...existing];
  const known = new Set(existing.map((track) => track.id));
  for (const track of incoming) {
    if (known.has(track.id)) {
      continue;
    }
    next.push(track);
    known.add(track.id);
  }
  return next;
}

function sourceDescriptorEqual(
  left?: SourceDescriptor,
  right?: SourceDescriptor,
) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return !left && !right;
  }

  return (
    left.kind === right.kind &&
    left.input === right.input &&
    left.titleHint === right.titleHint
  );
}

function tracksEqual(left: Track[], right: Track[]) {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftTrack = left[index];
    const rightTrack = right[index];
    if (
      leftTrack.id !== rightTrack.id ||
      leftTrack.bvid !== rightTrack.bvid ||
      leftTrack.cid !== rightTrack.cid ||
      leftTrack.title !== rightTrack.title ||
      leftTrack.artist !== rightTrack.artist ||
      leftTrack.sourceTitle !== rightTrack.sourceTitle ||
      leftTrack.cover !== rightTrack.cover ||
      leftTrack.streamUrl !== rightTrack.streamUrl ||
      leftTrack.localFilePath !== rightTrack.localFilePath ||
      leftTrack.durationSeconds !== rightTrack.durationSeconds
    ) {
      return false;
    }

    const leftBackups = leftTrack.backupStreamUrls ?? [];
    const rightBackups = rightTrack.backupStreamUrls ?? [];
    if (leftBackups.length !== rightBackups.length) {
      return false;
    }

    for (let backupIndex = 0; backupIndex < leftBackups.length; backupIndex += 1) {
      if (leftBackups[backupIndex] !== rightBackups[backupIndex]) {
        return false;
      }
    }
  }

  return true;
}

export function loadState(): PersistedState {
  const sharedState = safeGet<PersistedState>(STATE_KEY, true);
  const privateState = safeGet<PersistedState>(STATE_KEY, false);
  const nextState = normalizeState(sharedState ?? privateState ?? defaultState);
  const immediateSnapshot = loadImmediatePlaybackSnapshot();

  if (!sharedState && privateState) {
    saveNormalizedState(nextState);
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
    nextState.playbackMode =
      immediateSnapshot.playbackMode ?? nextState.playbackMode;
  }

  return nextState;
}

export function saveState(nextState: PersistedState) {
  saveNormalizedState(normalizeState(nextState));
}

export function updateState(
  update: (current: PersistedState) => PersistedState,
): PersistedState {
  const nextState = mutateState(loadState(), update);
  saveNormalizedState(nextState);
  return nextState;
}

export function getPlaylistById(
  playlistId?: string | null,
  state = loadState(),
) {
  if (!playlistId) {
    return null;
  }

  return state.playlistLibrary.find((playlist) => playlist.id === playlistId) ?? null;
}

export function getActivePlaylist(state = loadState()) {
  return getPlaylistById(state.activePlaylistId, state);
}

export function setActivePlaylist(playlistId: string) {
  return updateState((current) => {
    const playlist = getPlaylistById(playlistId, current);
    if (!playlist) {
      return current;
    }

    return {
      ...current,
      activePlaylistId: playlist.id,
      sourceDescriptor: playlist.source ?? current.sourceDescriptor,
      sourceTitle: playlist.title,
      lastInput: playlist.source?.input ?? current.lastInput,
      queue: [...playlist.tracks],
      currentTrackId:
        playlist.tracks.some((track) => track.id === current.currentTrackId)
          ? current.currentTrackId
          : undefined,
    };
  });
}

export function createPlaylist(title: string, tracks: Track[] = []) {
  const normalizedTitle = title.trim() || "新歌单";
  let created: PlaylistRecord | null = null;

  updateState((current) => {
    created = createPlaylistRecord({
      title: normalizedTitle,
      kind: "user",
      tracks,
    });

    return {
      ...current,
      playlistLibrary: [...current.playlistLibrary, created],
      activePlaylistId: created.id,
      queue: [...tracks],
      currentTrackId:
        tracks.some((track) => track.id === current.currentTrackId)
          ? current.currentTrackId
          : undefined,
    };
  });

  return created!;
}

export function renamePlaylist(playlistId: string, title: string) {
  return updateState((current) => ({
    ...current,
    playlistLibrary: updatePlaylistInLibrary(
      current.playlistLibrary,
      playlistId,
      (playlist) => ({
        ...playlist,
        title: title.trim() || playlist.title,
        updatedAt: nowIso(),
      }),
    ),
    sourceTitle:
      current.activePlaylistId === playlistId
        ? title.trim() || current.sourceTitle
        : current.sourceTitle,
  }));
}

export function deletePlaylist(playlistId: string) {
  return updateState((current) => {
    const nextLibrary = current.playlistLibrary.filter(
      (playlist) => playlist.id !== playlistId,
    );
    const nextActivePlaylistId =
      current.activePlaylistId === playlistId
        ? nextLibrary[0]?.id
        : current.activePlaylistId;
    const nextActivePlaylist = nextActivePlaylistId
      ? nextLibrary.find((playlist) => playlist.id === nextActivePlaylistId)
      : undefined;

    return {
      ...current,
      playlistLibrary: nextLibrary,
      activePlaylistId: nextActivePlaylistId,
      searchPlaylistId:
        current.searchPlaylistId === playlistId
          ? nextLibrary.find((playlist) => playlist.kind === "search")?.id
          : current.searchPlaylistId,
      sourceDescriptor: nextActivePlaylist?.source ?? current.sourceDescriptor,
      sourceTitle: nextActivePlaylist?.title ?? current.sourceTitle,
      lastInput: nextActivePlaylist?.source?.input ?? current.lastInput,
      queue: nextActivePlaylist?.tracks ?? [],
      currentTrackId:
        nextActivePlaylist?.tracks.some((track) => track.id === current.currentTrackId)
          ? current.currentTrackId
          : undefined,
    };
  });
}

export function replacePlaylistRecord(record: PlaylistRecord, activate = false) {
  return updateState((current) => {
    const exists = current.playlistLibrary.some(
      (playlist) => playlist.id === record.id,
    );
    const nextLibrary = exists
      ? current.playlistLibrary.map((playlist) =>
          playlist.id === record.id ? record : playlist,
        )
      : [...current.playlistLibrary, record];
    const nextActive = activate ? record.id : current.activePlaylistId;

    return {
      ...current,
      playlistLibrary: nextLibrary,
      activePlaylistId: nextActive,
      searchPlaylistId:
        record.kind === "search"
          ? record.id
          : current.searchPlaylistId,
      sourceDescriptor:
        activate && record.source ? record.source : current.sourceDescriptor,
      sourceTitle: activate ? record.title : current.sourceTitle,
      lastInput:
        activate && record.source?.input
          ? record.source.input
          : current.lastInput,
      queue: activate ? [...record.tracks] : current.queue,
      currentTrackId:
        activate && !record.tracks.some((track) => track.id === current.currentTrackId)
          ? undefined
          : current.currentTrackId,
    };
  });
}

export function saveSourcePlaylist(input: {
  playlistId?: string;
  title: string;
  source: SourceDescriptor;
  ownerName?: string;
  cover?: string;
  tracks: Track[];
  activate?: boolean;
}) {
  const record = createPlaylistRecord({
    id: input.playlistId,
    title: input.title,
    kind: "source",
    source: input.source,
    ownerName: input.ownerName,
    cover: input.cover,
    tracks: input.tracks,
  });
  return replacePlaylistRecord(record, input.activate);
}

export function saveSearchPlaylist(input: {
  title: string;
  source?: SourceDescriptor;
  ownerName?: string;
  cover?: string;
  tracks: Track[];
  activate?: boolean;
}) {
  const current = loadState();
  const existing = current.searchPlaylistId
    ? getPlaylistById(current.searchPlaylistId, current)
    : current.playlistLibrary.find((playlist) => playlist.kind === "search");
  const record = createPlaylistRecord({
    id: existing?.id ?? current.searchPlaylistId ?? createPlaylistId("search"),
    title: input.title,
    kind: "search",
    source: input.source,
    ownerName: input.ownerName,
    cover: input.cover,
    tracks: input.tracks,
    tableState: existing?.tableState,
  });

  return replacePlaylistRecord(record, input.activate ?? true);
}

export function replacePlaylistTracks(playlistId: string, tracks: Track[]) {
  return updateState((current) => ({
    ...current,
    playlistLibrary: updatePlaylistInLibrary(
      current.playlistLibrary,
      playlistId,
      (playlist) => ({
        ...playlist,
        tracks: [...tracks],
        updatedAt: nowIso(),
      }),
    ),
    queue:
      current.activePlaylistId === playlistId ? [...tracks] : current.queue,
    currentTrackId:
      current.activePlaylistId === playlistId &&
      !tracks.some((track) => track.id === current.currentTrackId)
        ? undefined
        : current.currentTrackId,
  }));
}

export function setPlaylistTableState(
  playlistId: string,
  tableState: PlaylistTableState,
) {
  return updateState((current) => ({
    ...current,
    playlistLibrary: updatePlaylistInLibrary(
      current.playlistLibrary,
      playlistId,
      (playlist) => ({
        ...playlist,
        tableState: {
          ...playlist.tableState,
          ...tableState,
        },
      }),
    ),
  }));
}

export function addTracksToPlaylist(playlistId: string, tracks: Track[]) {
  return updateState((current) => ({
    ...current,
    playlistLibrary: updatePlaylistInLibrary(
      current.playlistLibrary,
      playlistId,
      (playlist) => ({
        ...playlist,
        tracks: dedupeTracks(playlist.tracks, tracks),
        updatedAt: nowIso(),
      }),
    ),
  }));
}

export function deleteTracksFromPlaylist(playlistId: string, trackIds: string[]) {
  const removing = new Set(trackIds);
  return updateState((current) => {
    const nextLibrary = updatePlaylistInLibrary(
      current.playlistLibrary,
      playlistId,
      (playlist) => ({
        ...playlist,
        tracks: playlist.tracks.filter((track) => !removing.has(track.id)),
        updatedAt: nowIso(),
      }),
    );
    const nextActive =
      current.activePlaylistId === playlistId
        ? nextLibrary.find((playlist) => playlist.id === playlistId)
        : null;

    return {
      ...current,
      playlistLibrary: nextLibrary,
      queue:
        current.activePlaylistId === playlistId
          ? nextActive?.tracks ?? []
          : current.queue,
      currentTrackId:
        removing.has(current.currentTrackId ?? "")
          ? undefined
          : current.currentTrackId,
    };
  });
}

export function renameTrackInPlaylist(
  playlistId: string,
  trackId: string,
  title: string,
) {
  return updateState((current) => ({
    ...current,
    playlistLibrary: updatePlaylistInLibrary(
      current.playlistLibrary,
      playlistId,
      (playlist) => ({
        ...playlist,
        tracks: playlist.tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                title: title.trim() || track.title,
              }
            : track,
        ),
        updatedAt: nowIso(),
      }),
    ),
    queue:
      current.activePlaylistId === playlistId
        ? current.queue.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  title: title.trim() || track.title,
                }
              : track,
          )
        : current.queue,
  }));
}

export function setPlayerSettings(settings: Partial<PlayerSettings>) {
  return updateState((current) => ({
    ...current,
    playerSettings: {
      ...current.playerSettings,
      ...settings,
    },
  }));
}

export function persistPlayerState(input: {
  sourceDescriptor?: SourceDescriptor;
  sourceTitle?: string;
  playbackMode?: PlaybackMode;
  queue: Track[];
  currentTrackId?: string;
  playbackSnapshot?: PlaybackSnapshot | null;
}) {
  return updateState((current) => {
    const activePlaylist = getActivePlaylist(current);
    const nextTitle =
      activePlaylist?.kind === "user"
        ? activePlaylist.title
        : input.sourceTitle ?? activePlaylist?.title;
    const nextSource =
      activePlaylist?.kind === "user"
        ? undefined
        : input.sourceDescriptor ?? activePlaylist?.source;
    const nextOwnerName =
      input.playbackSnapshot?.ownerName ?? activePlaylist?.ownerName;
    const nextCover = input.playbackSnapshot?.cover ?? activePlaylist?.cover;
    const shouldUpdateActivePlaylist =
      Boolean(activePlaylist) &&
      (!tracksEqual(activePlaylist?.tracks ?? [], input.queue) ||
        (activePlaylist?.title ?? "") !== (nextTitle ?? "") ||
        !sourceDescriptorEqual(activePlaylist?.source, nextSource) ||
        (activePlaylist?.ownerName ?? "") !== (nextOwnerName ?? "") ||
        (activePlaylist?.cover ?? "") !== (nextCover ?? ""));
    const nextLibrary =
      activePlaylist && shouldUpdateActivePlaylist
        ? updatePlaylistInLibrary(
            current.playlistLibrary,
            activePlaylist.id,
            (playlist) => ({
              ...playlist,
              tracks: [...input.queue],
              title: nextTitle ?? playlist.title,
              source: nextSource,
              ownerName: nextOwnerName,
              cover: nextCover,
              updatedAt: nowIso(),
            }),
          )
        : current.playlistLibrary;

    return {
      ...current,
      lastInput: input.sourceDescriptor?.input ?? current.lastInput,
      playbackMode: input.playbackMode ?? current.playbackMode,
      sourceDescriptor: input.sourceDescriptor ?? current.sourceDescriptor,
      sourceTitle: input.sourceTitle ?? current.sourceTitle,
      queue: [...input.queue],
      currentTrackId: input.currentTrackId,
      playbackSnapshot:
        input.playbackSnapshot === undefined
          ? current.playbackSnapshot
          : input.playbackSnapshot,
      playlistLibrary: nextLibrary,
    };
  });
}

export function persistPlaybackSnapshot(input: {
  sourceDescriptor?: SourceDescriptor;
  sourceTitle?: string;
  playbackMode?: PlaybackMode;
  currentTrackId?: string;
  playbackSnapshot?: PlaybackSnapshot | null;
}) {
  const current = loadState();
  const playbackSnapshot =
    input.playbackSnapshot === undefined
      ? current.playbackSnapshot
      : input.playbackSnapshot;

  if (input.playbackSnapshot !== undefined) {
    saveImmediatePlaybackSnapshot(playbackSnapshot);
  }

  return normalizeState({
    ...current,
    lastInput: input.sourceDescriptor?.input ?? current.lastInput,
    playbackMode:
      input.playbackMode ??
      playbackSnapshot?.playbackMode ??
      current.playbackMode,
    sourceDescriptor:
      input.sourceDescriptor ?? playbackSnapshot?.source ?? current.sourceDescriptor,
    sourceTitle:
      input.sourceTitle ?? playbackSnapshot?.sourceTitle ?? current.sourceTitle,
    currentTrackId: input.currentTrackId ?? playbackSnapshot?.currentTrack?.id,
    playbackSnapshot,
  });
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
      offsetMs: 0,
      sourceKind: "local",
      updatedAt: nowIso(),
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
    offsetMs: typeof value.offsetMs === "number" ? value.offsetMs : 0,
    sourceKind:
      value.sourceKind === "local" ||
      value.sourceKind === "qq-auto" ||
      value.sourceKind === "qq-manual"
        ? value.sourceKind
        : typeof value.songMid === "string"
          ? "qq-manual"
          : "local",
    updatedAt:
      typeof value.updatedAt === "string" ? value.updatedAt : nowIso(),
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

    if (typeof value === "string" || entry.offsetMs == null || !entry.sourceKind) {
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
    offsetMs: entry.offsetMs ?? 0,
    sourceKind: entry.sourceKind ?? (entry.songMid ? "qq-manual" : "local"),
    updatedAt: entry.updatedAt ?? nowIso(),
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
  saveTrackLyricsEntry(input, { rawLyric: rawLyrics, sourceKind: "local" });
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

export function setTrackLyricOffset(
  input: {
    id?: string;
    title?: string;
    artist?: string;
  },
  offsetMs: number,
) {
  const current = loadTrackLyricsEntry(input);
  if (!current) {
    return null;
  }

  const nextEntry: TrackLyricsEntry = {
    ...current,
    offsetMs,
    updatedAt: nowIso(),
  };
  saveTrackLyricsEntry(input, nextEntry);
  return nextEntry;
}
