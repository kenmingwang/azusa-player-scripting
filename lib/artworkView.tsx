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
        scaleToFill
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
