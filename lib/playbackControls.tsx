import { Button, HStack, Image, Text } from "scripting";

import type { PlaybackMode, PlaybackUiState } from "./types";

type TransportControlsProps = {
  playbackState: PlaybackUiState;
  compact?: boolean;
  onPrimaryAction: () => void | Promise<void>;
  onPrevious: () => void | Promise<void>;
  onNext: () => void | Promise<void>;
};

type PlaybackModeControlProps = {
  playbackMode: PlaybackMode;
  onCyclePlaybackMode: () => void;
};

export function playbackModeLabel(mode: PlaybackMode) {
  switch (mode) {
    case "repeatAll":
      return "列表循环";
    case "repeatOne":
      return "单曲循环";
    case "shuffle":
      return "随机播放";
    case "normal":
    default:
      return "顺序播放";
  }
}

export function playbackModeSymbol(mode: PlaybackMode) {
  switch (mode) {
    case "repeatAll":
      return "repeat";
    case "repeatOne":
      return "repeat.1";
    case "shuffle":
      return "shuffle";
    case "normal":
    default:
      return "list.bullet";
  }
}

function primarySymbol(playbackState: PlaybackUiState) {
  return playbackState === "playing" ? "pause.fill" : "play.fill";
}

function transportButton(
  symbolName: string,
  style: "bordered" | "borderedProminent",
  compact: boolean,
  action: () => void | Promise<void>,
) {
  const iconSize = compact ? 18 : 22;
  const horizontalPadding = compact ? 18 : 22;
  const verticalPadding = compact ? 10 : 14;

  return (
    <Button
      buttonStyle={style}
      action={() => void action()}>
      <HStack
        spacing={0}
        padding={{
          horizontal: horizontalPadding,
          vertical: verticalPadding,
        }}>
        <Image
          systemName={symbolName}
          resizable
          aspectRatio={{ contentMode: "fit" }}
          frame={{ width: iconSize, height: iconSize }}
        />
      </HStack>
    </Button>
  );
}

export function TransportControls(props: TransportControlsProps) {
  const compact = Boolean(props.compact);

  return (
    <HStack spacing={compact ? 10 : 12}>
      {transportButton("backward.fill", "bordered", compact, props.onPrevious)}
      {transportButton(
        primarySymbol(props.playbackState),
        "borderedProminent",
        compact,
        props.onPrimaryAction,
      )}
      {transportButton("forward.fill", "bordered", compact, props.onNext)}
    </HStack>
  );
}

export function PlaybackModeControl(props: PlaybackModeControlProps) {
  return (
    <Button
      buttonStyle="bordered"
      action={() => props.onCyclePlaybackMode()}>
      <HStack
        spacing={8}
        padding={{
          horizontal: 10,
          vertical: 6,
        }}>
        <Image
          systemName={playbackModeSymbol(props.playbackMode)}
          resizable
          aspectRatio={{ contentMode: "fit" }}
          frame={{ width: 16, height: 16 }}
        />
        <Text font={"subheadline"}>{playbackModeLabel(props.playbackMode)}</Text>
      </HStack>
    </Button>
  );
}
