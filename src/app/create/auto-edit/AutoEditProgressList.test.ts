import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AutoEditProgressList } from "./AutoEditProgressList";

describe("AutoEditProgressList", () => {
  it("済んだ段階に✓、今の段階に●を付け、画像を作っている間は何枚目かを出す", () => {
    const html = renderToStaticMarkup(
      createElement(AutoEditProgressList, { progress: { stage: "images", done: 2, total: 5 }, isRevision: false })
    );
    expect(html.match(/✓/g)).toHaveLength(3);
    expect(html).toContain("●");
    expect(html).toContain("画像を用意しています(2/5枚)");
  });

  it("手直しでは、お手本を選ぶ段階を出さない", () => {
    const html = renderToStaticMarkup(createElement(AutoEditProgressList, { progress: { stage: "planning" }, isRevision: true }));
    expect(html).not.toContain("お手本");
    expect(html.match(/✓/g)).toHaveLength(1);
  });
});
