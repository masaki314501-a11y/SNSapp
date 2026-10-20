"use client";

import { useEffect, useMemo, useState } from "react";
import { Player } from "@remotion/player";
import { VIDEO_HEIGHT, VIDEO_WIDTH } from "@video/shared/constants";
import {
  COVER_DURATION_IN_FRAMES,
  COVER_FPS,
  COVER_STILL_FRAME,
  Cover,
  type CoverProps,
} from "@video/templates/cover/Cover";
import type { VideoProject } from "@/lib/videoProject";
import { toFriendlyErrorMessage } from "@/lib/friendlyError";
import { RECOMMENDED_CAPTION_STYLE_IDS, TextStylePicker } from "./timeline/TextStylePicker";

type Props = { project: VideoProject };

const POSITIONS: { value: "top" | "middle" | "bottom"; label: string; yPercent: number }[] = [
  { value: "top", label: "上", yPercent: 22 },
  { value: "middle", label: "真ん中", yPercent: 50 },
  { value: "bottom", label: "下", yPercent: 76 },
];

/** 表紙のタイトルの初期値: 左上のタイトル → 動画全体に出していた文字 → 冒頭の見出しの順に、あれば使う。 */
const defaultTitle = (project: VideoProject): string =>
  project.autoEditTitle?.trim() ||
  project.globalOverlays?.find((overlay) => overlay.startOffsetSeconds < 1 && !overlay.text.startsWith("※"))?.text.replace(/\n/g, "") ||
  project.hook?.headline ||
  "";

/** 完成動画の秒数を、元の動画の秒数に直す(クリップは元の動画の好きな所を切り出して並べているため)。 */
const toSourceSeconds = (project: VideoProject, outputSeconds: number): number => {
  let start = 0;
  for (const segment of project.segments) {
    if (outputSeconds < start + segment.durationInSeconds) return segment.startFromSeconds + (outputSeconds - start);
    start += segment.durationInSeconds;
  }
  const last = project.segments[project.segments.length - 1];
  return last ? last.startFromSeconds + last.durationInSeconds - 0.1 : 0;
};

