import { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Freeze,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  type CalculateMetadataFunction,
} from "remotion";
import { createTikTokStyleCaptions, type Caption } from "@remotion/captions";

export type Format = "9:16" | "4:5" | "1:1" | "16:9";
type Region = { x: number; y: number; width: number; height: number };
type Device = "browser" | "laptop" | "phone";
type Rect = { left: number; top: number; width: number; height: number };
export type VerticalClipProps = {
  assetBaseUrl: string;
  format?: Format;
  scenes: {
    src: string | null;
    // A recorded clip (src is a video): its trim, speed and a still for the backdrop.
    clip?: {
      startMs: number;
      endMs: number;
      speed: number;
      poster: string;
    } | null;
    text: string | null;
    durationMs: number;
    fit?: "cover" | "contain";
    device?: Device | null;
    focus?: Region | null;
    highlight?: Region | null;
    aspect?: number | null;
  }[];
  voiceover: string | null;
  music: {
    src: string;
    volume: number;
    startMs: number;
    fadeInMs: number;
    fadeOutMs: number;
    voiceRangesMs: [number, number][] | null;
  } | null;
  captions: Caption[];
  brand: { background: string; text: string; highlight: string };
};
type SceneData = VerticalClipProps["scenes"][number];
/** Whether a scene continues the previous one's shot: the same image, or a clip picking up where it stopped. */
const continues = (previous: SceneData | undefined, scene: SceneData) =>
  !!previous &&
  !!scene.src &&
  scene.src === previous.src &&
  (!scene.clip || scene.clip.startMs === previous.clip?.endMs);
type Shot = {
  offset: number;
  frames: number;
  index: number;
  stickered: boolean;
};
export const FORMATS: Record<Format, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};
export const calculateVerticalClipMetadata: CalculateMetadataFunction<
  VerticalClipProps
> = ({ props }) => ({
  ...FORMATS[props.format ?? "9:16"],
  durationInFrames: Math.max(
    1,
    Math.ceil(
      (props.scenes.reduce((ms, scene) => ms + scene.durationMs, 0) * 30) /
        1000,
    ),
  ),
});
const fontFamily = "-apple-system, 'Helvetica Neue', Arial, sans-serif";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const asset = (base: string, filename: string) =>
  `${base}/${encodeURIComponent(filename)}`;
const safeArea = (width: number, height: number) =>
  height > width * 1.5
    ? { top: 240, bottom: 520, left: 70, right: 150 }
    : { top: 70, bottom: 140, left: 90, right: 90 };

// Reserve screenshot space around text in feed/landscape; portrait retains phone overlays.
function textBands(width: number, height: number) {
  if (height > width * 1.5) return { top: 0, bottom: 0 };
  const safe = safeArea(width, height);
  return {
    top: Math.round(safe.top + 40 + 72 * 1.35 + 16 + 24),
    bottom: Math.round(safe.bottom + 84 * 1.12 + 30),
  };
}
function textSize(
  text: string,
  width: number,
  sizes: [number, number, number],
) {
  const longest = Math.max(1, ...text.split(/\s+/).map((word) => word.length));
  return Math.min(
    sizes[text.length <= 30 ? 0 : text.length <= 60 ? 1 : 2],
    Math.floor(width / (0.6 * longest)),
  );
}
function usePop() {
  const progress = interpolate(useCurrentFrame(), [1, 5], [0, 1], clamp);
  return { opacity: progress, transform: `scale(${0.92 + progress * 0.08})` };
}

const deviceInsets: Record<
  Device,
  { side: number; above: number; below: number }
> = {
  browser: { side: 0, above: 0.045, below: 0 },
  laptop: { side: 0.025, above: 0.025, below: 0.06 },
  phone: { side: 0.04, above: 0.04, below: 0.04 },
};
function imageRect(
  aspect: number,
  fit: "cover" | "contain",
  device: Device | null,
  width: number,
  height: number,
): Rect {
  if (device) {
    const insets = deviceInsets[device];
    const margin = Math.min(width, height) * 0.06;
    const screen = Math.min(
      (width - 2 * margin) / (1 + 2 * insets.side),
      (height - 2 * margin) / (1 / aspect + insets.above + insets.below),
    );
    return {
      left: (width - screen) / 2,
      top:
        (height - screen * (1 / aspect + insets.above + insets.below)) / 2 +
        insets.above * screen,
      width: screen,
      height: screen / aspect,
    };
  }
  const wider = aspect > width / height;
  const imageWidth = (fit === "contain" ? wider : !wider)
    ? width
    : height * aspect;
  return {
    left: (width - imageWidth) / 2,
    top: (height - imageWidth / aspect) / 2,
    width: imageWidth,
    height: imageWidth / aspect,
  };
}

