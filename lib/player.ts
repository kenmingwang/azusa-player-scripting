import {
  AVPlayer,
  FileManager,
  MediaPlayer,
  SharedAudioSession,
  TimeControlStatus,
} from "scripting";

import { resolveTrackStream } from "./api";
import type { PlaybackUiState, Track } from "./types";

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
  private bindings: PlayerBindings = {};
  private updateTimer?: number;
  private loadToken = 0;

  constructor() {
    this.setupMediaCommands();
  }

  bind(bindings: PlayerBindings) {
    this.bindings = bindings;
  }

  setQueue(queue: Track[]) {
    this.queue = [...queue];
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

  getCurrentTime() {
    return this.player?.currentTime ?? 0;
  }

  getDuration() {
    return this.player?.duration ?? 0;
  }

  async playIndex(index: number) {
    this.ensurePlayer();

    if (index < 0 || index >= this.queue.length) {
      return;
    }

    const loadToken = ++this.loadToken;
    this.currentIndex = index;
    this.bindings.onCurrentTrackChange?.(this.queue[index], this.currentIndex);
    this.emitState("loading", "正在准备播放");

    await SharedAudioSessionApi.setCategory("playback");
    await SharedAudioSessionApi.setActive(true);

    let track = this.queue[index];
    if (!(track.localFilePath && FileManager.existsSync(track.localFilePath))) {
      track = await resolveTrackStream(track);
      this.queue[index] = track;
      this.bindings.onQueueChange?.([...this.queue]);
    }

    const source =
      track.localFilePath && FileManager.existsSync(track.localFilePath)
        ? track.localFilePath
        : track.streamUrl!;

    this.player!.stop();
    const ready = this.player!.setSource(source);
    if (!ready) {
      throw new Error("播放器无法装载音频源");
    }

    this.player!.onReadyToPlay = () => {
      if (loadToken !== this.loadToken) return;
      this.player!.play();
      this.startTicker();
      this.updateNowPlaying();
      this.bindings.onCurrentTrackChange?.(this.queue[this.currentIndex], this.currentIndex);
    };
  }

  pause() {
    if (!this.player) return;
    this.player.pause();
    this.updateNowPlaying();
  }

  resume() {
    if (!this.player) {
      this.bindings.onError?.(nativePlayerUnsupportedMessage);
      return;
    }
    if (!this.getCurrentTrack()) return;
    this.player.play();
    this.startTicker();
    this.updateNowPlaying();
  }

  toggle() {
    if (!this.player) {
      this.bindings.onError?.(nativePlayerUnsupportedMessage);
      return;
    }
    if (this.player.timeControlStatus === TimeControlStatusApi?.playing) {
      this.pause();
    } else {
      this.resume();
    }
  }

  async skip(delta: number) {
    const nextIndex = this.currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= this.queue.length) {
      this.pause();
      return;
    }
    await this.playIndex(nextIndex);
  }

  stop() {
    if (!this.player) return;
    this.player.stop();
    this.stopTicker();
    this.emitState("paused");
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
    if (MediaPlayerApi) {
      MediaPlayerApi.nowPlayingInfo = null;
    }
  }

  private emitState(state: PlaybackUiState, detail?: string) {
    this.bindings.onStateChange?.(state, detail);
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
        this.resume();
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
      this.updateNowPlaying();
    };

    this.player.onEnded = () => {
      void this.skip(1);
    };

    this.player.onError = (message: string) => {
      this.emitState("error", message);
      this.bindings.onError?.(message);
    };

    return this.player;
  }

  private startTicker() {
    this.stopTicker();
    if (!setIntervalApi) {
      return;
    }
    this.updateTimer = setIntervalApi(() => {
      this.updateNowPlaying();
    }, 1000) as unknown as number;
  }

  private stopTicker() {
    if (this.updateTimer) {
      if (clearIntervalApi) {
        clearIntervalApi(this.updateTimer);
      }
      this.updateTimer = undefined;
    }
  }

  private updateNowPlaying() {
    if (!this.player || !MediaPlayerApi) return;
    const currentTrack = this.getCurrentTrack();
    if (!currentTrack) return;

    MediaPlayerApi.nowPlayingInfo = {
      title: currentTrack.title,
      artist: currentTrack.artist,
      albumTitle: currentTrack.sourceTitle,
      elapsedPlaybackTime: this.player.currentTime ?? 0,
      playbackDuration:
        this.player.duration || currentTrack.durationSeconds || 0,
      playbackRate:
        this.player.timeControlStatus === TimeControlStatusApi?.playing ? 1.0 : 0.0,
    };
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