/** 画像を保存する。スマホで共有シートが使えれば写真に保存できるようそちらを、使えなければダウンロードにする。 */
const saveImage = async (blob: Blob, fileName: string) => {
  const file = new File([blob], fileName, { type: blob.type });
  if (typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/**
 * 投稿の表紙(サムネイル)を作る欄。動画の場面を選び、タイトルを大きく重ねて画像で保存する。
 * 動画と同じ部品で描くので、文字のスタイルは字幕・強調テキストと同じ170種類から選べる。画像にするのはブラウザの中なので、
 * サーバーには負担をかけない。
 */
export const CoverMaker: React.FC<Props> = ({ project }) => {
  // 開くまではプレビュー(動画の読み込み)をしない。書き出しの最中にプレビューでも動画を読むと、スマホの書き出しが重くなるため
  const [open, setOpen] = useState(false);
  return open ? (
    <CoverMakerBody project={project} />
  ) : (
    <div className="panel flex flex-col gap-2 p-4">
      <span className="text-sm font-bold">表紙(サムネイル)を作る</span>
      <span className="text-xs" style={{ color: "var(--muted)" }}>
        動画の場面を選び、タイトルを大きく重ねた画像を作れます。動画の書き出しが終わってから開くと軽く動きます。
      </span>
      <button type="button" className="btn-outline" onClick={() => setOpen(true)}>
        表紙を作る
      </button>
    </div>
  );
};

const CoverMakerBody: React.FC<Props> = ({ project }) => {
  const totalSeconds = project.segments.reduce((sum, segment) => sum + segment.durationInSeconds, 0);
  const [outputSeconds, setOutputSeconds] = useState(() => Math.min(1, totalSeconds / 2));
  const [title, setTitle] = useState(() => defaultTitle(project));
  const [textStyleId, setTextStyleId] = useState<string | undefined>(RECOMMENDED_CAPTION_STYLE_IDS[0]);
  const [position, setPosition] = useState<(typeof POSITIONS)[number]["value"]>("top");
  const [fontSizePx, setFontSizePx] = useState(120);
  const [saving, setSaving] = useState(false);

  const props: CoverProps = useMemo(
    () => ({
      videoSrc: project.videoPath,
      frameSeconds: toSourceSeconds(project, outputSeconds),
      framing: project.framing ?? undefined,
      title,
      textStyleId,
      yPercent: POSITIONS.find((entry) => entry.value === position)!.yPercent,
      fontSizePx,
      fontFamily: project.fontFamily,
    }),
    [project, outputSeconds, title, textStyleId, position, fontSizePx]
  );

  // 場面のつまみを動かしている間は、少し待ってからプレビューを描き直す(動画の頭出しを何度もしないように)
  const [previewProps, setPreviewProps] = useState(props);
  useEffect(() => {
    const timer = setTimeout(() => setPreviewProps(props), 250);
    return () => clearTimeout(timer);
  }, [props]);

  const save = async () => {
    setSaving(true);
    try {
      const { renderStillOnWeb } = await import("@remotion/web-renderer");
      const still = await renderStillOnWeb({
        composition: {
          component: Cover,
          id: "Cover",
          width: VIDEO_WIDTH,
          height: VIDEO_HEIGHT,
          fps: COVER_FPS,
          durationInFrames: COVER_DURATION_IN_FRAMES,
          defaultProps: props,
        },
        inputProps: props,
        frame: COVER_STILL_FRAME,
        licenseKey: process.env.NEXT_PUBLIC_REMOTION_LICENSE_KEY || null,
      });
      const blob = await still.blob({ format: "jpeg", quality: 0.92 });
      await saveImage(blob, `${(project.videoFileName ?? "動画").replace(/\.[^.]+$/, "")}-表紙.jpg`);
    } catch (error) {
      alert(toFriendlyErrorMessage(error, "表紙を保存できませんでした"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <span className="text-sm font-bold">表紙(サムネイル)を作る</span>
      <div className="flex gap-3">
        <div className="shrink-0 overflow-hidden rounded-lg" style={{ width: 140, background: "#000" }}>
          <Player
            component={Cover}
            inputProps={previewProps}
            durationInFrames={COVER_DURATION_IN_FRAMES}
            fps={COVER_FPS}
            compositionWidth={VIDEO_WIDTH}
            compositionHeight={VIDEO_HEIGHT}
            initialFrame={COVER_STILL_FRAME}
            style={{ width: "100%", aspectRatio: `${VIDEO_WIDTH} / ${VIDEO_HEIGHT}` }}
            acknowledgeRemotionLicense
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm font-bold">
            <span>場面 {outputSeconds.toFixed(1)}秒</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, totalSeconds - 0.1)}
              step={0.1}
              value={outputSeconds}
              onChange={(e) => setOutputSeconds(Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            <span>タイトル</span>
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              rows={2}
              maxLength={40}
              placeholder="例: 矯正した方がいい歯並びTOP5"
              className="field-input text-sm"
            />
          </label>
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <fieldset className="flex items-center gap-3 text-sm">
          <legend className="sr-only">タイトルの位置</legend>
          {POSITIONS.map((entry) => (
            <label key={entry.value} className="flex items-center gap-1">
              <input type="radio" name="cover-position" checked={position === entry.value} onChange={() => setPosition(entry.value)} />
              {entry.label}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-1 items-center gap-2 text-sm">
          <span className="shrink-0">大きさ</span>
          <input type="range" min={60} max={200} value={fontSizePx} onChange={(e) => setFontSizePx(Number(e.target.value))} />
        </label>
      </div>
      <TextStylePicker
        label="文字のスタイル"
        value={textStyleId}
        onChange={setTextStyleId}
        recommendedIds={RECOMMENDED_CAPTION_STYLE_IDS}
        emptyLabel="ふつう(白い文字に黒い縁取り)"
      />
      <button type="button" onClick={() => void save()} disabled={saving || !title.trim()} className="btn-outline">
        {saving ? "表紙を作っています…" : "表紙を画像で保存する"}
      </button>
    </div>
  );
};