function focusTransform(
  frame: number,
  rect: Rect,
  viewport: { top: number; width: number; height: number },
  focus: Region | null,
  previous: Region | null,
  // A clip that fills the frame: the whole frame shows the recording, and the focus
  // fits in the viewport (clear of the title and captions) instead of in the frame.
  stage?: { width: number; height: number },
) {
  if (!focus && !previous) return undefined;
  const fraction = interpolate(frame, [0, 18], [0, 1], {
    ...clamp,
    easing: (t) => 1 - (1 - t) ** 3,
  });
  function bounded(
    center: number,
    start: number,
    length: number,
    visible: number,
  ) {
    return visible >= length
      ? start + length / 2
      : Math.min(
          start + length - visible / 2,
          Math.max(start + visible / 2, center),
        );
  }
  function target(region: Region | null) {
    if (!region)
      return {
        x: viewport.width / 2,
        y: viewport.top + viewport.height / 2,
        scale: 1,
      };
    const [marginX, marginY] = stage ? [0.96, 0.96] : [0.88, 0.8];
    const scale = Math.min(
      4,
      Math.max(
        1,
        Math.min(
          (viewport.width * marginX) / (region.width * rect.width),
          (viewport.height * marginY) / (region.height * rect.height),
        ),
      ),
    );
    const x = rect.left + (region.x + region.width / 2) * rect.width,
      y = rect.top + (region.y + region.height / 2) * rect.height;
    // Only the focus shows (focusClip), centred above the captions: nothing around it
    // needs to stay inside the recording.
    if (stage) return { scale, x, y };
    return {
      scale,
      x: bounded(x, rect.left, rect.width, viewport.width / scale),
      y: bounded(y, rect.top, rect.height, viewport.height / scale),
    };
  }
  const start = target(previous),
    end = target(focus);
  const mix = (a: number, b: number) => a + (b - a) * fraction;
  return `translate(${viewport.width / 2}px, ${viewport.top + viewport.height / 2}px) scale(${mix(start.scale, end.scale)}) translate(${-mix(start.x, end.x)}px, ${-mix(start.y, end.y)}px)`;
}

/**
 * The focus of a clip that fills the frame, as a clip path in the recording's own
 * coordinates: only that area shows, so a focus that leaves out a browser's bars or the
 * desktop really leaves them out. It moves with the zoom between foci.
 */
function focusClip(
  frame: number,
  rect: Rect,
  focus: Region | null,
  previous: Region | null,
  stage: { width: number; height: number },
) {
  if (!focus && !previous) return undefined;
  const fraction = interpolate(frame, [0, 18], [0, 1], {
    ...clamp,
    easing: (t) => 1 - (1 - t) ** 3,
  });
  const box = (region: Region | null) =>
    region
      ? {
          left: rect.left + region.x * rect.width,
          top: rect.top + region.y * rect.height,
          width: region.width * rect.width,
          height: region.height * rect.height,
        }
      : rect;
  const a = box(previous),
    b = box(focus);
  const mix = (key: keyof Rect) => a[key] + (b[key] - a[key]) * fraction;
  const left = mix("left"),
    top = mix("top");
  // Rounded a little, so it reads as the app framed rather than a crop.
  return `inset(${top}px ${stage.width - left - mix("width")}px ${stage.height - top - mix("height")}px ${left}px round ${Math.round(stage.width * 0.006)}px)`;
}

