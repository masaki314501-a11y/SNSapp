import { describe, expect, it } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import { estimateOverlayBox } from "@video/shared/textWrap";
import { faceOnScreen, fillMissingRankImages, finalizeAutoEditPlan, similarityToExamples, verifyComparisonMarks } from "./autoEditPlan";
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
    // 文字は1位の枠の中(上寄り)に入り、「1位」の文字とは重ならない
    const name = plan.globalOverlays.find((o) => o.text === "開咬")!;
    expect(name.yPercent).toBeGreaterThan(20);
    expect(name.yPercent).toBeLessThan(25);
    expect(Math.abs(name.xPercent - 24)).toBeLessThan(6);
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

describe("ずっと出る文字との重なり", () => {
  it("強調テキストがずっと出る文字に重なるなら、重ならない所へずらす", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan(
        [{ sourceStartSeconds: 0, sourceEndSeconds: 4, overlays: [{ text: "ここ重要", xPercent: 50, yPercent: 12, fontSizePx: 80 }] }],
        { globalOverlays: [{ text: "矯正した方がいい歯の症状", xPercent: 50, yPercent: 12, fontSizePx: 60 }] }
      ),
      input
    );
    const title = estimateOverlayBox(plan.globalOverlays[0]);
    const moved = estimateOverlayBox(plan.clips[0].overlays![0]);
    expect(moved.top >= title.bottom - 0.5 || moved.bottom <= title.top + 0.5).toBe(true);
  });

  it("ずっと出る文字どうしが重なるなら、後の方をずらし、先の方は動かさない", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan([{ sourceStartSeconds: 0, sourceEndSeconds: 4 }], {
        globalOverlays: [
          { text: "タイトル", xPercent: 50, yPercent: 10, fontSizePx: 60 },
          { text: "サブタイトル", xPercent: 50, yPercent: 11, fontSizePx: 60 },
        ],
      }),
      input
    );
    expect(plan.globalOverlays[0]).toMatchObject({ xPercent: 50, yPercent: 10 });
    const [a, b] = plan.globalOverlays.map((o) => estimateOverlayBox(o));
    expect(b.top >= a.bottom - 0.5 || b.bottom <= a.top + 0.5 || b.left >= a.right - 1 || b.right <= a.left + 1).toBe(true);
  });

  it("重なっていない文字は動かさない", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan([{ sourceStartSeconds: 0, sourceEndSeconds: 4, overlays: [{ text: "ここ重要", xPercent: 50, yPercent: 60 }] }], {
        globalOverlays: [{ text: "タイトル", xPercent: 50, yPercent: 10 }],
      }),
      input
    );
    expect(plan.clips[0].overlays![0]).toMatchObject({ xPercent: 50, yPercent: 60 });
  });
});

describe("比べる動画の〇印", () => {
  const fakeAi = (answer: unknown) =>
    ({ models: { generateContent: async () => ({ text: JSON.stringify(answer) }) } }) as unknown as GoogleGenAI;
  const plan = basePlan(
    [
      { sourceStartSeconds: 0, sourceEndSeconds: 2, speech: "保証は日本が安心", shapes: [{ kind: "circle", xPercent: 72, yPercent: 75, widthPercent: 30, borderColor: "#FF0000" }] },
      { sourceStartSeconds: 2, sourceEndSeconds: 4, speech: "技術はどうかな", shapes: [{ kind: "circle", xPercent: 28, yPercent: 75, widthPercent: 30, borderColor: "#FF0000" }] },
    ],
    {
      globalShapes: [28, 72].map((x) => ({ xPercent: x, yPercent: 75, widthPercent: 40, heightPercent: 22, fillColor: "#FFFFFF" })),
      globalOverlays: [
        { text: "日本", xPercent: 28, yPercent: 83 },
        { text: "韓国", xPercent: 72, yPercent: 83 },
      ],
    }
  );

  it("話し手が良いと言った側のカードへ〇を動かし、どちらとも言っていない〇は外す", async () => {
    const verified = await verifyComparisonMarks(
      fakeAi({ items: [{ mark: 0, side: "日本" }, { mark: 1, side: null }] }),
      plan
    );
    expect(verified.clips[0].shapes?.[0]).toMatchObject({ xPercent: 28, yPercent: 75 });
    expect(verified.clips[1].shapes).toEqual([]);
  });

  it("同じ側の〇が少しだけ消えてまた出る時は、1つにつなげる", async () => {
    const result = await finalizeAutoEditPlan(
      basePlan(
        [
          { sourceStartSeconds: 0, sourceEndSeconds: 2, shapes: [{ kind: "circle", xPercent: 72, yPercent: 75, borderColor: "#FF0000", durationInSeconds: 2 }] },
          { sourceStartSeconds: 2, sourceEndSeconds: 3 },
          { sourceStartSeconds: 3, sourceEndSeconds: 5, shapes: [{ kind: "circle", xPercent: 72, yPercent: 75, borderColor: "#FF0000", durationInSeconds: 2 }] },
        ]
      ),
      input
    );
    const circles = result.globalShapes.filter((shape) => shape.kind === "circle");
    expect(circles).toHaveLength(1);
    expect(circles[0]).toMatchObject({ startOffsetSeconds: 0, durationInSeconds: 5 });
  });
});

