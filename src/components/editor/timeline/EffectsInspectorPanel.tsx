"use client";

import { useState } from "react";
import type { ImageOverlay, TextOverlay } from "@video/shared/schema";
import type { ProjectSegment, VideoProject } from "@/lib/videoProject";
import { uploadImageFile } from "../uploadImageFile";
import { TextOverlayFields, createDefaultTextOverlay } from "./TextOverlayFields";
import { ImageOverlayFields, createDefaultImageOverlay } from "./ImageOverlayFields";

export type SegmentEffectsPatch = Partial<
  Pick<ProjectSegment, "zoom" | "overlays" | "images" | "emphasisWords" | "emphasisColor">
>;
export type ProjectEffectsPatch = Partial<Pick<VideoProject, "hook" | "cta" | "globalOverlays" | "globalImages">>;

type Props = {
  segments: ProjectSegment[];
  selectedSegmentKey: string | null;
  selectedCount: number;
  hook: VideoProject["hook"];
  cta: VideoProject["cta"];
  globalOverlays: VideoProject["globalOverlays"];
  globalImages: VideoProject["globalImages"];
  onUpdateSegmentEffects: (key: string, patch: SegmentEffectsPatch) => void;
  onUpdateProjectEffects: (patch: ProjectEffectsPatch) => void;
};

const DEFAULT_EMPHASIS_COLOR = "#FFE600";

/**
 * 「演出」タブの右側パネル。自動編集(Gemini)が決めた演出を、ここですべて手で直せるようにする。
 * 上半分は選択中クリップの演出(寄り・強調テキスト・字幕の強調単語)、下半分は動画全体の演出
 * (冒頭の見出し・締めの一言・ずっと出す文字)。自動編集を使わなかった場合も、ここから足せる。
 */