function DeviceFrame({ device, rect }: { device: Device; rect: Rect }) {
  const { side, above, below } = deviceInsets[device];
  const w = rect.width;
  const shadow = "0 40px 120px rgba(0,0,0,0.55)";
  if (device === "browser")
    return (
      <div
        style={{
          position: "absolute",
          left: rect.left,
          top: rect.top - above * w,
          width: w,
          height: rect.height + above * w,
          borderRadius: 0.015 * w,
          background: "#2a2b30",
          boxShadow: shadow,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: w * 0.012,
            padding: `${w * 0.015}px ${w * 0.02}px`,
          }}
        >
          {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
            <span
              key={color}
              style={{
                width: w * 0.016,
                height: w * 0.016,
                borderRadius: "50%",
                background: color,
              }}
            />
          ))}
        </div>
      </div>
    );
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: rect.left - side * w,
          top: rect.top - above * w,
          width: w * (1 + 2 * side),
          height:
            rect.height + (above + (device === "phone" ? below : side)) * w,
          borderRadius: (device === "phone" ? 0.14 : 0.03) * w,
          background: "#0d0d0f",
          boxShadow: shadow,
        }}
      />
      {device === "laptop" && (
        <div
          style={{
            position: "absolute",
            left: rect.left - w * 0.12,
            top: rect.top + rect.height + side * w,
            width: w * 1.24,
            height: (below - side) * w,
            borderRadius: `0 0 ${0.03 * w}px ${0.03 * w}px`,
            background: "linear-gradient(#d4d6db, #a9acb3)",
          }}
        />
      )}
    </>
  );
}

function camera(frame: number, fps: number, shot: Shot, amount: number) {
  const elapsed = frame + shot.offset,
    seconds = elapsed / fps,
    phase = shot.index * 1.7;
  const scale =
    amount < 1
      ? 1.02
      : 1.06 + 0.06 * Math.min(1, elapsed / Math.max(1, shot.frames));
  const x =
    amount *
    (9 * Math.sin(1.3 * seconds + phase) +
      3 * Math.sin(3.1 * seconds + phase * 2));
  const y =
    amount *
    (7 * Math.sin(1.1 * seconds + 1 + phase) +
      2 * Math.sin(2.7 * seconds + phase));
  return `translate(${x}px, ${y}px) rotate(${amount * 0.3 * Math.sin(0.9 * seconds + phase)}deg) scale(${scale})`;
}

/** Plays the trimmed part of a clip muted at its speed, then holds its last frame. */
function ClipVideo({
  src,
  clip,
  style,
}: {
  src: string;
  clip: NonNullable<SceneData["clip"]>;
  style: React.CSSProperties;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const playing = Math.max(
    1,
    Math.floor((((clip.endMs - clip.startMs) / clip.speed) * fps) / 1000),
  );
  return (
    <Freeze frame={playing - 1} active={frame >= playing}>
      <OffthreadVideo
        src={src}
        muted
        trimBefore={Math.round((clip.startMs * fps) / 1000)}
        trimAfter={Math.round((clip.endMs * fps) / 1000)}
        playbackRate={clip.speed}
        style={style}
      />
    </Freeze>
  );
}

function Headline({
  text,
  image,
  brand,
}: {
  text: string;
  image: boolean;
  brand: VerticalClipProps["brand"];
}) {
  const { width, height } = useVideoConfig();
  const safe = safeArea(width, height);
  const pop = usePop();
  const available = image ? width - safe.left - safe.right : width - 180;
  if (!image)
    return (
      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center", padding: 90 }}
      >
        <div style={{ ...pop, textAlign: "center" }}>
          <div
            style={{
              width: 120,
              height: 12,
              borderRadius: 6,
              margin: "0 auto 56px",
              backgroundColor: brand.highlight,
            }}
          />
          <div
            style={{
              fontFamily,
              fontWeight: 800,
              fontSize: textSize(text, available, [120, 96, 76]),
              lineHeight: 1.1,
              whiteSpace: "pre-line",
              overflowWrap: "anywhere",
              color: brand.text,
            }}
          >
            {text}
          </div>
        </div>
      </AbsoluteFill>
    );
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        paddingTop: safe.top + 40,
        paddingLeft: safe.left,
        paddingRight: safe.right,
      }}
    >
      <div
        style={{
          ...pop,
          textAlign: "center",
          maxWidth: available,
          lineHeight: 1.35,
        }}
      >
        <span
          style={{
            fontFamily,
            fontWeight: 800,
            fontSize: textSize(text, available - 60, [72, 62, 54]),
            color: "#111111",
            backgroundColor: "rgba(255,255,255,0.96)",
            padding: "8px 26px",
            borderRadius: 18,
            whiteSpace: "pre-line",
            overflowWrap: "anywhere",
            boxDecorationBreak: "clone",
            WebkitBoxDecorationBreak: "clone",
          }}
        >
          {text}
        </span>
      </div>
    </AbsoluteFill>
  );
}

