import { Composition } from "remotion";
import {
  VerticalClip,
  calculateVerticalClipMetadata,
  type VerticalClipProps,
} from "./VerticalClip";

export const defaultProps: VerticalClipProps = {
  assetBaseUrl: "",
  scenes: [{ src: null, text: null, durationMs: 1000 }],
  voiceover: null,
  music: null,
  captions: [],
  brand: { background: "#151715", text: "#ffffff", highlight: "#f2a541" },
};
export function Root() {
  return (
    <Composition
      id="VerticalClip"
      component={VerticalClip}
      defaultProps={defaultProps}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={30}
      calculateMetadata={calculateVerticalClipMetadata}
    />
  );
}
