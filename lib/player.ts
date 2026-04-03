import {
  AVPlayer,
  Data,
  FileManager,
  MediaPlayer,
  SharedAudioSession,
  TimeControlStatus,
  UIImage,
} from "scripting";

import { requestHeaders, resolveTrackStream } from "./api";
import type {
  PlaybackMode,
  PlaybackProgressSnapshot,
  PlaybackUiState,
  Track,
} from "./types";

type PlayerBindings = {
  onQueueChange?: (queue: Track[]) => void;
  onCurrentTrackChange?: (track: Track | null, index: number) => void;
  onStateChange?: (state: PlaybackUiState, detail?: string) => void;
  onError?: (message: string) => void;
};

const nativePlayerUnsupportedMessage =
  "当前 Scripting 版本没有可用的 AVPlayer。请先把 Scripting 更新到支持 Audio Player API 的版本，再重新导入这个项目。";

const globalRuntime = globalThis as any;
const AVPlayerCtor = (AVPlayer as any) ?? globalRuntime.AVPlayer;
const SharedAudioSessionApi =
  (SharedAudioSession as any) ?? globalRuntime.SharedAudioSession;
const MediaPlayerApi = (MediaPlayer as any) ?? globalRuntime.MediaPlayer;
const TimeControlStatusApi =
  (TimeControlStatus as any) ?? globalRuntime.TimeControlStatus;
const DataApi = (Data as any) ?? globalRuntime.Data;
const UIImageApi = (UIImage as any) ?? globalRuntime.UIImage;
const setIntervalApi =
  typeof globalRuntime.setInterval === "function"
    ? globalRuntime.setInterval.bind(globalRuntime)
    : null;
const clearIntervalApi =
  typeof globalRuntime.clearInterval === "function"
    ? globalRuntime.clearInterval.bind(globalRuntime)
    : null;

const hasNativeAudioPlayer = () => typeof AVPlayerCtor === "function";

const mapStatus = (status: any): PlaybackUiState => {
  switch (status) {
    case TimeControlStatusApi?.playing:
      return "playing";
    case TimeControlStatusApi?.waitingToPlayAtSpecifiedRate:
      return "loading";
    case TimeControlStatusApi?.paused:
    default:
      return "paused";
  }
};

class AzusaScriptingPlayer {
  private player: any | null = null;
  private queue: Track[] = [];
  private currentIndex = -1;
  private loadedTrackId?: string;
  private activeTrackId?: string;
  private sourceCandidates: string[] = [];
  private sourceAttemptIndex = 0;
  private sourceRefreshCount = 0;
  private playbackMode: PlaybackMode = "normal";
  private playbackState: PlaybackUiState = "idle";
  private playbackDetail = "";
  private bindings: PlayerBindings = {};
  private updateTimer?: number;
  private loadToken = 0;
  private artworkCache = new Map<string, any | null>();
  private artworkRequests = new Map<string, Promise<any | null>>();
  private progressListeners = new Set<
    (snapshot: PlaybackProgressSnapshot) => void
  >();
  private lastNowPlayingSecond = -1;
  private progressTrackId?: string;
  private progressAnchorTime = 0;
  private progressAnchorAt = 0;

  constructor() {
    this.setupMediaCommands();
  }

  bind(bindings: PlayerBindings) {
    this.bindings = bindings;
  }

  setQueue(queue: Track[], currentTrackId?: string | null) {
    const targetTrackId =
      currentTrackId === undefined ? this.getCurrentTrack()?.id : currentTrackId;
    this.queue = [...queue];
    const nextIndex = targetTrackId
      ? this.queue.findIndex((track) => track.id === targetTrackId)
      : -1;

    if (nextIndex !== this.currentIndex) {
      this.currentIndex = nextIndex;
      this.bindings.onCurrentTrackChange?.(
        nextIndex >= 0 ? this.queue[nextIndex] : null,
        nextIndex,
      );
      this.emitProgress(true);
    }
  }

