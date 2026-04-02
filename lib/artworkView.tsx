import { Circle, Image } from "scripting";

type ArtworkViewProps = {
  cover?: string;
  size: number;
  fallbackColor?: string;
};

export function ArtworkView(props: ArtworkViewProps) {
  if (props.cover) {
    return (
      <Image
        imageUrl={props.cover}
        frame={{ width: props.size, height: props.size }}
        resizable
        aspectRatio={{ contentMode: "fill" }}
        clipShape={{
          type: "rect",
          cornerRadius: Math.max(14, Math.round(props.size * 0.22)),
          style: "continuous",
        }}
      />
    );
  }

  return (
    <Circle
      fill={props.fallbackColor || "systemGray3"}
      frame={{ width: props.size, height: props.size }}
    />
  );
}
