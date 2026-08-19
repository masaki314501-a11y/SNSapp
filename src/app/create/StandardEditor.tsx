"use client";

import { useMemo, useState } from "react";
import { Player } from "@remotion/player";
import { StandardVideo } from "@video/templates/standard/StandardVideo";
import { getStandardVideoDurationInFrames } from "@video/templates/standard/duration";
import { MIN_CLIPS, MAX_CLIPS } from "@video/templates/standard/schema";
import type { StandardVideoProps } from "@video/templates/standard/schema";
import {
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  DEFAULT_CLIP_DURATION_IN_SECONDS,
} from "@video/shared/constants";
import { CAPTION_ANIMATION_OPTIONS, type CaptionAnimation } from "@video/shared/schema";
import { uploadVideoFile } from "./uploadVideoFile";
import { useRenderJob } from "./useRenderJob";
import { RenderPanel } from "./RenderPanel";

type ClipFormState = {
  key: string;
  path: string;
  fileName: string | null;
  uploading: boolean;
  caption: string;
  durationInSeconds: number;
  startFromSeconds: number;
  captionAnimation: CaptionAnimation;
};

const createEmptyClip = (): ClipFormState => ({
  key: crypto.randomUUID(),
  path: "",
  fileName: null,
  uploading: false,
  caption: "",
  durationInSeconds: DEFAULT_CLIP_DURATION_IN_SECONDS,
  startFromSeconds: 0,
  captionAnimation: "slide-up",
});

type FormState = {
  headline: string;
  subline: string;
  clips: ClipFormState[];
  ctaText: string;
  primaryColor: string;
};

const initialForm: FormState = {
  headline: "知らないと損する\n節約術3選",
  subline: "最後まで見て",
  clips: [createEmptyClip(), createEmptyClip(), createEmptyClip()],
  ctaText: "詳しくはプロフィールへ",
  primaryColor: "#FF3366",
};

const toStandardVideoProps = (form: FormState): StandardVideoProps => ({
  hook: {
    headline: form.headline,
    subline: form.subline.trim() ? form.subline : undefined,
  },
  clips: form.clips.map((clip) => ({
    ...(clip.path ? { src: clip.path } : {}),
    caption: clip.caption,
    durationInSeconds: clip.durationInSeconds,
    startFromSeconds: clip.startFromSeconds,
    captionAnimation: clip.captionAnimation,
  })),
  cta: { text: form.ctaText },
  theme: {
    primaryColor: form.primaryColor,
    fontFamily: '"Noto Sans JP", "Hiragino Sans", sans-serif',
  },
});

