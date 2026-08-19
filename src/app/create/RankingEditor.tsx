"use client";

import { useMemo, useState } from "react";
import { Player } from "@remotion/player";
import { RankingVideo } from "@video/templates/ranking/RankingVideo";
import { getRankingVideoDurationInFrames } from "@video/templates/ranking/duration";
import { MIN_ITEMS, MAX_ITEMS } from "@video/templates/ranking/schema";
import type { RankingVideoProps } from "@video/templates/ranking/schema";
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

type ItemFormState = {
  key: string;
  path: string;
  fileName: string | null;
  uploading: boolean;
  title: string;
  caption: string;
  durationInSeconds: number;
  startFromSeconds: number;
  captionAnimation: CaptionAnimation;
};

const createEmptyItem = (): ItemFormState => ({
  key: crypto.randomUUID(),
  path: "",
  fileName: null,
  uploading: false,
  title: "",
  caption: "",
  durationInSeconds: DEFAULT_CLIP_DURATION_IN_SECONDS,
  startFromSeconds: 0,
  captionAnimation: "slide-up",
});

type FormState = {
  headline: string;
  subline: string;
  items: ItemFormState[];
  ctaText: string;
  primaryColor: string;
};

const initialForm: FormState = {
  headline: "コスパ最強\nガジェット3選",
  subline: "最後まで見て",
  items: [createEmptyItem(), createEmptyItem(), createEmptyItem()],
  ctaText: "詳しくはプロフィールへ",
  primaryColor: "#FF3366",
};

const toRankingVideoProps = (form: FormState): RankingVideoProps => ({
  hook: {
    headline: form.headline,
    subline: form.subline.trim() ? form.subline : undefined,
  },
  items: form.items.map((item) => ({
    ...(item.path ? { src: item.path } : {}),
    title: item.title,
    caption: item.caption,
    durationInSeconds: item.durationInSeconds,
    startFromSeconds: item.startFromSeconds,
    captionAnimation: item.captionAnimation,
  })),
  cta: { text: form.ctaText },
  theme: {
    primaryColor: form.primaryColor,
    fontFamily: '"Noto Sans JP", "Hiragino Sans", sans-serif',
  },
});

export const RankingEditor: React.FC = () => {
  const [form, setForm] = useState<FormState>(initialForm);
  const { renderState, handleRender } = useRenderJob();

  const props = useMemo(() => toRankingVideoProps(form), [form]);
  const durationInFrames = useMemo(
    () => getRankingVideoDurationInFrames(props),
    [props]
  );

  const canAddItem = form.items.length < MAX_ITEMS;
  const canRemoveItem = form.items.length > MIN_ITEMS;
  const canRender =
    form.headline.trim().length > 0 &&
    form.items.every(
      (item) => item.title.trim().length > 0 && item.caption.trim().length > 0
    ) &&
    form.items.length >= MIN_ITEMS &&
    form.items.length <= MAX_ITEMS &&
    !form.items.some((item) => item.uploading);

  const updateItem = (key: string, patch: Partial<ItemFormState>) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.key === key ? { ...item, ...patch } : item
      ),
    }));
  };

  const handleFileChange = async (key: string, file: File | null) => {
    if (!file) return;
    updateItem(key, { uploading: true, fileName: file.name });
    try {
      const path = await uploadVideoFile(file);
      updateItem(key, { path, uploading: false });
    } catch (error) {
      updateItem(key, { uploading: false });
      alert(error instanceof Error ? error.message : "アップロードに失敗しました");
    }
  };

  const addItem = () => {
    if (!canAddItem) return;
    setForm((prev) => ({ ...prev, items: [...prev.items, createEmptyItem()] }));
  };

  const removeItem = (key: string) => {
    if (!canRemoveItem) return;
    setForm((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.key !== key),
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
          <legend className="px-1 text-sm font-medium">
            ランキング項目(先頭が最下位、最後が1位)
          </legend>
          {form.items.map((item, index) => (
            <div
              key={item.key}
              className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <div className="flex items-center justify-between text-sm font-medium">
                <span>
                  第{form.items.length - index}位候補(項目 {index + 1})
                </span>
                <button
                  type="button"
                  onClick={() => removeItem(item.key)}
                  disabled={!canRemoveItem}
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
                    handleFileChange(item.key, e.target.files?.[0] ?? null)
                  }
                />
                {item.uploading ? (
                  <span className="text-xs text-zinc-500">アップロード中...</span>
                ) : item.fileName ? (
                  <span className="text-xs text-emerald-600">{item.fileName}</span>
                ) : (
                  <span className="text-xs text-zinc-400">
                    未指定の場合はプレースホルダー背景で代替
                  </span>
                )}
              </label>
              <label className="flex flex-col gap-1 text-sm">
                タイトル
                <input
                  className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  value={item.title}
                  onChange={(e) => updateItem(item.key, { title: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                テロップ
                <input
                  className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  value={item.caption}
                  onChange={(e) => updateItem(item.key, { caption: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                テロップの演出
                <select
                  className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  value={item.captionAnimation}
                  onChange={(e) =>
                    updateItem(item.key, {
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
                    value={item.durationInSeconds}
                    onChange={(e) =>
                      updateItem(item.key, {
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
                    value={item.startFromSeconds}
                    onChange={(e) =>
                      updateItem(item.key, {
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
            onClick={addItem}
            disabled={!canAddItem}
            className="self-start rounded-full border border-zinc-300 px-4 py-1.5 text-sm disabled:opacity-30 dark:border-zinc-700"
          >
            + 項目を追加
          </button>
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <legend className="px-1 text-sm font-medium">CTA(締め)</legend>
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
          onRender={() => handleRender("ranking", props)}
        />
      </section>

      <section className="flex flex-col items-center gap-3 lg:sticky lg:top-12 lg:self-start">
        <span className="text-sm text-zinc-500">
          プレビュー({(durationInFrames / VIDEO_FPS).toFixed(1)}秒)
        </span>
        <Player
          component={RankingVideo}
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