describe("ずっと出す画像と、ずっと出る文字", () => {
  it("枠に入れた画像が「1位」の文字に重なるなら、文字の無い側へ画像を切り詰める", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan(
        [
          {
            sourceStartSeconds: 0,
            sourceEndSeconds: 4,
            images: [{ imageNumber: 1, description: "1位", keepUntilEnd: true, xPercent: 24, yPercent: 25, widthPercent: 26, heightPercent: 10 }],
          },
        ],
        { globalOverlays: [{ text: "1位", xPercent: 17, yPercent: 28.5, fontSizePx: 46 }] }
      ),
      input
    );
    const image = plan.globalImages[0];
    const label = estimateOverlayBox(plan.globalOverlays.find((o) => o.text === "1位")!);
    const imageBottom = image.yPercent + image.heightPercent! / 2;
    const imageLeft = image.xPercent - image.widthPercent / 2;
    expect(imageBottom <= label.top || imageLeft >= label.right).toBe(true);
  });
});

describe("文字の空白", () => {
  it("日本語の間に入った空白は消す", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan([{ sourceStartSeconds: 0, sourceEndSeconds: 2, speech: "韓国の先生を全員 知っている", overlays: [{ text: "Top 3 の 理由" }] }]),
      input
    );
    expect(plan.clips[0].speechText).toBe("韓国の先生を全員知っている");
    expect(plan.clips[0].overlays?.[0].text).toBe("Top 3 の理由");
  });
});

describe("長い文の置き場所", () => {
  it("横に長すぎて空いている所に入らない文は、短く折り返し直して、左の枠に重ならない所へ置く", async () => {
    const boxes = [25, 37, 49, 60, 72, 83].map((y) => ({ xPercent: 24, yPercent: y, widthPercent: 26, heightPercent: 10, borderColor: "#000000" }));
    const plan = await finalizeAutoEditPlan(
      basePlan(
        [
          {
            sourceStartSeconds: 0,
            sourceEndSeconds: 3,
            overlays: [{ text: "歯に関して気になる方はプロフィールの予約リンクへ！", xPercent: 66, yPercent: 56, fontSizePx: 70 }],
          },
        ],
        { globalShapes: boxes }
      ),
      input
    );
    const placed = estimateOverlayBox(plan.clips[0].overlays![0]);
    expect(placed.left).toBeGreaterThan(37);
  });
});

describe("左上のタイトル", () => {
  it("本人が決めたタイトルを左上に最初から出し、AIが同じ文言で置いた上部の文字は外す", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan([{ sourceStartSeconds: 0, sourceEndSeconds: 2 }], {
        title: "AIのタイトル",
        globalOverlays: [
          { text: "矯正した方がいい", startOffsetSeconds: 0, xPercent: 50, yPercent: 10 },
          { text: "歯並びTOP5", startOffsetSeconds: 0, xPercent: 50, yPercent: 16 },
          { text: "1位", startOffsetSeconds: 0, xPercent: 15, yPercent: 40 },
        ],
      }),
      { ...input, title: "矯正した方がいい歯並びTOP5" }
    );
    const [title, ...rest] = plan.globalOverlays;
    expect(title.text.replace(/\n/g, "")).toBe("矯正した方がいい歯並びTOP5");
    expect(title.startOffsetSeconds).toBe(0);
    expect(title.durationInSeconds).toBeUndefined();
    const box = estimateOverlayBox(title);
    expect(box.left).toBeGreaterThanOrEqual(3);
    expect(box.left).toBeLessThan(6);
    expect(box.top).toBeLessThan(8);
    expect(rest.map((overlay) => overlay.text)).toEqual(["1位"]);
  });

  it("本人が決めていなければ、AIが決めた文言で置く", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan([{ sourceStartSeconds: 0, sourceEndSeconds: 2 }], { title: "AIのタイトル" }),
      input
    );
    expect(plan.globalOverlays[0].text).toBe("AIのタイトル");
  });
});

