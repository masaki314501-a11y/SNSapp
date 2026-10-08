import { describe, expect, it } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import { fillMissingRankImages, finalizeAutoEditPlan, similarityToExamples } from "./autoEditPlan";
import type { RawAutoEditPlan } from "./autoEditTypes";
import type { ResolvedMaterialImage } from "@/lib/materialImage";

const material: ResolvedMaterialImage = {
  path: "images/00000000-0000-0000-0000-000000000001.jpg",
  name: "八重歯",
  absolutePath: "/dev/null",
  mimeType: "image/jpeg",
};

const input = {
  keepRanges: [{ startFromSeconds: 0, durationInSeconds: 10 }],
  materialImages: [material],
  generateMissingImages: false,
};

const basePlan = (clips: RawAutoEditPlan["clips"], extra: Partial<RawAutoEditPlan> = {}): RawAutoEditPlan => ({
  summary: "テスト",
  clips,
  ...extra,
});

describe("finalizeAutoEditPlan", () => {
  it("クリップより長く出す画像と最後まで残す画像を、完成動画の先頭からの秒数で全体の画像へ移す", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan([
        {
          sourceStartSeconds: 0,
          sourceEndSeconds: 2,
          images: [{ imageNumber: 1, description: "大きく出す", durationInSeconds: 3, xPercent: 66, yPercent: 72, widthPercent: 49 }],
        },
        {
          sourceStartSeconds: 2,
          sourceEndSeconds: 4,
          images: [
            {
              imageNumber: 1,
              description: "枠に入れる",
              startOffsetSeconds: 1,
              keepUntilEnd: true,
              xPercent: 24,
              yPercent: 37,
              widthPercent: 26,
              heightPercent: 10,
            },
          ],
        },
      ]),
      input
    );

    expect(plan.clips.every((clip) => clip.images === undefined)).toBe(true);
    expect(plan.globalImages).toHaveLength(2);
    const [big, slot] = plan.globalImages;
    expect(big).toMatchObject({ src: material.path, startOffsetSeconds: 0, durationInSeconds: 3 });
    expect(slot).toMatchObject({ src: material.path, startOffsetSeconds: 3, durationInSeconds: undefined });
  });

  it("大きく出していた写真が消えると同時に同じ写真が枠に出たら、前の位置から動いてくるようにする", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan([
        {
          sourceStartSeconds: 0,
          sourceEndSeconds: 2,
          images: [{ imageNumber: 1, description: "大きく出す", durationInSeconds: 3, xPercent: 66, yPercent: 72, widthPercent: 49 }],
        },
        {
          sourceStartSeconds: 2,
          sourceEndSeconds: 4,
          images: [{ imageNumber: 1, description: "枠", startOffsetSeconds: 1, keepUntilEnd: true, xPercent: 24, yPercent: 37, widthPercent: 26 }],
        },
      ]),
      input
    );

    expect(plan.globalImages[1].moveFrom).toEqual({ xPercent: 66, yPercent: 72, widthPercent: 49, heightPercent: undefined });
    expect(plan.globalImages[0].moveFrom).toBeUndefined();
  });

  it("番号が無い・範囲外の画像は、画像を作らない設定なら置かない", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan([
        {
          sourceStartSeconds: 0,
          sourceEndSeconds: 2,
          images: [
            { imageNumber: null, description: "作ってほしい画像" },
            { imageNumber: 5, description: "無い番号" },
          ],
        },
      ]),
      input
    );

    expect(plan.clips[0].images).toBeUndefined();
    expect(plan.globalImages).toEqual([]);
    expect(plan.generatedImageCount).toBe(0);
  });

  it("締めの一言が最後のクリップの文字と同じ内容なら出さず、違う内容なら出す", async () => {
    const clips: RawAutoEditPlan["clips"] = [
      { sourceStartSeconds: 0, sourceEndSeconds: 2, overlays: [{ text: "プロフィールの\n予約リンクへ!" }] },
    ];
    const repeated = await finalizeAutoEditPlan(basePlan(clips, { cta: { text: "プロフィールの予約リンクへ！" } }), input);
    expect(repeated.cta).toBeNull();

    const different = await finalizeAutoEditPlan(basePlan(clips, { cta: { text: "保存して見返してね" } }), input);
    expect(different.cta).toEqual({ text: "保存して見返してね" });
  });

  it("冒頭の見出しが、最初から出しているタイトルと同じなら出さない", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan([{ sourceStartSeconds: 0, sourceEndSeconds: 2 }], {
        hook: { headline: "矯正した方がいい歯の症状" },
        globalOverlays: [{ text: "矯正した方がいい\n歯の症状", startOffsetSeconds: 0 }],
      }),
      input
    );
    expect(plan.hook).toBeNull();
  });

  it("寄せない画角(1倍)はnullにし、寄せすぎは上限に抑える", async () => {
    const none = await finalizeAutoEditPlan(
      basePlan([{ sourceStartSeconds: 0, sourceEndSeconds: 2 }], { framing: { scale: 1 } }),
      input
    );
    expect(none.framing).toBeNull();

    const tooMuch = await finalizeAutoEditPlan(
      basePlan([{ sourceStartSeconds: 0, sourceEndSeconds: 2 }], { framing: { scale: 3, focusXPercent: 7.5, focusYPercent: 21.6 } }),
      input
    );
    expect(tooMuch.framing).toEqual({ scale: 1.5, focusXPercent: 7.5, focusYPercent: 21.6 });
  });
});

