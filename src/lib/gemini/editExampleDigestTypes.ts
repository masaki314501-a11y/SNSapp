import { z } from "zod";

/**
 * 編集例(実例動画)を「動画そのもの」の代わりにfew-shotへ渡すための軽量な要約。
 * autoEditTypes.tsのcaptionAnimation/sfxPresetIdのような、このアプリ固有の候補IDには
 * 寄せない(実例動画は外部のSNS動画で、このアプリのプリセットIDと対応しないため)。
 * 代わりに「どんな工夫をしているか」を自由記述(technique)で残し、後から読んでも
 * 動画を見返さずに編集の勘所が伝わるようにする。
 */
export const editExampleDigestSegmentSchema = z.object({
  /** その区間で実際に話されている/表示されているテロップの内容。 */
  caption: z.string(),
  /** その区間の長さ(秒)。テンポ感を伝えるための情報。 */
  durationSeconds: z.number().positive(),
  /** その区間で使われている編集の工夫(テロップの出方・ナレーションの有無・効果音・間の取り方等)。 */
  technique: z.string(),
});

export const editExampleDigestSchema = z.object({
  segments: z.array(editExampleDigestSegmentSchema),
  /** 動画全体を通した編集方針(フックの作り方・テンポ・山場の作り方等)。 */
  summary: z.string(),
});

export type EditExampleDigestSegment = z.infer<typeof editExampleDigestSegmentSchema>;
export type EditExampleDigest = z.infer<typeof editExampleDigestSchema>;
