"use client";

import { useState } from "react";
import { WaitTime } from "@/components/WaitTime";
import type { ImageOverlay, TextOverlay } from "@video/shared/schema";
import type { ProjectSegment, VideoProject } from "@/lib/videoProject";
import { FlagIcon, ImageIcon, PlusIcon, SparkleIcon, TextIcon } from "@/components/icons";
import { uploadImageFile } from "../uploadImageFile";
import { SettingsSection } from "../SettingsSection";
import { TextOverlayFields, createDefaultTextOverlay } from "./TextOverlayFields";
import { ImageOverlayFields, createDefaultImageOverlay } from "./ImageOverlayFields";
import { toFriendlyErrorMessage } from "@/lib/friendlyError";

export type SegmentEffectsPatch = Partial<
  Pick<ProjectSegment, "zoom" | "overlays" | "images" | "emphasisWords" | "emphasisColor">
>;
export type ProjectEffectsPatch = Partial<Pick<VideoProject, "hook" | "cta" | "globalOverlays" | "globalImages">>;
export type EffectsScope = "clip" | "global";

type Props = {
  /** 「クリップごと」の演出か、「動画全体」の演出か(パネル上部の切り替え)。 */
  scope: EffectsScope;
  onChangeScope: (scope: EffectsScope) => void;
  segments: ProjectSegment[];
  selectedSegmentKey: string | null;
  selectedCount: number;
  hook: VideoProject["hook"];
  cta: VideoProject["cta"];
  globalOverlays: VideoProject["globalOverlays"];
  globalImages: VideoProject["globalImages"];
  fadeInOut: boolean;
  onChangeFadeInOut: (value: boolean) => void;
  /** 動画全体の長さ(ずっと出す文字・画像の表示時間を選べる範囲)。 */
  totalSeconds: number;
  onUpdateSegmentEffects: (key: string, patch: SegmentEffectsPatch) => void;
  onUpdateProjectEffects: (patch: ProjectEffectsPatch) => void;
  /** 表示時間を動かした時に、その時刻を動画で見せる(クリップ内の秒数 / 動画全体の秒数)。 */
  onPreviewInClip: (segmentKey: string, offsetSeconds: number) => void;
  onPreviewInProgram: (seconds: number) => void;
};

/**
 * 「演出」タブのパネル。自動編集(Gemini)が決めた演出を、ここですべて手で直せるようにする。
 * 上部の切り替えで、選択中クリップの演出(寄り・強調テキスト・画像)と、動画全体の演出
 * (冒頭の見出し・締めの一言・ずっと出す文字・画像・全体のフェード)を分けて表示する
 * (以前は縦に続けて並べていて、どちらを編集しているのか見分けにくかった)。
 * 字幕の強調(強調する単語・色)は字幕に関わる設定なので、字幕タブ(CaptionInspectorPanel)に置く。
 */