describe("similarityToExamples", () => {
  const example = basePlan(
    [
      { sourceStartSeconds: 0, sourceEndSeconds: 2, overlays: [{ text: "a" }, { text: "b" }], images: [{ description: "x", keepUntilEnd: true }] },
    ],
    { globalShapes: [{}, {}], framing: { scale: 1.3 } }
  );

  it("手本にある要素(枠の図形など)を丸ごと出していない案は、そろっている案より低くなる", () => {
    const complete = basePlan(
      [{ sourceStartSeconds: 0, sourceEndSeconds: 2, overlays: [{ text: "c" }, { text: "d" }], images: [{ description: "y", keepUntilEnd: true }] }],
      { globalShapes: [{}, {}], framing: { scale: 1.3 } }
    );
    const missingShapes = basePlan(
      [{ sourceStartSeconds: 0, sourceEndSeconds: 2, overlays: [{ text: "c" }, { text: "d" }], images: [{ description: "y", keepUntilEnd: true }] }],
      { framing: { scale: 1.3 } }
    );
    expect(similarityToExamples(complete, [example])).toBeCloseTo(1);
    expect(similarityToExamples(missingShapes, [example])).toBeLessThan(similarityToExamples(complete, [example]));
  });

  it("手本が無ければ0(どの案も同点)", () => {
    expect(similarityToExamples(example, [])).toBe(0);
  });
});

describe("色の読み取り", () => {
  it("#RGB・透明度付き・色の名前で書かれた枠線の色も読み取って、枠を消さない", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan([{ sourceStartSeconds: 0, sourceEndSeconds: 2 }], {
        globalShapes: [{ borderColor: "#000" }, { borderColor: "#000000FF" }, { borderColor: "black" }, { borderColor: "くろ" }],
      }),
      input
    );
    expect(plan.globalShapes.map((shape) => shape.borderColor)).toEqual(["#000000", "#000000", "#000000"]);
  });
});

describe("図形の省略", () => {
  it("位置だけ書かれた枠は、色まで書いてある枠の見た目を引き継ぎ、それも無ければ黒い線の枠にする", async () => {
    const inherited = await finalizeAutoEditPlan(
      basePlan([{ sourceStartSeconds: 0, sourceEndSeconds: 2 }], {
        globalShapes: [
          { xPercent: 24, yPercent: 25, widthPercent: 26.4, heightPercent: 10, borderColor: "#111111", borderWidthPx: 10 },
          { xPercent: 24, yPercent: 37 },
        ],
      }),
      input
    );
    expect(inherited.globalShapes[1]).toMatchObject({ yPercent: 37, widthPercent: 26.4, heightPercent: 10, borderColor: "#111111", borderWidthPx: 10 });

    const bare = await finalizeAutoEditPlan(
      basePlan([{ sourceStartSeconds: 0, sourceEndSeconds: 2 }], { globalShapes: [{ xPercent: 24, yPercent: 25 }] }),
      input
    );
    expect(bare.globalShapes[0]).toMatchObject({ yPercent: 25, borderColor: "#000000" });
  });
});

describe("改行", () => {
  it("「\\n」の2文字で書かれた改行も改行にし、字幕は2行までにする", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan([
        { sourceStartSeconds: 0, sourceEndSeconds: 2, speech: "日本の方が\\n通いやすい", overlays: [{ text: "知らないと\\n損する話" }] },
        { sourceStartSeconds: 2, sourceEndSeconds: 4, speech: "一行目です\n二行目です\n三行目です" },
      ]),
      input
    );
    expect(plan.clips[0].speechText).toBe("日本の方が\n通いやすい");
    expect(plan.clips[0].overlays?.[0].text).toBe("知らないと\n損する話");
    expect(plan.clips[1].speechText).toBe("一行目です\n二行目です三行目です");
  });
});

