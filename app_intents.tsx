import { AppIntentManager, AppIntentProtocol, Script } from "scripting";

import {
  buildPlaybackSnapshot,
  foregroundAzusa,
  queueExternalCommand,
  reloadExternalSurfaces,
} from "./lib/externalBridge";
import { getSharedPlayer } from "./lib/player";
import {
  loadState,
  persistPlayerState,
} from "./lib/storage";
import { parseSourceInput } from "./lib/sources";
import type { PlaybackUiState, Track } from "./lib/types";

const globalRuntime = globalThis as any;
const setTimeoutApi =
  typeof globalRuntime.setTimeout === "function"
    ? globalRuntime.setTimeout.bind(globalRuntime)
    : null;

function hasPlayableSnapshot() {
  const state = loadState();
  return Boolean(
    state.playbackSnapshot?.currentTrack ||
      state.playbackSnapshot?.queueLength ||
      state.queue.length,
  );
}

async function tryDirectTransportControl(
  type: "playPause" | "next" | "previous",
) {
  const state = loadState();
  const source = state.sourceDescriptor ?? state.playbackSnapshot?.source;
  if (!source || !state.queue.length) {
    return false;
  }

  const player = getSharedPlayer();
  let queue = [...state.queue];
  let currentTrackId =
    state.currentTrackId ?? state.playbackSnapshot?.currentTrack?.id;
  let currentIndex =
    typeof state.playbackSnapshot?.currentIndex === "number"
      ? state.playbackSnapshot.currentIndex
      : currentTrackId
        ? queue.findIndex((track) => track.id === currentTrackId)
        : -1;
  let currentTrack =
    currentIndex >= 0 ? queue[currentIndex] ?? null : null;
  let playbackState =
    state.playbackSnapshot?.playbackState ?? ("idle" as PlaybackUiState);
  let playbackDetail = state.playbackSnapshot?.playbackDetail ?? "";
  let failed = false;

  const syncCurrent = (nextQueue: Track[]) => {
    queue = [...nextQueue];
    if (currentTrackId) {
      currentIndex = queue.findIndex((track) => track.id === currentTrackId);
      currentTrack = currentIndex >= 0 ? queue[currentIndex] ?? null : null;
      return;
    }
    currentTrack = currentIndex >= 0 ? queue[currentIndex] ?? null : null;
  };

  player.bind({
    onQueueChange: (nextQueue) => {
      syncCurrent(nextQueue);
    },
    onCurrentTrackChange: (track, index) => {
      currentTrack = track;
      currentIndex = index;
      currentTrackId = track?.id;
    },
    onStateChange: (nextState, detail) => {
      playbackState = nextState;
      playbackDetail = detail ?? "";
    },
    onError: () => {
      failed = true;
    },
  });

  try {
    player.setQueue(queue, currentTrackId ?? null);

    if (type === "playPause") {
      if (currentTrackId || currentIndex >= 0) {
        await player.toggle();
      } else {
        await player.playIndex(0);
      }
    } else if (type === "next") {
      await player.skip(1);
    } else {
      await player.skip(-1);
    }

    if (playbackState === "loading") {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (player.getPlaybackState() !== "loading") {
          break;
        }
        if (!setTimeoutApi) {
          break;
        }
        await new Promise<void>((resolve) => {
          setTimeoutApi(resolve, 180);
        });
      }
    }

    syncCurrent(player.getQueue());
    if (!currentTrack && currentTrackId) {
      currentIndex = queue.findIndex((track) => track.id === currentTrackId);
      currentTrack = currentIndex >= 0 ? queue[currentIndex] ?? null : null;
    }

    playbackState = player.getPlaybackState();
    playbackDetail = player.getPlaybackDetail();

    const snapshot = buildPlaybackSnapshot({
      source,
      sourceTitle:
        state.playbackSnapshot?.sourceTitle ??
        state.sourceTitle ??
        currentTrack?.sourceTitle ??
        source.titleHint ??
        "Azusa",
      ownerName:
        state.playbackSnapshot?.ownerName ??
        currentTrack?.artist ??
        "",
      cover:
        state.playbackSnapshot?.cover ??
        currentTrack?.cover,
      queue,
      currentIndex,
      currentTrack,
      playbackState,
      playbackDetail,
    });

    persistPlayerState({
      sourceDescriptor: source,
      sourceTitle: snapshot.sourceTitle,
      queue,
      currentTrackId,
      playbackSnapshot: snapshot,
    });
    reloadExternalSurfaces();
    return !failed;
  } catch {
    return false;
  } finally {
    player.bind({});
  }
}

async function handoffToAzusa(type: "playPause" | "next" | "previous" | "openApp") {
  if (
    type === "playPause" ||
    type === "next" ||
    type === "previous"
  ) {
    if (await tryDirectTransportControl(type)) {
      return;
    }
  }

  queueExternalCommand({
    type,
    requestedFrom: Script.env,
  });

  if (
    type === "openApp" ||
    !hasPlayableSnapshot()
  ) {
    await foregroundAzusa({
      externalCommand: type,
      requestedAt: Date.now(),
    });
  }
}

export const TogglePlaybackIntent = AppIntentManager.register({
  name: "AzusaTogglePlaybackIntent",
  protocol: AppIntentProtocol.AudioPlaybackIntent,
  perform: async () => {
    await handoffToAzusa("playPause");
  },
});

export const NextTrackIntent = AppIntentManager.register({
  name: "AzusaNextTrackIntent",
  protocol: AppIntentProtocol.AudioPlaybackIntent,
  perform: async () => {
    await handoffToAzusa("next");
  },
});

export const PreviousTrackIntent = AppIntentManager.register({
  name: "AzusaPreviousTrackIntent",
  protocol: AppIntentProtocol.AudioPlaybackIntent,
  perform: async () => {
    await handoffToAzusa("previous");
  },
});

export const OpenAzusaIntent = AppIntentManager.register({
  name: "AzusaOpenIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async () => {
    await handoffToAzusa("openApp");
  },
});

export const OpenAzusaSourceIntent = AppIntentManager.register({
  name: "AzusaOpenSourceIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async ({ input }: { input: string }) => {
    const source = parseSourceInput(input);

    queueExternalCommand({
      type: source ? "openSource" : "openApp",
      source: source ?? undefined,
      requestedFrom: Script.env,
    });

    await foregroundAzusa({
      externalCommand: source ? "openSource" : "openApp",
      sourceInput: input,
      requestedAt: Date.now(),
    });
  },
});
