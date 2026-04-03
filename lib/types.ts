export type PlaybackUiState =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "error";

export type PlaybackMode =
  | "normal"
  | "repeatAll"
  | "repeatOne"
  | "shuffle";

export type PlaybackProgressSnapshot = {
  currentTime: number;
  duration: number;
};

export type SourceKind = "video" | "favorite" | "collection" | "channel";
export type CollectionKind = "series" | "season";

type SourceDescriptorBase = {
  kind: SourceKind;
  input: string;
  titleHint?: string;
};

export type VideoSourceDescriptor = SourceDescriptorBase & {
  kind: "video";
  bvid: string;
};

export type FavoriteSourceDescriptor = SourceDescriptorBase & {
  kind: "favorite";
  mediaId: string;
};

export type CollectionSourceDescriptor = SourceDescriptorBase & {
  kind: "collection";
  collectionKind: CollectionKind;
  ownerMid: string;
  collectionId: string;
};

export type ChannelSourceDescriptor = SourceDescriptorBase & {
  kind: "channel";
  ownerMid: string;
};

export type SourceDescriptor =
  | VideoSourceDescriptor
  | FavoriteSourceDescriptor
  | CollectionSourceDescriptor
  | ChannelSourceDescriptor;

export type Track = {
  id: string;
  bvid: string;
  cid: string;
  title: string;
  artist: string;
  sourceTitle: string;
  cover?: string;
  streamUrl?: string;
  backupStreamUrls?: string[];
  localFilePath?: string;
  durationSeconds?: number;
};

export type TrackPreview = {
  id: string;
  title: string;
  artist: string;
  sourceTitle: string;
  cover?: string;
  durationSeconds?: number;
};

export type ImportResult = {
  source: SourceDescriptor;
  sourceTitle: string;
  ownerName: string;
  cover?: string;
  tracks: Track[];
};

export type PlaybackSnapshot = {
  source: SourceDescriptor;
  sourceTitle: string;
  ownerName: string;
  cover?: string;
  queueLength: number;
  currentIndex: number;
  currentTrack?: TrackPreview;
  playbackState: PlaybackUiState;
  playbackMode: PlaybackMode;
  playbackDetail?: string;
  updatedAt: string;
};

export type PendingExternalCommandType =
  | "playPause"
  | "next"
  | "previous"
  | "openSource"
  | "openApp";

export type PendingExternalCommand = {
  id: string;
  type: PendingExternalCommandType;
  createdAt: string;
  requestedFrom?: string;
  source?: SourceDescriptor;
};

export type LyricSearchOption = {
  key: string;
  songMid: string;
  label: string;
};

export type TrackLyricsEntry = {
  rawLyric: string;
  songMid?: string;
  selectedLabel?: string;
  searchKey?: string;
  updatedAt: string;
};

export type PersistedState = {
  lastInput: string;
  sourceTitle?: string;
  sourceDescriptor?: SourceDescriptor;
  recentSources?: SourceDescriptor[];
  playbackMode?: PlaybackMode;
  queue: Track[];
  currentTrackId?: string;
  playbackSnapshot?: PlaybackSnapshot | null;
  pendingExternalCommand?: PendingExternalCommand | null;
};