describe("ランキングの枠への配置", () => {
  const slots = {
    globalShapes: [25, 37, 49].map((y) => ({ xPercent: 24, yPercent: y, widthPercent: 26, heightPercent: 10, borderColor: "#000000" })),
    globalOverlays: [1, 2, 3].map((rank, i) => ({ text: `${rank}位`, xPercent: 17, yPercent: [25, 37, 49][i] + 3 })),
  };

  it("座標を書き間違えても、slotRankの順位の枠の位置・大きさに入る", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan(
        [
          {
            sourceStartSeconds: 0,
            sourceEndSeconds: 2,
            images: [{ imageNumber: 1, description: "2位の写真", keepUntilEnd: true, slotRank: 2, xPercent: 24, yPercent: 25, widthPercent: 40 }],
          },
          {
            sourceStartSeconds: 2,
            sourceEndSeconds: 4,
            overlays: [{ text: "開咬", keepUntilEnd: true, slotRank: 1, xPercent: 24, yPercent: 49 }],
          },
        ],
        slots
      ),
      input
    );
    expect(plan.globalImages[0]).toMatchObject({ xPercent: 24, yPercent: 37, widthPercent: 26, heightPercent: 10 });
    expect(plan.globalOverlays.find((o) => o.text === "開咬")).toMatchObject({ xPercent: 24, yPercent: 25 });
  });

  it("「第3位」「３位」のような書き方の順位の文字も枠として扱う", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan(
        [
          {
            sourceStartSeconds: 0,
            sourceEndSeconds: 2,
            images: [{ imageNumber: 1, description: "3位", keepUntilEnd: true, slotRank: 3, xPercent: 80, yPercent: 80 }],
          },
        ],
        { globalOverlays: [{ text: "第３位", xPercent: 20, yPercent: 60 }] }
      ),
      input
    );
    expect(plan.globalImages[0]).toMatchObject({ xPercent: 20, yPercent: 60 });
  });
});

describe("枠に入れる画像の使い回し", () => {
  it("枠用の画像が大きく出した画像と違う説明で書かれていても、直前に大きく出した画像を枠に入れる", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan([
        { sourceStartSeconds: 0, sourceEndSeconds: 2, images: [{ imageNumber: 1, description: "八重歯の写真", durationInSeconds: 2 }] },
        {
          sourceStartSeconds: 2,
          sourceEndSeconds: 4,
          images: [{ imageNumber: null, description: "八重歯の写真(順位の枠に入れたもの)", keepUntilEnd: true, slotRank: 2 }],
        },
      ]),
      input
    );
    const slotImage = plan.globalImages.find((image) => image.durationInSeconds === undefined);
    expect(slotImage?.src).toBe(material.path);
  });
});

describe("fillMissingRankImages", () => {
  const fakeAi = (answer: unknown) =>
    ({ models: { generateContent: async () => ({ text: JSON.stringify(answer) }) } }) as unknown as GoogleGenAI;
  const plan = basePlan(
    [
      { sourceStartSeconds: 0, sourceEndSeconds: 2, speech: "八重歯は", images: [{ imageNumber: 1, description: "八重歯", durationInSeconds: 3 }] },
      { sourceStartSeconds: 2, sourceEndSeconds: 4, speech: "2位です" },
    ],
    { globalOverlays: [{ text: "1位" }, { text: "2位" }] }
  );

  it("枠に入れる画像が無い答えは、聞き直した順位とクリップで枠に入れる", async () => {
    const filled = await fillMissingRankImages(fakeAi({ items: [{ topic: 0, rank: 2, clip: 1 }] }), plan);
    expect(filled.clips[1].images).toEqual([
      expect.objectContaining({ imageNumber: 1, keepUntilEnd: true, slotRank: 2, startOffsetSeconds: 0, durationInSeconds: null }),
    ]);
  });

  it("順位の文字が無い動画(ランキングでない)では聞き直さない", async () => {
    const notRanking = { ...plan, globalOverlays: [] };
    const filled = await fillMissingRankImages(fakeAi({ items: [{ topic: 0, rank: 2, clip: 1 }] }), notRanking);
    expect(filled).toBe(notRanking);
  });
});