  getQueue() {
    return [...this.queue];
  }

  getCurrentTrack() {
    return this.currentIndex >= 0 ? this.queue[this.currentIndex] ?? null : null;
  }

  getCurrentIndex() {
    return this.currentIndex;
  }

  private readNativeCurrentTime() {
    return this.player?.currentTime ?? 0;
  }

  getCurrentTime() {
    return this.getProgressSnapshot().currentTime;
  }

  getDuration() {
    return this.player?.duration ?? 0;
  }

  getProgressSnapshot(): PlaybackProgressSnapshot {
    const currentTrack = this.getCurrentTrack();
    const isLoadedCurrentTrack =
      Boolean(currentTrack?.id) && this.loadedTrackId === currentTrack?.id;
    const duration = currentTrack?.durationSeconds ?? this.getDuration() ?? 0;
    let currentTime = 0;

    if (this.progressTrackId && currentTrack?.id === this.progressTrackId) {
      currentTime = this.progressAnchorTime;

      if (
        this.playbackState === "playing" &&
        this.progressAnchorAt > 0
      ) {
        currentTime += (Date.now() - this.progressAnchorAt) / 1000;
      }
    } else if (isLoadedCurrentTrack) {
      currentTime = this.readNativeCurrentTime();
    }

    return {
      currentTime:
        duration > 0
          ? Math.max(0, Math.min(currentTime, duration))
          : Math.max(0, currentTime),
      duration,
    };
  }

  subscribeProgress(
    listener: (snapshot: PlaybackProgressSnapshot) => void,
  ) {
    this.progressListeners.add(listener);
    listener(this.getProgressSnapshot());

    return () => {
      this.progressListeners.delete(listener);
    };
  }

  getPlaybackState() {
    return this.playbackState;
  }

  getPlaybackMode() {
    return this.playbackMode;
  }

  getPlaybackDetail() {
    return this.playbackDetail;
  }

  setPlaybackMode(mode: PlaybackMode) {
    this.playbackMode = mode;
  }

  async playIndex(index: number) {
    this.ensurePlayer();

    if (index < 0 || index >= this.queue.length) {
      return;
    }

    const loadToken = ++this.loadToken;
    this.currentIndex = index;
    this.progressTrackId = this.queue[index]?.id;
    this.progressAnchorTime = 0;
    this.progressAnchorAt = 0;
    this.bindings.onCurrentTrackChange?.(this.queue[index], this.currentIndex);
    this.emitState("loading", "正在准备播放");
    this.emitProgress(true);

    await SharedAudioSessionApi.setCategory("playback");
    await SharedAudioSessionApi.setActive(true);

    let track = this.queue[index];
    track = await this.prepareTrackForPlayback(track);
    this.queue[index] = track;
    this.bindings.onQueueChange?.([...this.queue]);

    if (!this.loadPreparedTrack(track)) {
      throw new Error("播放器无法装载音频源");
    }

    this.player!.onReadyToPlay = () => {
      if (loadToken !== this.loadToken) return;
      this.startProgressClock(this.readNativeCurrentTime());
      this.player!.play();
      this.emitState("playing");
      this.bindings.onCurrentTrackChange?.(this.queue[this.currentIndex], this.currentIndex);
    };
  }

  pause() {
    if (!this.player) return;
    this.freezeProgressClock();
    this.player.pause();
    this.emitState("paused");
  }

  async resume() {
    if (!this.getCurrentTrack()) return;

    if (!this.player || this.loadedTrackId !== this.getCurrentTrack()?.id) {
      if (this.currentIndex >= 0) {
        await this.playIndex(this.currentIndex);
      }
      return;
    }

    this.startProgressClock();
    this.player.play();
    this.emitState("playing");
  }

  async toggle() {
    if (this.player?.timeControlStatus === TimeControlStatusApi?.playing) {
      this.pause();
    } else {
      await this.resume();
    }
  }

  async skip(delta: number) {
    const nextIndex = this.resolveManualSkipIndex(delta);
    if (nextIndex < 0) {
      this.pause();
      return;
    }
    await this.playIndex(nextIndex);
  }

