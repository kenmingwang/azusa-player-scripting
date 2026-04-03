import { Circle, Image, ZStack } from "scripting";

type ArtworkViewProps = {
  cover?: string;
  size?: number;
  width?: number;
  height?: number;
  fallbackColor?: string;
  contentMode?: "fill" | "fit";
  cornerRadius?: number;
  backgroundStyle?: "soft" | "none";
  padding?: number;
};

export function ArtworkView(props: ArtworkViewProps) {
  const width = props.width ?? props.size ?? 64;
  const height = props.height ?? props.size ?? width;
  const cornerRadius =
    props.cornerRadius ?? Math.max(14, Math.round(Math.min(width, height) * 0.22));
  const contentMode = props.contentMode ?? "fill";
  const backgroundStyle = props.backgroundStyle ?? "soft";
  const padding =
    props.padding ??
    (contentMode === "fit" ? Math.max(6, Math.round(Math.min(width, height) * 0.08)) : 0);

  if (props.cover) {
    const imageView = (
      <Image
        imageUrl={props.cover}
        frame={{ width, height }}
        resizable
        aspectRatio={{ contentMode }}
        interpolation="high"
        antialiased
        padding={padding}
        clipShape={{
          type: "rect",
          cornerRadius,
          style: "continuous",
        }}
      />
    );

    if (backgroundStyle === "none") {
      return imageView;
    }

    return (
      <ZStack
        frame={{ width, height }}
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
        {imageView}
      </ZStack>
    );
  }

  return (
    <ZStack
      frame={{ width, height }}
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
          width: Math.round(Math.min(width, height) * 0.58),
          height: Math.round(Math.min(width, height) * 0.58),
        }}
      />
    </ZStack>
  );
}