function Scene({
  scene,
  shot,
  previousFocus,
  captioned,
  brand,
  base,
}: {
  scene: SceneData;
  shot: Shot;
  previousFocus: Region | null;
  captioned: boolean;
  brand: VerticalClipProps["brand"];
  base: string;
}) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const fit = scene.fit ?? "cover",
    device = scene.device ?? null;
  const bands = textBands(width, height);
  const framed = fit === "contain" || !!device;
  // A screen recording fills the frame, focused or whole, so the app keeps its size from
  // shot to shot: the title and captions sit over the recording. A focus is kept clear
  // of the captions; a title has its own backing and may overlap the top of the app.
  const croppedClip = !!scene.clip && framed && !device;
  const top = framed && shot.stickered && !croppedClip ? bands.top : 0;
  const viewport = {
    top,
    width,
    height: height - top - (framed && captioned ? bands.bottom : 0),
  };
  const placed = scene.aspect
    ? croppedClip
      ? imageRect(scene.aspect, fit, device, width, height)
      : imageRect(scene.aspect, fit, device, width, viewport.height)
    : null;
  const rect = placed
    ? { ...placed, top: placed.top + (croppedClip ? 0 : top) }
    : null;
  const shownWhole = !!rect && framed;
  const focus = scene.focus ?? null;
  // A clip has its own motion: only image shots get the handheld drift.
  const amount = scene.clip
    ? 0
    : shownWhole || focus || previousFocus
      ? 0.4
      : 1;
  const glow = interpolate(frame, [4, 22], [0, 1], clamp);
  const src = scene.src ? asset(base, scene.src) : null;
  const backdrop = scene.clip ? asset(base, scene.clip.poster) : src;
  const highlight = scene.highlight;
  const radius = rect
    ? (device === "phone" ? 0.1 : device ? 0.004 : 0) * rect.width
    : 0;
  const media: React.CSSProperties = rect
    ? { position: "absolute", ...rect, borderRadius: radius }
    : {
        position: "absolute",
        width: "100%",
        height: "100%",
        objectFit: "cover",
      };
  return (
    <AbsoluteFill style={{ backgroundColor: brand.background }}>
      {backdrop && shownWhole && (
        <Img
          src={backdrop}
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            // A focused clip's surround matches its own page, light or dark.
            filter: croppedClip ? "blur(40px)" : "blur(40px) brightness(0.45)",
            transform: "scale(1.15)",
          }}
        />
      )}
      {src && (
        <AbsoluteFill
          style={{
            transform: camera(frame, fps, shot, amount),

          }}
        >
          <AbsoluteFill
            style={{
              transformOrigin: "0 0",
              ...(croppedClip &&
                rect && {
                  clipPath: focusClip(frame, rect, focus, previousFocus, { width, height }),
                }),
              transform: rect
                ? focusTransform(
                    frame,
                    rect,
                    viewport,
                    focus,
                    previousFocus,
                    croppedClip ? { width, height } : undefined,
                  )
                : undefined,
            }}
          >
            {device && rect && <DeviceFrame device={device} rect={rect} />}
            {scene.clip ? (
              <ClipVideo src={src} clip={scene.clip} style={media} />
            ) : (
              <Img src={src} style={media} />
            )}
            {highlight && rect && (
              <div
                style={{
                  position: "absolute",
                  left: rect.left + highlight.x * rect.width - 10,
                  top: rect.top + highlight.y * rect.height - 10,
                  width: highlight.width * rect.width + 20,
                  height: highlight.height * rect.height + 20,
                  borderRadius: 16,
                  border: `6px solid ${brand.highlight}`,
                  opacity: glow,
                  boxShadow: `0 0 0 4000px rgba(0,0,0,${0.55 * glow})`,
                }}
              />
            )}
          </AbsoluteFill>
        </AbsoluteFill>
      )}
      {scene.text && <Headline text={scene.text} image={!!src} brand={brand} />}
    </AbsoluteFill>
  );
}

function Music({
  src,
  volume,
  startMs,
  fadeInMs,
  fadeOutMs,
  voiceRangesMs,
}: NonNullable<VerticalClipProps["music"]>) {
  const { fps, durationInFrames } = useVideoConfig();
  const total = (durationInFrames * 1000) / fps;
  return (
    <Audio
      src={src}
      loop
      trimBefore={Math.round((startMs * fps) / 1000)}
      volume={(frame) => {
        const now = (frame * 1000) / fps;
        const opening = fadeInMs
          ? interpolate(now, [0, fadeInMs], [0, 1], clamp)
          : 1;
        const closing = fadeOutMs
          ? interpolate(now, [total - fadeOutMs, total], [1, 0], clamp)
          : 1;
        const speaking = (voiceRangesMs ?? []).reduce(
          (level, [start, end]) =>
            Math.max(
              level,
              Math.min(
                interpolate(now, [start - 300, start], [0, 1], clamp),
                interpolate(now, [end, end + 300], [1, 0], clamp),
              ),
            ),
          0,
        );
        const open = Math.max(0.45, volume);
        return (
          (voiceRangesMs ? open + (volume - open) * speaking : volume) *
          opening *
          closing
        );
      }}
    />
  );
}

