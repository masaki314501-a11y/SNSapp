"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadProject, saveProject, type ProjectSegment, type VideoProject } from "@/lib/videoProject";
import {
  DEFAULT_EMPHASIS,
  EmphasisStyleFields,
  KeywordHighlightFields,
} from "@/components/editor/timeline/CaptionEmphasisFields";
import { ChevronRightIcon } from "@/components/icons";
import { ScenePreview, type PreviewScene } from "./ScenePreview";
import { resolveFontFamilyStack, type CaptionEmphasis } from "@video/shared/schema";
import { ensureCaptionFontLoaded } from "@video/shared/font";

const formatTime = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/**
 * 自動編集の後に挟む「強調する字幕を選ぶ」画面。自動編集の字幕は強調なし・書体は全体で1つなので、
 * 強調したい字幕をここで本人がタップして選び、強調の見た目(帯・色・書体・効果音)と重大ワードをまとめて決める。
 * 動画編集に詳しくない人でも迷わないよう、編集画面の字幕タブで1クリップずつ設定するのではなく、字幕を一覧で並べる。
 * 選んだ内容はAIを使わず、そのまま字幕に反映する(1クリップずつの細かい調整は、次の編集画面でできる)。
 */
export const EmphasisScreen: React.FC = () => {
  const router = useRouter();
  const [project, setProject] = useState<VideoProject | null>(null);
  const [hasChecked, setHasChecked] = useState(false);
  /** プレビューで流している場面(字幕のkeyと、流し直し用の番号)。 */
  const [playing, setPlaying] = useState<{ key: string; nonce: number } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorageからの一度きりの初期ハイドレーション
    setProject(loadProject());
    setHasChecked(true);
  }, []);

  if (!hasChecked) return null;
  if (!project) {
    return (
      <main className="flow-main">
        <div className="panel flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm font-medium">対象の動画がありません</p>
          <a href="/create" className="btn-primary px-4 py-1.5 text-sm">
            動画をアップロードする →
          </a>
        </div>
      </main>
    );
  }

  const preset = project.emphasisPreset ?? { emphasis: DEFAULT_EMPHASIS };
  if (preset.emphasis.fontFamily) void ensureCaptionFontLoaded(preset.emphasis.fontFamily);
  const update = (next: VideoProject) => {
    setProject(next);
    saveProject(next);
  };
  const withEmphasis = (segment: ProjectSegment, on: boolean): ProjectSegment =>
    on
      ? { ...segment, captionEmphasis: preset.emphasis, emphasisSfxPresetId: preset.sfxPresetId }
      : { ...segment, captionEmphasis: undefined, emphasisSfxPresetId: undefined };

  const toggle = (key: string) => {
    // 切り替えた字幕の場面を流し、強調した見た目をその場で見せる
    setPlaying({ key, nonce: Date.now() });
    update({
      ...project,
      segments: project.segments.map((segment) =>
        segment.key === key ? withEmphasis(segment, segment.captionEmphasis === undefined) : segment
      ),
    });
  };

  // 見た目を変えたら、もう強調してある字幕すべてに同じ見た目を付け直す(強調の見た目を動画の中でそろえるため)
  const changePreset = (patch: { emphasis?: CaptionEmphasis; sfxPresetId?: string }) => {
    const nextPreset = {
      emphasis: patch.emphasis ?? preset.emphasis,
      sfxPresetId: "sfxPresetId" in patch ? patch.sfxPresetId : preset.sfxPresetId,
    };
    update({
      ...project,
      emphasisPreset: nextPreset,
      segments: project.segments.map((segment) =>
        segment.captionEmphasis
          ? { ...segment, captionEmphasis: nextPreset.emphasis, emphasisSfxPresetId: nextPreset.sfxPresetId }
          : segment
      ),
    });
  };

  const starts = project.segments.map((_, index) =>
    project.segments.slice(0, index).reduce((sum, segment) => sum + segment.durationInSeconds, 0)
  );
  const captions = project.segments.flatMap((segment, index) =>
    segment.caption.trim() ? [{ segment, start: starts[index] }] : []
  );
  const selectedCount = captions.filter(({ segment }) => segment.captionEmphasis).length;
  const playingSegment = playing ? project.segments.find((segment) => segment.key === playing.key) : undefined;
  const playingScene: PreviewScene | null = playingSegment
    ? {
        from: playingSegment.startFromSeconds,
        to: playingSegment.startFromSeconds + playingSegment.durationInSeconds,
        caption: playingSegment.caption,
        emphasis: playingSegment.captionEmphasis,
        nonce: playing!.nonce,
      }
    : null;

  return (
    <>
      <main className="flow-main">
        <div className="panel flex flex-col gap-1 p-4">
          <span className="text-sm font-bold">強調したい字幕をタップしてください</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            選んだ字幕は、下で決めた見た目(帯・色・書体)になり、効果音が鳴ります。なくても進めます。
          </span>
        </div>

        <div className="panel flex flex-col gap-2 p-4">
          <span className="text-sm font-bold">強調の見た目(選んだ字幕すべてに使います)</span>
          {/* どう見えるかの見本(帯・文字の色だけの簡単な見本。動画での見え方は次の編集画面のプレビューで確かめられる) */}
          <div className="flex justify-center rounded-lg p-4" style={{ background: "#5b6b78" }}>
            <span
              style={{
                display: "inline-block",
                fontWeight: 900,
                fontSize: 20,
                padding: preset.emphasis.band ? "6px 14px" : undefined,
                borderRadius: 6,
                background: preset.emphasis.band ? (preset.emphasis.bandColor ?? "#FFFFFF") : undefined,
                color: preset.emphasis.textColor ?? (preset.emphasis.band ? "#111111" : "#FFFFFF"),
                fontFamily: preset.emphasis.fontFamily ? resolveFontFamilyStack(preset.emphasis.fontFamily) : undefined,
                WebkitTextStroke: preset.emphasis.band ? undefined : "6px #000000",
                paintOrder: "stroke fill",
              }}
            >
              強調した字幕の見本
            </span>
          </div>
          <EmphasisStyleFields emphasis={preset.emphasis} sfxPresetId={preset.sfxPresetId} onChange={changePreset} />
        </div>

        <div className="panel flex flex-col gap-2 p-4">
          <span className="text-sm font-bold">重大ワード</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            ここに入れた言葉は、すべての字幕で選んだ色・少し大きい文字になります
          </span>
          <KeywordHighlightFields
            keywords={project.keywordHighlights ?? []}
            onChange={(keywordHighlights) => update({ ...project, keywordHighlights })}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold">
            字幕({captions.length}個中 {selectedCount}個を強調)
          </span>
          {/* 一覧を下へ送っても見えるよう、プレビューは上に貼り付けておく */}
          {captions.length > 0 ? (
            <div className="sticky z-10 pb-1" style={{ top: 0, background: "var(--background)" }}>
              <ScenePreview videoSrc={`/api/media/${project.videoPath}`} scene={playingScene} />
            </div>
          ) : null}
          {captions.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              字幕がありません。次の編集画面で字幕を付けてから、字幕タブで強調できます。
            </p>
          ) : (
            captions.map(({ segment, start }) => {
              const selected = segment.captionEmphasis !== undefined;
              const isPlaying = playing?.key === segment.key;
              return (
                <div
                  key={segment.key}
                  className="flex items-stretch overflow-hidden rounded-lg"
                  style={{
                    border: `2px solid ${selected ? "var(--accent)" : "var(--color-neutral-solid-gray-420)"}`,
                    background: selected ? "var(--accent-soft)" : "var(--background-elevated)",
                  }}
                >
                  {/* 場面を見る(押すとプレビューでその場面だけ流す)。強調の切り替えとは別のボタンにする */}
                  <button
                    type="button"
                    onClick={() => setPlaying({ key: segment.key, nonce: Date.now() })}
                    aria-label={`${formatTime(start)}の場面を見る`}
                    className="flex shrink-0 flex-col items-center justify-center gap-0.5 px-3 text-xs"
                    style={{
                      color: isPlaying ? "var(--accent)" : "var(--muted)",
                      borderRight: "1px solid var(--border)",
                      minWidth: 56,
                    }}
                  >
                    <span aria-hidden style={{ fontSize: 16 }}>▶</span>
                    {formatTime(start)}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggle(segment.key)}
                    aria-pressed={selected}
                    className="flex flex-1 items-center gap-3 p-3 text-left"
                  >
                    <span className="flex-1 text-sm">{segment.caption}</span>
                    <span className={`badge-pill ${selected ? "success" : "neutral"} shrink-0`}>
                      {selected ? "強調" : "ふつう"}
                    </span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </main>

      <div className="bottom-action-bar">
        <button type="button" onClick={() => router.push("/edit")} className="btn-primary">
          {selectedCount > 0 ? "この内容で編集画面へ" : "強調せずに編集画面へ"}
          <ChevronRightIcon size={18} />
        </button>
      </div>
    </>
  );
};
