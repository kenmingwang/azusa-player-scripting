import { Circle, Image, ZStack } from "scripting";

type ArtworkViewProps = {
  cover?: string;
  size: number;
  fallbackColor?: string;
  contentMode?: "fill" | "fit";
  cornerRadius?: number;
};

export function ArtworkView(props: ArtworkViewProps) {
  const cornerRadius =
    props.cornerRadius ?? Math.max(14, Math.round(props.size * 0.22));
  const contentMode = props.contentMode ?? "fill";

  if (props.cover) {
    return (
      <ZStack
        frame={{ width: props.size, height: props.size }}
        background={{
          style: {
            light: "rgba(226, 232, 240, 0.75)",
            dark: "rgba(255, 255, 255, 0.08)",
          },
          shape: {
            type: "rect",
            cornerRadius,
            style: "continuous",
          },
        }}
        clipShape={{
          type: "rect",
          cornerRadius,
          style: "continuous",
        }}>
        <Image
          imageUrl={props.cover}
          frame={{ width: props.size, height: props.size }}
          resizable
          aspectRatio={{ contentMode }}
          interpolation="high"
          antialiased
          padding={contentMode === "fit" ? Math.max(6, Math.round(props.size * 0.08)) : 0}
        />
      </ZStack>
    );
  }

  return (
    <ZStack
      frame={{ width: props.size, height: props.size }}
      background={{
        style: {
          light: "rgba(226, 232, 240, 0.75)",
          dark: "rgba(255, 255, 255, 0.08)",
        },
        shape: {
          type: "rect",
          cornerRadius,
          style: "continuous",
        },
      }}
      clipShape={{
        type: "rect",
        cornerRadius,
        style: "continuous",
      }}>
      <Circle
        fill={props.fallbackColor || "systemGray3"}
        frame={{
          width: Math.round(props.size * 0.58),
          height: Math.round(props.size * 0.58),
        }}
      />
    </ZStack>
  );
}