  stop() {
    if (!this.player) return;
    this.player.stop();
    this.loadedTrackId = undefined;
    this.activeTrackId = undefined;
    this.progressTrackId = undefined;
    this.progressAnchorTime = 0;
    this.progressAnchorAt = 0;
    this.sourceCandidates = [];
    this.sourceAttemptIndex = 0;
    this.sourceRefreshCount = 0;
    this.stopTicker();
    this.emitState("paused");
    this.emitProgress(true);
    if (MediaPlayerApi) {
      MediaPlayerApi.nowPlayingInfo = null;
    }
  }

  dispose() {
    this.stopTicker();
    if (this.player) {
      this.player.stop();
      this.player.dispose();
    }
    this.loadedTrackId = undefined;
    this.activeTrackId = undefined;
    this.progressTrackId = undefined;
    this.progressAnchorTime = 0;
    this.progressAnchorAt = 0;
    this.sourceCandidates = [];
    this.sourceAttemptIndex = 0;
    this.sourceRefreshCount = 0;
    if (MediaPlayerApi) {
      MediaPlayerApi.nowPlayingInfo = null;
    }
    this.emitProgress(true);
  }

  private emitState(state: PlaybackUiState, detail?: string) {
    this.playbackState = state;
    this.playbackDetail = detail ?? "";
    if (state === "playing") {
      this.startProgressClock();
      this.startTicker();
    } else {
      this.freezeProgressClock();
      this.stopTicker();
    }
    this.bindings.onStateChange?.(state, detail);
    this.emitProgress(true);
  }

  private setupMediaCommands() {
    if (!MediaPlayerApi) return;
    MediaPlayerApi.setAvailableCommands?.([
      "play",
      "pause",
      "nextTrack",
      "previousTrack",
    ]);
    MediaPlayerApi.commandHandler = (command: string) => {
      if (command === "play") {
        void this.resume();
      } else if (command === "pause") {
        this.pause();
      } else if (command === "nextTrack") {
        void this.skip(1);
      } else if (command === "previousTrack") {
        void this.skip(-1);
      }
    };
  }

  private ensurePlayer() {
    if (this.player) return this.player;
    if (!hasNativeAudioPlayer()) {
      throw new Error(nativePlayerUnsupportedMessage);
    }

    this.player = new AVPlayerCtor();
    this.player.onTimeControlStatusChanged = (status: any) => {
      this.emitState(mapStatus(status));
    };

    this.player.onEnded = () => {
      void this.handleTrackEnded();
    };

    this.player.onError = (message: string) => {
      void this.handlePlaybackError(message);
    };

    return this.player;
  }

  private async handlePlaybackError(message: string) {
    if (await this.tryRecoverFromStreamError()) {
      return;
    }

    this.emitState("error", message);
    this.bindings.onError?.(message);
  }

  private async handleTrackEnded() {
    const nextIndex = this.resolveAutoAdvanceIndex();
    if (nextIndex < 0) {
      this.pause();
      return;
    }

    await this.playIndex(nextIndex);
  }

  private async prepareTrackForPlayback(
    track: Track,
    forceRefresh = false,
  ): Promise<Track> {
    if (track.localFilePath && FileManager.existsSync(track.localFilePath)) {
      return track;
    }

    if (!forceRefresh && track.streamUrl) {
      return track;
    }

    return resolveTrackStream({
      ...track,
      streamUrl: forceRefresh ? undefined : track.streamUrl,
      backupStreamUrls: forceRefresh ? undefined : track.backupStreamUrls,
    });
  }

  private collectSourceCandidates(track: Track) {
    const candidates = track.localFilePath && FileManager.existsSync(track.localFilePath)
      ? [track.localFilePath]
      : [
          track.streamUrl,
          ...(track.backupStreamUrls ?? []),
        ];

    return [...new Set(candidates.filter(Boolean) as string[])];
  }