export const EffectsInspectorPanel: React.FC<Props> = ({
  segments,
  selectedSegmentKey,
  selectedCount,
  hook,
  cta,
  globalOverlays,
  globalImages,
  onUpdateSegmentEffects,
  onUpdateProjectEffects,
}) => {
  const [uploading, setUploading] = useState(false);
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

  /** 画像を選んだらアップロードし、その画像を初期位置(画面中央)で追加する。 */
  const addImage = async (file: File | undefined, onAdded: (image: ImageOverlay) => void) => {
    if (!file) return;
    setUploading(true);
    try {
      const { path } = await uploadImageFile(file);
      onAdded(createDefaultImageOverlay(path));
    } catch (error) {
      alert(error instanceof Error ? error.message : "画像のアップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="editor-inspector">
      <div className="editor-inspector-body">
        {selectedCount > 1 ? (
          <div className="editor-inspector-empty">
            <p>{selectedCount}件のクリップを選択中です。演出は1クリップずつ編集してください</p>
          </div>
        ) : selected ? (
          <div className="editor-inspector-fields">
            <h3>クリップ{selectedIndex + 1}の演出</h3>

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

            <div className="editor-field-row">
              <label className="editor-field">
                <span>字幕で強調する単語(、区切り)</span>
                <input
                  type="text"
                  value={(selected.emphasisWords ?? []).join("、")}
                  placeholder="例: 3倍、結論"
                  onChange={(e) => {
                    const words = e.target.value
                      .split(/[、,]/)
                      .map((w) => w.trim())
                      .filter((w) => w.length > 0);
                    onUpdateSegmentEffects(selected.key, { emphasisWords: words.length > 0 ? words : undefined });
                  }}
                />
              </label>
              <label className="editor-field">
                <span>強調の色</span>
                <input
                  type="color"
                  value={selected.emphasisColor ?? DEFAULT_EMPHASIS_COLOR}
                  onChange={(e) => onUpdateSegmentEffects(selected.key, { emphasisColor: e.target.value })}
                />
              </label>
            </div>

            <h3>強調テキスト({overlays.length}個)</h3>
            {overlays.map((overlay, i) => (
              <TextOverlayFields
                key={i}
                overlay={overlay}
                timeBaseLabel="クリップ先頭から"
                onChange={(patch) => setOverlays(overlays.map((o, j) => (j === i ? { ...o, ...patch } : o)))}
                onRemove={() => setOverlays(overlays.filter((_, j) => j !== i))}
              />
            ))}
            <button
              type="button"
              className="editor-toolbar-btn self-start"
              disabled={overlays.length >= 8}
              onClick={() => setOverlays([...overlays, createDefaultTextOverlay()])}
            >
              ＋ 強調テキストを追加
            </button>

            <h3>画像({images.length}枚)</h3>
            {images.map((image, i) => (
              <ImageOverlayFields
                key={i}
                image={image}
                timeBaseLabel="クリップ先頭から"
                onChange={(patch) => setImages(images.map((o, j) => (j === i ? { ...o, ...patch } : o)))}
                onRemove={() => setImages(images.filter((_, j) => j !== i))}
              />
            ))}
            <label className="editor-toolbar-btn self-start" style={{ cursor: uploading ? "wait" : "pointer" }}>
              {uploading ? "アップロード中..." : "＋ 画像を差し込む"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                disabled={uploading || images.length >= 8}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  void addImage(file, (image) => setImages([...images, image]));
                }}
              />
            </label>
          </div>
        ) : (
          <div className="editor-inspector-empty">
            <p>クリップを選択すると、そのクリップの寄り・強調テキストを編集できます</p>
          </div>
        )}

        <div className="editor-inspector-fields" style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12 }}>
          <h3>動画全体の演出</h3>
          <label className="editor-field">
            <span>冒頭の見出し(0〜3秒に重ねる。空にすると出さない)</span>
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
            <span>見出しの補足(小さい文字)</span>
            <input
              type="text"
              value={hook?.subline ?? ""}
              placeholder="(なし)"
              disabled={!hook}
              onChange={(e) =>
                hook ? onUpdateProjectEffects({ hook: { ...hook, subline: e.target.value || undefined } }) : undefined
              }
            />
          </label>
          <label className="editor-field">
            <span>締めの一言(最後の数秒に重ねる。空にすると出さない)</span>
            <input
              type="text"
              value={cta?.text ?? ""}
              placeholder="(なし)"
              onChange={(e) => onUpdateProjectEffects({ cta: e.target.value ? { text: e.target.value } : null })}
            />
          </label>

          <h3>ずっと出す文字({globals.length}個)</h3>
          {globals.map((overlay, i) => (
            <TextOverlayFields
              key={i}
              overlay={overlay}
              timeBaseLabel="動画の先頭から"
              onChange={(patch) => setGlobals(globals.map((o, j) => (j === i ? { ...o, ...patch } : o)))}
              onRemove={() => setGlobals(globals.filter((_, j) => j !== i))}
            />
          ))}
          <button
            type="button"
            className="editor-toolbar-btn self-start"
            disabled={globals.length >= 4}
            onClick={() => setGlobals([...globals, { ...createDefaultTextOverlay(), yPercent: 15 }])}
          >
            ＋ ずっと出す文字を追加
          </button>

          <h3>ずっと出す画像({globalImageList.length}枚・ロゴ等)</h3>
          {globalImageList.map((image, i) => (
            <ImageOverlayFields
              key={i}
              image={image}
              timeBaseLabel="動画の先頭から"
              onChange={(patch) => setGlobalImages(globalImageList.map((o, j) => (j === i ? { ...o, ...patch } : o)))}
              onRemove={() => setGlobalImages(globalImageList.filter((_, j) => j !== i))}
            />
          ))}
          <label className="editor-toolbar-btn self-start" style={{ cursor: uploading ? "wait" : "pointer" }}>
            {uploading ? "アップロード中..." : "＋ ずっと出す画像を差し込む"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              disabled={uploading || globalImageList.length >= 4}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                void addImage(file, (image) => setGlobalImages([...globalImageList, { ...image, widthPercent: 25, yPercent: 10 }]));
              }}
            />
          </label>
        </div>
      </div>
    </div>
  );
};
