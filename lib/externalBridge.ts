import { ControlWidget, Safari, Script, Widget } from "scripting";

import { setPendingExternalCommand } from "./storage";
import type {
  PendingExternalCommand,
  PendingExternalCommandType,
  PlaybackSnapshot,
  PlaybackUiState,
  SourceDescriptor,
  Track,
} from "./types";

const globalRuntime = globalThis as any;
const WidgetApi = (Widget as any) ?? globalRuntime.Widget;
const ControlWidgetApi = (ControlWidget as any) ?? globalRuntime.ControlWidget;
const SafariApi = (Safari as any) ?? globalRuntime.Safari;
const ScriptApi = (Script as any) ?? globalRuntime.Script;
const FALLBACK_SCRIPT_NAMES = [
  "Azusa Player Scripting",
  "Azusa 播放器 Scripting",
];

export type AzusaLiveActivityState = {
  title: string;
  artist: string;
  sourceTitle: string;
  playbackState: PlaybackUiState;
  queueLength: number;
  currentIndex: number;
};

function randomId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildPlaybackSnapshot(input: {
  source: SourceDescriptor;
  sourceTitle: string;
  ownerName: string;
  cover?: string;
  queue: Track[];
  currentIndex: number;
  currentTrack: Track | null;
  playbackState: PlaybackUiState;
  playbackDetail?: string;
}): PlaybackSnapshot {
  return {
    source: {
      ...input.source,
      titleHint: input.sourceTitle || input.source.titleHint,
    },
    sourceTitle: input.sourceTitle,
    ownerName: input.ownerName,
    cover: input.cover || input.currentTrack?.cover,
    queueLength: input.queue.length,
    currentIndex: input.currentIndex,
    currentTrack: input.currentTrack
      ? {
          id: input.currentTrack.id,
          title: input.currentTrack.title,
          artist: input.currentTrack.artist,
          sourceTitle: input.currentTrack.sourceTitle,
          cover: input.currentTrack.cover,
          durationSeconds: input.currentTrack.durationSeconds,
        }
      : undefined,
    playbackState: input.playbackState,
    playbackDetail: input.playbackDetail,
    updatedAt: new Date().toISOString(),
  };
}

export function toLiveActivityState(
  snapshot?: PlaybackSnapshot | null,
): AzusaLiveActivityState | null {
  if (!snapshot?.currentTrack) {
    return null;
  }

  return {
    title: snapshot.currentTrack.title,
    artist: snapshot.currentTrack.artist,
    sourceTitle: snapshot.sourceTitle,
    playbackState: snapshot.playbackState,
    queueLength: snapshot.queueLength,
    currentIndex: snapshot.currentIndex,
  };
}

export function reloadExternalSurfaces() {
  try {
    WidgetApi?.reloadAll?.();
  } catch {}

  try {
    ControlWidgetApi?.reloadButtons?.();
  } catch {}

  try {
    ControlWidgetApi?.reloadToggles?.();
  } catch {}
}

export function createPendingExternalCommand(input: {
  type: PendingExternalCommandType;
  source?: SourceDescriptor;
  requestedFrom?: string;
}): PendingExternalCommand {
  return {
    id: randomId(),
    type: input.type,
    source: input.source,
    createdAt: new Date().toISOString(),
    requestedFrom: input.requestedFrom,
  };
}

export function queueExternalCommand(input: {
  type: PendingExternalCommandType;
  source?: SourceDescriptor;
  requestedFrom?: string;
}) {
  const command = createPendingExternalCommand(input);
  setPendingExternalCommand(command);
  reloadExternalSurfaces();
  return command;
}

export async function foregroundAzusa(queryParameters?: Record<string, unknown>) {
  const scriptNames = [
    ScriptApi?.name,
    ScriptApi?.metadata?.localizedName,
    ...(ScriptApi?.metadata?.localizedNames
      ? Object.values(ScriptApi.metadata.localizedNames)
      : []),
    ...FALLBACK_SCRIPT_NAMES,
  ].filter((value, index, list) => typeof value === "string" && value && list.indexOf(value) === index);

  try {
    if (SafariApi?.openURL) {
      for (const scriptName of scriptNames) {
        const runSingleURL = ScriptApi?.createRunSingleURLScheme?.(
          scriptName,
          queryParameters,
        );
        if (runSingleURL && (await SafariApi.openURL(runSingleURL))) {
          return true;
        }

        const runURL = ScriptApi?.createRunURLScheme?.(
          scriptName,
          queryParameters,
        );
        if (runURL && (await SafariApi.openURL(runURL))) {
          return true;
        }
      }
    }
  } catch {}

  try {
    if (ScriptApi?.run) {
      for (const scriptName of scriptNames) {
        await ScriptApi.run({
          name: scriptName,
          queryParameters,
          singleMode: true,
        });
        return true;
      }
    }
  } catch {}

  return false;
}