  private loadPreparedTrack(track: Track, resetRefreshCount = true) {
    this.activeTrackId = track.id;
    this.loadedTrackId = undefined;
    this.sourceCandidates = this.collectSourceCandidates(track);
    this.sourceAttemptIndex = 0;
    if (resetRefreshCount) {
      this.sourceRefreshCount = 0;
    }
    return this.tryLoadCurrentSourceCandidate();
  }

  private tryLoadCurrentSourceCandidate() {
    if (!this.player) {
      return false;
    }

    while (this.sourceAttemptIndex < this.sourceCandidates.length) {
      const source = this.sourceCandidates[this.sourceAttemptIndex];
      this.player.stop();
      const ready = this.player.setSource(source);
      if (ready) {
        this.loadedTrackId = this.activeTrackId;
        return true;
      }
      this.sourceAttemptIndex += 1;
    }

    return false;
  }

  private resolveManualSkipIndex(delta: number) {
    if (!this.queue.length) {
      return -1;
    }

    if (this.playbackMode === "shuffle") {
      return this.pickRandomQueueIndex();
    }

    const nextIndex = this.currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= this.queue.length) {
      if (this.playbackMode === "repeatAll") {
        return nextIndex < 0 ? this.queue.length - 1 : 0;
      }
      return -1;
    }

