import type { RawAutoEditPlan } from "./autoEditTypes";

/**
 * 同じ正解動画を何回か書き起こした結果を、多数決で1つにまとめる。
 * AIの書き起こしは読むたびに取りこぼす物が変わり(ランキングの項目名のラベルが、ある回は37個・ある回は0個など)、
 * 1回分だけをお手本・採点の基準にすると大きくぶれたため。2回以上の書き起こしで同じ時刻に出てくる物だけを残す。
 */

type Clip = RawAutoEditPlan["clips"][number];

/** 要素が出る時刻(素材上の秒)。 */
const at = (clip: Clip, offset: number | null | undefined) => clip.sourceStartSeconds + (offset ?? 0);

const normalize = (text: string) => text.replace(/[\s\n]/g, "");

/** 2つの文字が同じ物を指しているか(片方がもう片方を含む、または先頭3文字が同じ)。 */
const sameText = (a: string, b: string) => {
  const x = normalize(a);
  const y = normalize(b);
  return x === y || x.includes(y) || y.includes(x) || (x.length >= 3 && x.slice(0, 3) === y.slice(0, 3));
};

type Located<T> = { t: number; item: T };

const collect = <T>(plan: RawAutoEditPlan, pick: (clip: Clip) => { item: T; offset: number | null | undefined }[]): Located<T>[] =>
  plan.clips.flatMap((clip) => pick(clip).map(({ item, offset }) => ({ t: at(clip, offset), item })));

/** othersの中で、近い時刻に同じ物がある書き起こしの数。 */
const support = <T>(target: Located<T>, others: Located<T>[][], tolerance: number, same: (a: T, b: T) => boolean) =>
  others.filter((list) => list.some((other) => Math.abs(other.t - target.t) <= tolerance && same(target.item, other.item))).length;

/** 時刻tを含むクリップの番号(無ければ一番近いクリップ)。 */
const clipIndexAt = (clips: Clip[], t: number) => {
  const inside = clips.findIndex((clip) => t >= clip.sourceStartSeconds - 0.01 && t < clip.sourceEndSeconds);
  if (inside >= 0) return inside;
  let best = 0;
  clips.forEach((clip, i) => {
    if (Math.abs(clip.sourceStartSeconds - t) < Math.abs(clips[best].sourceStartSeconds - t)) best = i;
  });
  return best;
};

/**
 * 各要素(強調テキスト・画像・効果音・寄り)について、半分を超える書き起こしに出てくる物を残す。
 * 土台にするのは、クリップの区切り・字幕・画面全体の要素がそろっている1回目の書き起こし。
 * 土台に無いが他の回の多くに出てくる物は、その時刻のクリップに足す。
 */
export const mergeBreakdowns = (plans: RawAutoEditPlan[]): RawAutoEditPlan => {
  if (plans.length <= 1) return plans[0];
  const need = Math.floor(plans.length / 2); // 自分以外にこの数以上あれば残す(3回なら他の1回)
  const base = plans[0];
  const clips: Clip[] = base.clips.map((clip) => ({ ...clip, overlays: [], images: [], sfx: [], zoom: null }));

  type Overlay = NonNullable<Clip["overlays"]>[number];
  type Image = NonNullable<Clip["images"]>[number];
  type Sfx = NonNullable<Clip["sfx"]>[number];
  type Zoom = NonNullable<Clip["zoom"]>;
  const overlays = plans.map((plan) => collect<Overlay>(plan, (clip) => (clip.overlays ?? []).map((item) => ({ item, offset: item.startOffsetSeconds }))));
  const images = plans.map((plan) => collect<Image>(plan, (clip) => (clip.images ?? []).map((item) => ({ item, offset: item.startOffsetSeconds }))));
  const sfx = plans.map((plan) => collect<Sfx>(plan, (clip) => (clip.sfx ?? []).map((item) => ({ item, offset: item.offsetSeconds }))));
  const zooms = plans.map((plan) =>
    collect<Zoom>(plan, (clip) => (clip.zoom && clip.zoom.scale > 1.001 ? [{ item: clip.zoom, offset: 0 }] : []))
  );

  /** 多数決で残す物を、重ならないように集める(先の回にある物を優先)。 */
  const vote = <T>(lists: Located<T>[][], tolerance: number, same: (a: T, b: T) => boolean): Located<T>[] => {
    const kept: Located<T>[] = [];
    lists.forEach((list, i) => {
      const others = lists.filter((_, j) => j !== i);
      for (const entry of list) {
        if (support(entry, others, tolerance, same) < need) continue;
        if (kept.some((k) => Math.abs(k.t - entry.t) <= tolerance && same(k.item, entry.item))) continue;
        kept.push(entry);
      }
    });
    return kept;
  };

  for (const { t, item } of vote(overlays, 1.0, (a, b) => sameText(a.text, b.text))) {
    const clip = clips[clipIndexAt(clips, t)];
    clip.overlays!.push({ ...item, startOffsetSeconds: Math.round((t - clip.sourceStartSeconds) * 10) / 10 });
  }
  for (const { t, item } of vote(images, 1.5, () => true)) {
    const clip = clips[clipIndexAt(clips, t)];
    clip.images!.push({ ...item, startOffsetSeconds: Math.round((t - clip.sourceStartSeconds) * 10) / 10 });
  }
  for (const { t, item } of vote(sfx, 0.6, () => true)) {
    const clip = clips[clipIndexAt(clips, t)];
    clip.sfx!.push({ ...item, offsetSeconds: Math.round((t - clip.sourceStartSeconds) * 10) / 10 });
  }
  for (const { t, item } of vote(zooms, 1.0, () => true)) {
    const clip = clips[clipIndexAt(clips, t)];
    if (!clip.zoom) clip.zoom = item;
  }

  // 画面全体にずっと出す物は、一番多く拾えた回の物を使う(取りこぼしの方が多いため)
  const most = <T>(get: (plan: RawAutoEditPlan) => T[] | null | undefined) =>
    plans.reduce((best, plan) => ((get(plan)?.length ?? 0) > (get(best)?.length ?? 0) ? plan : best), base);
  return {
    ...base,
    globalOverlays: most((plan) => plan.globalOverlays).globalOverlays,
    globalShapes: most((plan) => plan.globalShapes).globalShapes,
    clips,
  };
};
