"use client";

import { useState } from "react";
import { uploadImageFile } from "@/components/editor/uploadImageFile";
import { toFriendlyErrorMessage } from "@/lib/friendlyError";
import { PlusIcon } from "@/components/icons";

/** 自動編集で使ってよい画像の上限。サーバー(materialImage.tsのMAX_MATERIAL_IMAGES)と合わせる。 */
const MAX_MATERIAL_IMAGES = 20;

export type MaterialImage = { path: string; name: string };

type Props = {
  images: MaterialImage[];
  onChange: (images: MaterialImage[]) => void;
  /** 画像が足りない所に、AIで画像を作るか。 */
  generateMissing: boolean;
  onChangeGenerateMissing: (value: boolean) => void;
  disabled: boolean;
};

/**
 * 自動編集で使う画像(症例写真・商品写真など)を渡す欄。AIが話の内容に合わせて、いつ・どこに出すかを決める
 * (ランキングなら、話している間は大きく出し、順位が決まったら枠に入れて最後まで残す)。
 * 名前は任意。付けておくと、どの話でどの画像を使うかの取り違えが減る。
 */
export const MaterialImagesPanel: React.FC<Props> = ({
  images,
  onChange,
  generateMissing,
  onChangeGenerateMissing,
  disabled,
}) => {
  const [uploading, setUploading] = useState(false);
  const canAddMore = images.length < MAX_MATERIAL_IMAGES;

  const handleAddFiles = async (files: File[]) => {
    const room = MAX_MATERIAL_IMAGES - images.length;
    if (files.length === 0 || room <= 0) return;
    if (files.length > room) {
      alert(`画像は${MAX_MATERIAL_IMAGES}枚までのため、最初の${room}枚だけ追加します`);
    }
    setUploading(true);
    const added: MaterialImage[] = [];
    try {
      for (const file of files.slice(0, room)) {
        const { path } = await uploadImageFile(file);
        // ファイル名(拡張子を除く)を名前の下書きにする。「IMG_1234」のような意味の無い名前は空にする。
        const baseName = file.name.replace(/\.[^.]+$/, "");
        added.push({ path, name: /^(img|dsc|image|photo|screenshot)[\s_-]?\d/i.test(baseName) ? "" : baseName });
      }
    } catch (error) {
      alert(toFriendlyErrorMessage(error, "画像のアップロードに失敗しました"));
    } finally {
      if (added.length > 0) onChange([...images, ...added]);
      setUploading(false);
    }
  };

  return (
    <div className="panel flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold">使う画像</span>
        <span className="badge-pill neutral">なくてもOK</span>
      </div>
      <span className="text-xs" style={{ color: "var(--muted)" }}>
        症例写真や商品写真など、動画に出したい画像を選ぶと、AIが話の流れに合わせて出す場所とタイミングを決めます。
        何の画像か名前を付けておくと、取り違えが減ります。
      </span>

      {images.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((image, index) => (
            <div key={image.path} className="flex flex-col gap-1">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/media/${image.path}`}
                  alt={image.name || `画像${index + 1}`}
                  className="h-24 w-full rounded-lg object-cover"
                  style={{ border: "1px solid var(--border)" }}
                />
                <button
                  type="button"
                  onClick={() => onChange(images.filter((other) => other.path !== image.path))}
                  disabled={disabled || uploading}
                  className="absolute right-1 top-1 rounded-full px-1.5 text-xs"
                  style={{ background: "rgba(0,0,0,0.65)", color: "#fff" }}
                  aria-label={`画像${index + 1}を外す`}
                >
                  ✕
                </button>
              </div>
              <input
                type="text"
                value={image.name}
                maxLength={100}
                disabled={disabled}
                onChange={(e) =>
                  onChange(images.map((other) => (other.path === image.path ? { ...other, name: e.target.value } : other)))
                }
                placeholder="何の画像か(例: 八重歯)"
                className="field-input w-full text-xs"
                aria-label={`画像${index + 1}の名前`}
              />
            </div>
          ))}
        </div>
      ) : null}

      <input
        id="material-image-file"
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        disabled={disabled || uploading || !canAddMore}
        onChange={(e) => {
          const selected = Array.from(e.target.files ?? []);
          // 同じファイルを外した後にもう一度選べるよう、選択状態は毎回空に戻す。
          e.target.value = "";
          void handleAddFiles(selected);
        }}
      />
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={generateMissing}
          disabled={disabled}
          onChange={(e) => onChangeGenerateMissing(e.target.checked)}
          className="mt-1"
        />
        <span className="flex flex-col gap-0.5">
          <span>画像が足りない所は、AIで画像を作る</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            医療・美容・健康の話は、本物の写真と誤解されないようイラスト風で作り、「※画像はイメージです」を添えます。
            1枚につき数円〜十円ほどかかります(同じ画像は使い回します)
          </span>
        </span>
      </label>

      {canAddMore ? (
        <label
          htmlFor="material-image-file"
          className="btn-outline flex w-fit cursor-pointer items-center gap-1 px-4 py-2 text-sm font-bold"
          aria-disabled={disabled || uploading}
        >
          <PlusIcon size={16} />
          {uploading ? "アップロード中…" : images.length > 0 ? "画像を追加する" : "画像を選ぶ"}
        </label>
      ) : (
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          画像は{MAX_MATERIAL_IMAGES}枚までです
        </span>
      )}
    </div>
  );
};