    return nextIndex;
  }

  private resolveAutoAdvanceIndex() {
    if (!this.queue.length) {
      return -1;
    }

    if (this.playbackMode === "repeatOne") {
      return this.currentIndex >= 0 ? this.currentIndex : 0;
    }

    if (this.playbackMode === "shuffle") {
      return this.pickRandomQueueIndex();
    }

    const nextIndex = this.currentIndex + 1;
    if (nextIndex < this.queue.length) {
      return nextIndex;
    }

    if (this.playbackMode === "repeatAll") {
      return 0;
    }

    return -1;
  }

  private pickRandomQueueIndex() {
    if (!this.queue.length) {
      return -1;
    }

    if (this.queue.length === 1) {
      return 0;
    }

    let nextIndex = this.currentIndex;
    while (nextIndex === this.currentIndex) {
      nextIndex = Math.floor(Math.random() * this.queue.length);
    }

    return nextIndex;
  }

  private async tryRecoverFromStreamError() {
    const currentTrack = this.getCurrentTrack();
    if (
      !this.player ||
      !currentTrack ||
      !this.activeTrackId ||
      currentTrack.id !== this.activeTrackId
    ) {
      return false;
    }

    if (this.sourceAttemptIndex + 1 < this.sourceCandidates.length) {
      this.sourceAttemptIndex += 1;
      this.emitState("loading", "音频流异常，正在切换线路");
      return this.tryLoadCurrentSourceCandidate();
    }

    const canRefreshRemoteStream =
      !(currentTrack.localFilePath && FileManager.existsSync(currentTrack.localFilePath)) &&
      this.sourceRefreshCount < 1;

    if (!canRefreshRemoteStream) {
      return false;
    }

    this.sourceRefreshCount += 1;
    this.emitState("loading", "音频流失效，正在刷新地址");

    try {
      const refreshedTrack = await this.prepareTrackForPlayback(currentTrack, true);
      this.queue[this.currentIndex] = refreshedTrack;
      this.bindings.onQueueChange?.([...this.queue]);
      return this.loadPreparedTrack(refreshedTrack, false);
    } catch (error) {
      this.playbackDetail = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  private startTicker() {
    this.stopTicker();
    if (!setIntervalApi) {
      return;
    }
    this.updateTimer = setIntervalApi(() => {
      const snapshot = this.getProgressSnapshot();
      this.emitProgress();

      const currentSecond = Math.floor(snapshot.currentTime);
      if (currentSecond !== this.lastNowPlayingSecond) {
        this.lastNowPlayingSecond = currentSecond;
        this.updateNowPlaying();
      }
    }, 400) as unknown as number;
  }

  private stopTicker() {
    if (this.updateTimer) {
      if (clearIntervalApi) {
        clearIntervalApi(this.updateTimer);
      }
      this.updateTimer = undefined;
    }
  }

  private startProgressClock(baseTime?: number) {
    const currentTrack = this.getCurrentTrack();
    if (!currentTrack) {
      return;
    }

    this.progressTrackId = currentTrack.id;
    this.progressAnchorTime =
      typeof baseTime === "number"
        ? Math.max(baseTime, 0)
        : Math.max(this.progressAnchorTime, this.readNativeCurrentTime(), 0);
    this.progressAnchorAt = Date.now();
  }

  private freezeProgressClock(baseTime?: number) {
    const currentTrack = this.getCurrentTrack();
    this.progressTrackId = currentTrack?.id;
    this.progressAnchorTime =
      typeof baseTime === "number"
        ? Math.max(baseTime, 0)
        : Math.max(this.getProgressSnapshot().currentTime, 0);
    this.progressAnchorAt = 0;
  }

  private emitProgress(forceUpdateNowPlaying = false) {
    const snapshot = this.getProgressSnapshot();
    for (const listener of this.progressListeners) {
      listener(snapshot);
    }

    if (forceUpdateNowPlaying) {
      this.lastNowPlayingSecond = Math.floor(snapshot.currentTime);
      this.updateNowPlaying();
    }
  }

  private updateNowPlaying() {
    if (!this.player || !MediaPlayerApi) return;
    const currentTrack = this.getCurrentTrack();
    if (!currentTrack) return;
    const progress = this.getProgressSnapshot();

    const artwork = this.artworkCache.get(currentTrack.id) ?? null;

    MediaPlayerApi.nowPlayingInfo = {
      title: currentTrack.title,
      artist: currentTrack.artist,
      albumTitle: currentTrack.sourceTitle,
      artwork,
      elapsedPlaybackTime: progress.currentTime,
      playbackDuration: progress.duration,
      playbackRate:
        this.player.timeControlStatus === TimeControlStatusApi?.playing ? 1.0 : 0.0,
    };

    if (!artwork && currentTrack.cover) {
      void this.prefetchArtwork(currentTrack);
    }
  }

  private async prefetchArtwork(track: Track) {
    if (!track.cover) {
      return null;
    }

    if (this.artworkCache.has(track.id)) {
      return this.artworkCache.get(track.id) ?? null;
    }

    const pendingRequest = this.artworkRequests.get(track.id);
    if (pendingRequest) {
      return pendingRequest;
    }

    const request = this.fetchArtwork(track.cover)
      .then((image) => {
        this.artworkCache.set(track.id, image);
        this.artworkRequests.delete(track.id);
        if (this.getCurrentTrack()?.id === track.id) {
          this.updateNowPlaying();
        }
        return image;
      })
      .catch(() => {
        this.artworkCache.set(track.id, null);
        this.artworkRequests.delete(track.id);
        return null;
      });

    this.artworkRequests.set(track.id, request);
    return request;
  }

  private async fetchArtwork(coverUrl: string) {
    if (!DataApi?.fromArrayBuffer || !UIImageApi?.fromData) {
      return null;
    }

    const response = await fetch(coverUrl, {
      headers: requestHeaders(),
      timeout: 15,
      debugLabel: `Artwork ${coverUrl}`,
    } as any);

    if (!response.ok) {
      return null;
    }

    const buffer = await response.arrayBuffer();
    const data = DataApi.fromArrayBuffer(buffer);
    if (!data) {
      return null;
    }

    return UIImageApi.fromData(data);
  }
}

let sharedPlayer: AzusaScriptingPlayer | null = null;

export function getSharedPlayer() {
  if (!sharedPlayer) {
    sharedPlayer = new AzusaScriptingPlayer();
  }
  return sharedPlayer;
}

export function getNativePlayerCompatibilityMessage() {
  return hasNativeAudioPlayer() ? null : nativePlayerUnsupportedMessage;
}