type Page = ReturnType<typeof createTikTokStyleCaptions>["pages"][number];
function CaptionPage({ page, highlight }: { page: Page; highlight: string }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const safe = safeArea(width, height);
  const now = page.startMs + (frame * 1000) / fps;
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "flex-end",
        paddingBottom: safe.bottom,
        paddingLeft: safe.left,
        paddingRight: safe.right,
      }}
    >
      <div
        style={{
          fontFamily,
          fontWeight: 800,
          fontSize: 84,
          lineHeight: 1.12,
          textAlign: "center",
          whiteSpace: "pre-wrap",
          color: "#ffffff",
          WebkitTextStroke: "12px rgba(0,0,0,0.85)",
          paintOrder: "stroke fill",
          textShadow: "0 6px 28px rgba(0,0,0,0.45)",
        }}
      >
        {page.tokens.map((token) => (
          <span
            key={token.fromMs}
            style={{
              color:
                token.fromMs <= now && now < token.toMs ? highlight : "#ffffff",
            }}
          >
            {token.text}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
}

export function VerticalClip({
  assetBaseUrl,
  scenes,
  voiceover,
  music,
  captions,
  brand,
}: VerticalClipProps) {
  const { fps } = useVideoConfig();
  const pages = useMemo(
    () =>
      createTikTokStyleCaptions({
        captions,
        combineTokensWithinMilliseconds: 450,
      }).pages,
    [captions],
  );
  const timeline = useMemo(() => {
    let elapsed = 0;
    const ranges = scenes.map((scene) => {
      const from = Math.round((elapsed * fps) / 1000);
      elapsed += scene.durationMs;
      return {
        from,
        to: Math.max(from + 1, Math.round((elapsed * fps) / 1000)),
      };
    });
    let first = 0,
      index = 0;
    return ranges.map((range, position) => {
      const scene = scenes[position];
      if (position && !continues(scenes[position - 1], scene)) {
        first = position;
        index++;
      }
      let last = position;
      while (scenes[last + 1] && continues(scenes[last], scenes[last + 1]))
        last++;
      const shot: Shot = {
        offset: range.from - ranges[first].from,
        frames: ranges[last].to - ranges[first].from,
        index,
        // Clips keep one layout across cuts, so the recording doesn't jump between them.
        stickered: (scene.clip ? scenes : scenes.slice(first, last + 1)).some(
          (item) => !!item.text,
        ),
      };
      return { ...range, shot };
    });
  }, [scenes, fps]);
  return (
    <AbsoluteFill style={{ backgroundColor: brand.background }}>
      {scenes.map((scene, index) => {
        const { from, to, shot } = timeline[index];
        return (
          <Sequence
            key={index}
            from={from}
            durationInFrames={to - from}
            premountFor={fps}
          >
            <Scene
              scene={scene}
              shot={shot}
              base={assetBaseUrl}
              captioned={pages.length > 0}
              brand={brand}
              previousFocus={
                continues(scenes[index - 1], scene)
                  ? (scenes[index - 1].focus ?? null)
                  : // A clip cuts straight to its focus: zooming in from the whole recording
                    // at every cut looks like the page reloading.
                    scene.clip
                    ? (scene.focus ?? null)
                    : null
              }
            />
          </Sequence>
        );
      })}
      {pages.map((page, index) => {
        const from = Math.round((page.startMs * fps) / 1000);
        const end = Math.round(
          ((pages[index + 1]?.startMs ?? page.startMs + page.durationMs) *
            fps) /
            1000,
        );
        return end > from ? (
          <Sequence
            key={page.startMs}
            from={from}
            durationInFrames={end - from}
          >
            <CaptionPage page={page} highlight={brand.highlight} />
          </Sequence>
        ) : null;
      })}
      {voiceover && <Audio src={asset(assetBaseUrl, voiceover)} />}
      {music && <Music {...music} src={asset(assetBaseUrl, music.src)} />}
    </AbsoluteFill>
  );
}