describe("顔を避ける", () => {
  const face = { xPercent: 50, yPercent: 40, widthPercent: 30, heightPercent: 16 };

  it("強調テキスト・画像を顔に重ならない所へ動かす", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan([
        {
          sourceStartSeconds: 0,
          sourceEndSeconds: 2,
          face,
          overlays: [{ text: "実は3倍!", xPercent: 50, yPercent: 40, fontSizePx: 90 }],
          images: [{ imageNumber: 1, description: "八重歯", xPercent: 50, yPercent: 42, widthPercent: 40 }],
        },
      ]),
      input
    );
    const faceBox = { left: 30.5, right: 69.5, top: 29.6, bottom: 50.4 };
    const overlay = estimateOverlayBox(plan.clips[0].overlays![0]);
    const intersects = (box: { left: number; right: number; top: number; bottom: number }) =>
      box.left < faceBox.right && faceBox.left < box.right && box.top < faceBox.bottom && faceBox.top < box.bottom;
    expect(intersects(overlay)).toBe(false);
    const image = plan.clips[0].images![0];
    const imageHeight = (image.widthPercent * 0.75 * 1080) / 1920;
    expect(
      intersects({
        left: image.xPercent - image.widthPercent / 2,
        right: image.xPercent + image.widthPercent / 2,
        top: image.yPercent - imageHeight / 2,
        bottom: image.yPercent + imageHeight / 2,
      })
    ).toBe(false);
    expect(plan.clips[0].faceBox).toEqual(face);
  });

  it("下のテロップが顔に重なるクリップだけ、テロップの位置を変える", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan(
        [
          { sourceStartSeconds: 0, sourceEndSeconds: 2, speech: "こんにちは", face: { xPercent: 50, yPercent: 85, widthPercent: 30, heightPercent: 16 } },
          { sourceStartSeconds: 2, sourceEndSeconds: 4, speech: "こんにちは", face },
        ],
        { theme: { captionPosition: "bottom" } }
      ),
      input
    );
    expect(plan.clips[0].clipCaptionPosition).toBe("top");
    expect(plan.clips[1].clipCaptionPosition).toBeUndefined();
  });

  it("字幕は、顔にもずっと出る文字にも重ならない位置にする", async () => {
    // 下の字幕の位置に、ずっと出る文字を置く。顔は真ん中なので、字幕は上へ行くはず
    const plan = await finalizeAutoEditPlan(
      basePlan(
        [{ sourceStartSeconds: 0, sourceEndSeconds: 2, speech: "こんにちは", face }],
        {
          theme: { captionPosition: "bottom" },
          globalOverlays: [{ text: "ずっと出る文字", xPercent: 50, yPercent: 88, fontSizePx: 90 }],
        }
      ),
      input
    );
    expect(plan.clips[0].clipCaptionPosition).toBe("top");
  });

  it("どこに置いても重なる文字は出さない(重なったまま残さない)", async () => {
    // 画面いっぱいの大きさの文字を、ほかの文字と同じ時間に出す
    const plan = await finalizeAutoEditPlan(
      basePlan([
        {
          sourceStartSeconds: 0,
          sourceEndSeconds: 2,
          face: { xPercent: 50, yPercent: 50, widthPercent: 90, heightPercent: 90 },
          overlays: [{ text: "とても長い強調の文字をたくさん", xPercent: 50, yPercent: 50, fontSizePx: 220 }],
        },
      ]),
      input
    );
    expect(plan.clips[0].overlays ?? []).toHaveLength(0);
  });

  it("字幕は、ずっと出す枠・カードにも重ならない位置にする", async () => {
    // 下にカード(図形)をずっと出す比較の動画。字幕は下(カードに重なる)から、顔にも重ならない位置へ動くはず
    const plan = await finalizeAutoEditPlan(
      basePlan(
        [{ sourceStartSeconds: 0, sourceEndSeconds: 2, speech: "価格は韓国の方が安い", face: { xPercent: 50, yPercent: 25, widthPercent: 30, heightPercent: 16 } }],
        {
          theme: { captionPosition: "bottom" },
          globalShapes: [
            { kind: "rect", xPercent: 27, yPercent: 85, widthPercent: 40, heightPercent: 18 },
            { kind: "rect", xPercent: 73, yPercent: 85, widthPercent: 40, heightPercent: 18 },
          ],
        }
      ),
      input
    );
    expect(["top", "middle"]).toContain(plan.clips[0].clipCaptionPosition);
  });

  it("枠の番号が「1」「2」だけでも、項目名は枠の中に入れ、顔を避けて枠の外へ押し出さない", async () => {
    const ys = [28, 43, 57, 70, 84];
    const plan = await finalizeAutoEditPlan(
      basePlan(
        [
          { sourceStartSeconds: 0, sourceEndSeconds: 2, speech: "危険な症状5選", face: { xPercent: 45, yPercent: 30, widthPercent: 40, heightPercent: 30 } },
          {
            sourceStartSeconds: 2,
            sourceEndSeconds: 5,
            speech: "高熱が続く",
            face: { xPercent: 45, yPercent: 30, widthPercent: 40, heightPercent: 30 },
            overlays: [{ text: "高熱", startOffsetSeconds: 0, slotRank: 1, keepUntilEnd: true }],
          },
        ],
        {
          globalShapes: ys.map((y) => ({ kind: "rect" as const, xPercent: 22, yPercent: y, widthPercent: 30, heightPercent: 11 })),
          globalOverlays: ys.map((y, i) => ({ text: String(i + 1), xPercent: 4, yPercent: y, fontSizePx: 50 })),
        }
      ),
      input
    );
    const label = plan.globalOverlays.find((overlay) => overlay.text === "高熱")!;
    expect(label).toBeDefined();
    // 枠の並びは字幕の帯を空けるため上へ詰まるので、詰めた後の1番の枠の中にあるかを見る
    const frame = plan.globalShapes.reduce((top, shape) => (shape.yPercent < top.yPercent ? shape : top));
    expect(label.xPercent).toBeGreaterThan(frame.xPercent - frame.widthPercent / 2);
    expect(label.xPercent).toBeLessThan(frame.xPercent + frame.widthPercent / 2);
    expect(label.yPercent).toBeGreaterThan(frame.yPercent - frame.heightPercent / 2);
    expect(label.yPercent).toBeLessThan(frame.yPercent + frame.heightPercent / 2);
  });

  it("枠が画面の下まで並んでいたら、枠の並びを上へ詰めて字幕の帯を空け、文字を全部出す", async () => {
    const ys = [28, 43, 57, 71, 85];
    const speech = "手足のしびれや吐き気などある場合は\nすぐに受診してください";
    const plan = await finalizeAutoEditPlan(
      basePlan(
        // 使う範囲(input)は9秒なので、項目は3つまで
        ys.slice(0, 3).map((_, i) => ({
          sourceStartSeconds: i * 3,
          sourceEndSeconds: i * 3 + 3,
          speech,
          face: { xPercent: 55, yPercent: 30, widthPercent: 30, heightPercent: 20 },
          overlays: [{ text: `症状${i + 1}`, startOffsetSeconds: 0, slotRank: i + 1, keepUntilEnd: true }],
        })),
        {
          theme: { captionPosition: "bottom" },
          globalOverlays: [
            { text: "病院に行くべき\n危険な症状5選", startOffsetSeconds: 0, xPercent: 30, yPercent: 8, fontSizePx: 60 },
            ...ys.map((y, i) => ({ text: String(i + 1), xPercent: 4, yPercent: y, fontSizePx: 50 })),
          ],
          globalShapes: ys.map((y) => ({ kind: "rect" as const, xPercent: 22, yPercent: y, widthPercent: 30, heightPercent: 12 })),
        }
      ),
      input
    );
    const lowestFrame = Math.max(...plan.globalShapes.map((shape) => shape.yPercent + shape.heightPercent / 2));
    // 元は91%まで並んでいた。字幕(下から約8%の余白+2行分)の上で止まる
    expect(lowestFrame).toBeLessThan(84);
    expect(plan.clips.every((clip) => (clip.clipCaptionPosition ?? plan.theme.captionPosition ?? "bottom") === "bottom")).toBe(true);
    // 項目名は3つとも出ている
    const names = [...plan.globalOverlays, ...plan.clips.flatMap((clip) => clip.overlays ?? [])]
      .map((overlay) => overlay.text)
      .filter((text) => text.startsWith("症状"));
    expect(names).toHaveLength(3);
  });

  it("顔が画面いっぱいでも、ずっと出すタイトルは消さない", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan(
        [{ sourceStartSeconds: 0, sourceEndSeconds: 4, speech: "看護師ならわかる言葉", face: { xPercent: 50, yPercent: 50, widthPercent: 100, heightPercent: 100 } }],
        { globalOverlays: [{ text: "看護師ならわかる\n医療用語5選", startOffsetSeconds: 0, xPercent: 50, yPercent: 12, fontSizePx: 80 }] }
      ),
      input
    );
    expect(plan.globalOverlays.map((overlay) => overlay.text.replace(/\n/g, ""))).toContain("看護師ならわかる医療用語5選");
  });

  it("寄ったクリップでは、寄った後の顔の位置で確かめる", () => {
    const box = faceOnScreen(face, null, { scale: 1.3, style: "punch", focusXPercent: 50, focusYPercent: 20 });
    // 中心(縦20%)から離れる方向へ1.3倍に広がる
    expect(box.top).toBeCloseTo(20 + (40 - 8 * 1.3 - 20) * 1.3, 5);
  });
});

