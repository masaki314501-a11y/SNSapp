import { describe, expect, it } from "vitest";
import { isRenderMediaDownloadError, toFriendlyRenderError } from "./renderErrors";

const notFoundError = new Error(
  'Error while downloading http://127.0.0.1:3000/api/media/audio/generated/abc.wav: Error: Received a status code of 404 while downloading file http://127.0.0.1:3000/api/media/audio/generated/abc.wav. The response body was: --- {"error":"ファイルが見つかりません"} ---'
);

const badPathError = new Error(
  'Error while downloading http://127.0.0.1:3000/api/media/audio/presets/sfx/pop.mp3: Error: Received a status code of 400 while downloading file http://127.0.0.1:3000/api/media/audio/presets/sfx/pop.mp3. The response body was: --- {"error":"不正なパスです"} ---'
);

describe("isRenderMediaDownloadError", () => {
  it("素材ダウンロード失敗のエラーを判定する", () => {
    expect(isRenderMediaDownloadError(notFoundError)).toBe(true);
  });

  it("無関係なエラーはfalseを返す", () => {
    expect(isRenderMediaDownloadError(new Error("ブラウザの起動に失敗しました"))).toBe(false);
  });
});

describe("toFriendlyRenderError", () => {
  it("404には作り直しを促す日本語メッセージを返す", () => {
    const message = toFriendlyRenderError(notFoundError);
    expect(message).toContain("作り直して");
    expect(message).not.toContain("404");
    expect(message).not.toContain("http://");
  });

  it("404以外のダウンロード失敗にも日本語メッセージを返す", () => {
    const message = toFriendlyRenderError(badPathError);
    expect(message).not.toContain("http://");
    expect(message).not.toContain("不正なパスです");
  });

  it("無関係なエラーはそのままのメッセージを返す", () => {
    const error = new Error("ブラウザの起動に失敗しました");
    expect(toFriendlyRenderError(error)).toBe("ブラウザの起動に失敗しました");
  });
});
