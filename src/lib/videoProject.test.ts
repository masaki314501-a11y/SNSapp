import { describe, expect, it } from "vitest";
import { parseProjectJson } from "./videoProject";

describe("parseProjectJson", () => {
  it("後から足した項目(タイトル・重大ワード・話している区間など)を、読み込んでも消さない", () => {
    const project = parseProjectJson(
      JSON.stringify({
        videoPath: "videos/x.mp4",
        videoDurationInSeconds: 10,
        segments: [],
        autoEditTitle: "矯正した方がいい歯並びTOP5",
        keywordHighlights: [{ word: "抜歯", color: "#FF2D2D" }],
        speechSpans: [[0.5, 2]],
        captionTextStyleId: "creative-078",
        cameraRuleId: "ranking",
      })
    );
    expect(project).toMatchObject({
      autoEditTitle: "矯正した方がいい歯並びTOP5",
      keywordHighlights: [{ word: "抜歯", color: "#FF2D2D" }],
      speechSpans: [[0.5, 2]],
      captionTextStyleId: "creative-078",
      cameraRuleId: "ranking",
      // 既定値のある項目は、無ければ補う
      fadeInOut: false,
      sfx: [],
    });
  });
});