describe("新しく作る画像の上限", () => {
  it("作れなかった枠の画像は、項目名の文字で枠を埋める", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan(
        [
          {
            sourceStartSeconds: 0,
            sourceEndSeconds: 2,
            images: [{ imageNumber: null, name: "八重歯", description: "八重歯のイラスト", durationInSeconds: 2 }],
          },
          {
            sourceStartSeconds: 2,
            sourceEndSeconds: 4,
            images: [{ imageNumber: null, name: "八重歯", description: "八重歯のイラスト", keepUntilEnd: true, slotRank: 1 }],
          },
        ],
        {
          globalShapes: [{ xPercent: 25, yPercent: 40, widthPercent: 40, heightPercent: 10, borderColor: "#000000" }],
          globalOverlays: [{ text: "1位", xPercent: 10, yPercent: 40 }],
        }
      ),
      input
    );
    expect(plan.globalImages).toEqual([]);
    const name = plan.globalOverlays.find((overlay) => overlay.text === "八重歯");
    expect(name).toMatchObject({ startOffsetSeconds: 2, xPercent: 25 });
    expect(plan.imageSources).toEqual({ material: 0, library: 0, generated: 0 });
  });
});

describe("カメラワークのルール", () => {
  it("ランキングでは、順位を発表したクリップだけ顔を中心に寄る(AIが寄せた所は山場の印にする)", async () => {
    const face = { xPercent: 40, yPercent: 30, widthPercent: 30, heightPercent: 16 };
    const plan = await finalizeAutoEditPlan(
      basePlan([
        { sourceStartSeconds: 0, sourceEndSeconds: 2, face, zoom: { scale: 1.3, style: "slow" } },
        { sourceStartSeconds: 2, sourceEndSeconds: 4, face },
        { sourceStartSeconds: 4, sourceEndSeconds: 6, face, overlays: [{ text: "第3位" }] },
      ]),
      { ...input, template: { id: "ranking", label: "ランキング", description: "", instructions: "" } }
    );
    expect(plan.clips.map((clip) => clip.cameraHighlight)).toEqual([true, undefined, true]);
    expect(plan.clips[0].zoom).toEqual({ scale: 1.15, style: "punch", focusXPercent: 40, focusYPercent: 30 });
    expect(plan.clips[1].zoom).toBeUndefined();
    expect(plan.clips[2].zoom?.scale).toBe(1.15);
  });
});

describe("冒頭の見出しの候補", () => {
  it("おすすめを先頭に、別の案を並べ、タイトルと同じ案・同じ案は外して最大3つにする", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan([{ sourceStartSeconds: 0, sourceEndSeconds: 2 }], {
        title: "矯正した方がいい歯並び",
        hook: { headline: "9割が知らない歯並びの話" },
        hookAlternatives: ["矯正した方がいい歯並び", "あなたの歯は大丈夫?", "9割が知らない 歯並びの話", "結論:受け口は早めに"],
      }),
      input
    );
    expect(plan.hookCandidates).toEqual(["9割が知らない歯並びの話", "あなたの歯は大丈夫?", "結論:受け口は早めに"]);
  });

  it("おすすめが無い(hookがnull)時も、別の案は候補に出す", async () => {
    const plan = await finalizeAutoEditPlan(
      basePlan([{ sourceStartSeconds: 0, sourceEndSeconds: 2 }], { hook: null, hookAlternatives: ["あなたの歯は大丈夫?"] }),
      input
    );
    expect(plan.hook).toBeNull();
    expect(plan.hookCandidates).toEqual(["あなたの歯は大丈夫?"]);
  });
});