export const EffectsInspectorPanel: React.FC<Props> = ({
  scope,
  onChangeScope,
  segments,
  selectedSegmentKey,
  selectedCount,
  hook,
  cta,
  globalOverlays,
  globalImages,
  fadeInOut,
  onChangeFadeInOut,
  totalSeconds,
  onUpdateSegmentEffects,
  onUpdateProjectEffects,
  onPreviewInClip,
  onPreviewInProgram,
}) => {
  const [uploading, setUploading] = useState(false);
  // 追加した直後の1件だけは開いた状態で見せる(他は畳んでおく)。
  const [justAdded, setJustAdded] = useState<{ list: string; index: number } | null>(null);
  const selectedIndex = selectedSegmentKey ? segments.findIndex((s) => s.key === selectedSegmentKey) : -1;
  const selected = selectedIndex >= 0 ? segments[selectedIndex] : null;
  const overlays = selected?.overlays ?? [];
  const globals = globalOverlays ?? [];

  const setOverlays = (next: TextOverlay[]) => {
    if (!selected) return;
    onUpdateSegmentEffects(selected.key, { overlays: next.length > 0 ? next : undefined });
  };
  const setGlobals = (next: TextOverlay[]) => onUpdateProjectEffects({ globalOverlays: next.length > 0 ? next : null });
  const images = selected?.images ?? [];
  const globalImageList = globalImages ?? [];
  const setImages = (next: ImageOverlay[]) => {
    if (!selected) return;
    onUpdateSegmentEffects(selected.key, { images: next.length > 0 ? next : undefined });
  };
  const setGlobalImages = (next: ImageOverlay[]) =>
    onUpdateProjectEffects({ globalImages: next.length > 0 ? next : null });
  const isJustAdded = (list: string, index: number) => justAdded?.list === list && justAdded.index === index;

  /** 画像を選んだらアップロードし、その画像を初期位置(画面中央)で追加する。 */
  const addImage = async (file: File | undefined, onAdded: (image: ImageOverlay) => void) => {
    if (!file) return;
    setUploading(true);
    try {
      const { path } = await uploadImageFile(file);
      onAdded(createDefaultImageOverlay(path));
    } catch (error) {
      alert(toFriendlyErrorMessage(error, "画像のアップロードに失敗しました"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="editor-inspector">
      <div className="editor-inspector-body">
        <div className="segmented" role="tablist" aria-label="演出の対象">
          <button
            type="button"
            role="tab"
            aria-selected={scope === "clip"}
            className={scope === "clip" ? "active" : undefined}
            onClick={() => onChangeScope("clip")}
          >
            クリップごと
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === "global"}
            className={scope === "global" ? "active" : undefined}
            onClick={() => onChangeScope("global")}
          >
            動画全体
          </button>
        </div>

        {scope === "clip" ? (
          selectedCount > 1 ? (
            <div className="editor-inspector-empty">
              <p>{selectedCount}件のクリップを選択中です。演出は1クリップずつ編集してください</p>
            </div>
          ) : selected ? (
            <div className="editor-inspector-fields">
              <SettingsSection title="寄り(ズーム)">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.zoom !== undefined}
                    onChange={(e) =>
                      onUpdateSegmentEffects(selected.key, {
                        zoom: e.target.checked
                          ? { scale: 1.3, style: "punch", focusXPercent: 50, focusYPercent: 40 }
                          : undefined,
                      })
                    }
                  />
                  <span className="field-label">寄り(ズーム)を入れる</span>
                </label>
                {selected.zoom ? (
                  <>
                    <div className="editor-field-row">
                      <label className="editor-field">
                        <span>倍率 {selected.zoom.scale.toFixed(2)}倍</span>
                        <input
                          type="range"
                          min={1.05}
                          max={2}
                          step={0.05}
                          value={selected.zoom.scale}
                          onChange={(e) =>
                            onUpdateSegmentEffects(selected.key, { zoom: { ...selected.zoom!, scale: Number(e.target.value) } })
                          }
                        />
                      </label>
                      <label className="editor-field">
                        <span>寄り方</span>
                        <select
                          value={selected.zoom.style}
                          onChange={(e) =>
                            onUpdateSegmentEffects(selected.key, {
                              zoom: { ...selected.zoom!, style: e.target.value as "punch" | "slow" },
                            })
                          }
                        >
                          <option value="punch">一気に寄る</option>
                          <option value="slow">じわじわ寄る</option>
                        </select>
                      </label>
                    </div>
                    <div className="editor-field-row">
                      <label className="editor-field">
                        <span>寄る中心(横) {Math.round(selected.zoom.focusXPercent)}%</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={selected.zoom.focusXPercent}
                          onChange={(e) =>
                            onUpdateSegmentEffects(selected.key, {
                              zoom: { ...selected.zoom!, focusXPercent: Number(e.target.value) },
                            })
                          }
                        />
                      </label>
                      <label className="editor-field">
                        <span>寄る中心(縦) {Math.round(selected.zoom.focusYPercent)}%</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={selected.zoom.focusYPercent}
                          onChange={(e) =>
                            onUpdateSegmentEffects(selected.key, {
                              zoom: { ...selected.zoom!, focusYPercent: Number(e.target.value) },
                            })
                          }
                        />
                      </label>
                    </div>
                  </>
                ) : null}
              </SettingsSection>

              <SettingsSection title="強調テキスト" icon={<TextIcon size={16} />}>
                {overlays.map((overlay, i) => (
                  <TextOverlayFields
                    key={i}
                    overlay={overlay}
                    timeBaseLabel="クリップの先頭から"
                    rangeSeconds={selected.durationInSeconds}
                    defaultOpen={isJustAdded(`overlays-${selected.key}`, i)}
                    onChange={(patch) => setOverlays(overlays.map((o, j) => (j === i ? { ...o, ...patch } : o)))}
                    onRemove={() => setOverlays(overlays.filter((_, j) => j !== i))}
                    onPreview={(offset) => onPreviewInClip(selected.key, offset)}
                  />
                ))}
                <button
                  type="button"
                  className="editor-toolbar-btn self-start"
                  disabled={overlays.length >= 8}
                  onClick={() => {
                    setJustAdded({ list: `overlays-${selected.key}`, index: overlays.length });
                    setOverlays([...overlays, createDefaultTextOverlay()]);
                  }}
                >
                  <PlusIcon size={14} />
                  強調テキストを追加
                </button>
              </SettingsSection>

              <SettingsSection title="画像" icon={<ImageIcon size={16} />}>
                {images.map((image, i) => (
                  <ImageOverlayFields
                    key={i}
                    image={image}
                    label={`画像${i + 1}`}
                    timeBaseLabel="クリップの先頭から"
                    rangeSeconds={selected.durationInSeconds}
                    defaultOpen={isJustAdded(`images-${selected.key}`, i)}
                    onChange={(patch) => setImages(images.map((o, j) => (j === i ? { ...o, ...patch } : o)))}
                    onRemove={() => setImages(images.filter((_, j) => j !== i))}
                    onPreview={(offset) => onPreviewInClip(selected.key, offset)}
                  />
                ))}
                <label className="editor-toolbar-btn self-start" style={{ cursor: uploading ? "wait" : "pointer" }}>
                  <PlusIcon size={14} />
                  {uploading ? "アップロード中..." : "画像を追加"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    disabled={uploading || images.length >= 8}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      void addImage(file, (image) => {
                        setJustAdded({ list: `images-${selected.key}`, index: images.length });
                        setImages([...images, image]);
                      });
                    }}
                  />
                </label>
                <WaitTime task="file-upload" units={1} active={uploading} />
              </SettingsSection>
            </div>
          ) : (
            <div className="editor-inspector-empty">
              <p>クリップを選択すると、そのクリップの寄り・強調テキスト・画像を編集できます</p>
            </div>
          )
        ) : (
          <div className="editor-inspector-fields">
            <SettingsSection title="冒頭の見出し" icon={<SparkleIcon size={16} />}>
              <p className="settings-hint">動画の最初(0〜3秒)に重ねます。見出しを空にすると出しません</p>
              {/* 見出しと補足は2つで1組(見出しの下に補足が小さく出る)。枠で囲み、見え方も添えて締めの一言と区別する */}
              <div className="hook-set">
                {hook?.headline ? (
                  <div className="hook-set-preview" aria-hidden="true">
                    <strong>{hook.headline}</strong>
                    {hook.subline ? <small>{hook.subline}</small> : null}
                  </div>
                ) : null}
                <label className="editor-field">
                  <span>見出し(大きい文字)</span>
                  <input
                    type="text"
                    value={hook?.headline ?? ""}
                    placeholder="(なし)"
                    onChange={(e) =>
                      onUpdateProjectEffects({ hook: e.target.value ? { ...hook, headline: e.target.value } : null })
                    }
                  />
                </label>
                <label className="editor-field">
                  <span>補足(見出しの下に小さく)</span>
                  <input
                    type="text"
                    value={hook?.subline ?? ""}
                    placeholder={hook ? "(なし)" : "先に見出しを入れてください"}
                    disabled={!hook}
                    onChange={(e) =>
                      hook ? onUpdateProjectEffects({ hook: { ...hook, subline: e.target.value || undefined } }) : undefined
                    }
                  />
                </label>
              </div>
            </SettingsSection>

            <SettingsSection title="締めの一言" icon={<FlagIcon size={16} />}>
              <p className="settings-hint">動画の最後の数秒に重ねます。空にすると出しません</p>
              <div className="editor-field">
                <input
                  type="text"
                  aria-label="締めの一言"
                  value={cta?.text ?? ""}
                  placeholder="(なし)"
                  onChange={(e) => onUpdateProjectEffects({ cta: e.target.value ? { text: e.target.value } : null })}
                />
              </div>
            </SettingsSection>

            <SettingsSection title="ずっと出す文字" icon={<TextIcon size={16} />}>
              {globals.map((overlay, i) => (
                <TextOverlayFields
                  key={i}
                  overlay={overlay}
                  timeBaseLabel="動画の先頭から"
                  rangeSeconds={totalSeconds}
                  defaultOpen={isJustAdded("globals", i)}
                  onChange={(patch) => setGlobals(globals.map((o, j) => (j === i ? { ...o, ...patch } : o)))}
                  onRemove={() => setGlobals(globals.filter((_, j) => j !== i))}
                  onPreview={onPreviewInProgram}
                />
              ))}
              <button
                type="button"
                className="editor-toolbar-btn self-start"
                disabled={globals.length >= 4}
                onClick={() => {
                  setJustAdded({ list: "globals", index: globals.length });
                  setGlobals([...globals, { ...createDefaultTextOverlay(), yPercent: 15 }]);
                }}
              >
                <PlusIcon size={14} />
                ずっと出す文字を追加
              </button>
            </SettingsSection>

            <SettingsSection title="ずっと出す画像(ロゴ等)" icon={<ImageIcon size={16} />}>
              {globalImageList.map((image, i) => (
                <ImageOverlayFields
                  key={i}
                  image={image}
                  label={`画像${i + 1}`}
                  timeBaseLabel="動画の先頭から"
                  rangeSeconds={totalSeconds}
                  defaultOpen={isJustAdded("globalImages", i)}
                  onChange={(patch) => setGlobalImages(globalImageList.map((o, j) => (j === i ? { ...o, ...patch } : o)))}
                  onRemove={() => setGlobalImages(globalImageList.filter((_, j) => j !== i))}
                  onPreview={onPreviewInProgram}
                />
              ))}
              <label className="editor-toolbar-btn self-start" style={{ cursor: uploading ? "wait" : "pointer" }}>
                <PlusIcon size={14} />
                {uploading ? "アップロード中..." : "ずっと出す画像を追加"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  hidden
                  disabled={uploading || globalImageList.length >= 4}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    void addImage(file, (image) => {
                      setJustAdded({ list: "globalImages", index: globalImageList.length });
                      setGlobalImages([...globalImageList, { ...image, widthPercent: 25, yPercent: 10 }]);
                    });
                  }}
                />
              </label>
              <WaitTime task="file-upload" units={1} active={uploading} />
            </SettingsSection>

            <SettingsSection title="全体のフェード">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={fadeInOut} onChange={(e) => onChangeFadeInOut(e.target.checked)} />
                <span className="field-label">動画の最初と最後をフェードイン/アウトする</span>
              </label>
            </SettingsSection>
          </div>
        )}
      </div>
    </div>
  );
};
