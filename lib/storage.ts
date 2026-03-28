import { Storage } from "scripting";

import type { PersistedState, Track } from "./types";

const STATE_KEY = "azusa.scripting.poc.state";
const DOWNLOADS_KEY = "azusa.scripting.poc.downloads";

type DownloadIndex = Record<string, string>;

const defaultState: PersistedState = {
  lastInput: "",
  queue: [],
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

export function loadState(): PersistedState {
  return safeGet<PersistedState>(STATE_KEY) ?? defaultState;
}

export function saveState(nextState: PersistedState) {
  safeSet(STATE_KEY, nextState);
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