export const StandardEditor: React.FC = () => {
  const [form, setForm] = useState<FormState>(initialForm);
  const { renderState, handleRender } = useRenderJob();

  const props = useMemo(() => toStandardVideoProps(form), [form]);
  const durationInFrames = useMemo(
    () => getStandardVideoDurationInFrames(props),
    [props]
  );

  const canAddClip = form.clips.length < MAX_CLIPS;
  const canRemoveClip = form.clips.length > MIN_CLIPS;
  const canRender =
    form.headline.trim().length > 0 &&
    form.clips.every((clip) => clip.caption.trim().length > 0) &&
    form.clips.length >= MIN_CLIPS &&
    form.clips.length <= MAX_CLIPS &&
    !form.clips.some((clip) => clip.uploading);

  const updateClip = (key: string, patch: Partial<ClipFormState>) => {
    setForm((prev) => ({
      ...prev,
      clips: prev.clips.map((clip) =>
        clip.key === key ? { ...clip, ...patch } : clip
      ),
    }));
  };

  const handleFileChange = async (key: string, file: File | null) => {
    if (!file) return;
    updateClip(key, { uploading: true, fileName: file.name });
    try {
      const path = await uploadVideoFile(file);
      updateClip(key, { path, uploading: false });
    } catch (error) {
      updateClip(key, { uploading: false });
      alert(error instanceof Error ? error.message : "アップロードに失敗しました");
    }
  };

  const addClip = () => {
    if (!canAddClip) return;
    setForm((prev) => ({ ...prev, clips: [...prev.clips, createEmptyClip()] }));
  };

  const removeClip = (key: string) => {
    if (!canRemoveClip) return;
    setForm((prev) => ({
      ...prev,
      clips: prev.clips.filter((clip) => clip.key !== key),
    }));
  };

  return (
    <div className="flex flex-1 flex-col gap-8 lg:flex-row">
      <section className="flex flex-1 flex-col gap-6">
        <fieldset className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <legend className="px-1 text-sm font-medium">フック(0-3秒)</legend>
          <label className="flex flex-col gap-1 text-sm">
            結論・数字を先出しするメインテロップ
            <textarea
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              rows={2}
              value={form.headline}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, headline: e.target.value }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            補足テロップ(任意)
            <input
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              value={form.subline}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, subline: e.target.value }))
              }
            />
          </label>
        </fieldset>

        <fieldset className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <legend className="px-1 text-sm font-medium">本題(3-20秒)</legend>
          {form.clips.map((clip, index) => (
            <div
              key={clip.key}
              className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <div className="flex items-center justify-between text-sm font-medium">
                <span>クリップ {index + 1}</span>
                <button
                  type="button"
                  onClick={() => removeClip(clip.key)}
                  disabled={!canRemoveClip}
                  className="text-xs text-zinc-500 underline disabled:opacity-30"
                >
                  削除
                </button>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                動画ファイル
                <input
                  type="file"
                  accept="video/*"
                  onChange={(e) =>
                    handleFileChange(clip.key, e.target.files?.[0] ?? null)
                  }
                />
                {clip.uploading ? (
                  <span className="text-xs text-zinc-500">アップロード中...</span>
                ) : clip.fileName ? (
                  <span className="text-xs text-emerald-600">{clip.fileName}</span>
                ) : (
                  <span className="text-xs text-zinc-400">
                    未指定の場合はプレースホルダー背景で代替
                  </span>
                )}
              </label>
              <label className="flex flex-col gap-1 text-sm">
                テロップ
                <input
                  className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  value={clip.caption}
                  onChange={(e) => updateClip(clip.key, { caption: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                テロップの演出
                <select
                  className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  value={clip.captionAnimation}
                  onChange={(e) =>
                    updateClip(clip.key, {
                      captionAnimation: e.target.value as CaptionAnimation,
                    })
                  }
                >
                  {CAPTION_ANIMATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  尺(秒)
                  <input
                    type="number"
                    min={1}
                    max={12}
                    className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    value={clip.durationInSeconds}
                    onChange={(e) =>
                      updateClip(clip.key, {
                        durationInSeconds: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  開始位置(秒)
                  <input
                    type="number"
                    min={0}
                    className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    value={clip.startFromSeconds}
                    onChange={(e) =>
                      updateClip(clip.key, {
                        startFromSeconds: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addClip}
            disabled={!canAddClip}
            className="self-start rounded-full border border-zinc-300 px-4 py-1.5 text-sm disabled:opacity-30 dark:border-zinc-700"
          >
            + クリップを追加
          </button>
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <legend className="px-1 text-sm font-medium">CTA(20-25秒)</legend>
          <label className="flex flex-col gap-1 text-sm">
            行動喚起テキスト
            <input
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              value={form.ctaText}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, ctaText: e.target.value }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            テーマカラー
            <input
              type="color"
              className="h-9 w-16"
              value={form.primaryColor}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, primaryColor: e.target.value }))
              }
            />
          </label>
        </fieldset>

        <RenderPanel
          canRender={canRender}
          renderState={renderState}
          onRender={() => handleRender("standard", props)}
        />
      </section>

      <section className="flex flex-col items-center gap-3 lg:sticky lg:top-12 lg:self-start">
        <span className="text-sm text-zinc-500">
          プレビュー({(durationInFrames / VIDEO_FPS).toFixed(1)}秒)
        </span>
        <Player
          component={StandardVideo}
          inputProps={props}
          durationInFrames={Math.max(durationInFrames, 1)}
          fps={VIDEO_FPS}
          compositionWidth={VIDEO_WIDTH}
          compositionHeight={VIDEO_HEIGHT}
          style={{ width: 300, height: 533 }}
          controls
          loop
        />
      </section>
    </div>
  );
};
