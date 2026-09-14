import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAPTION_FONT_FAMILY,
  DEFAULT_CAPTION_POSITION,
  DEFAULT_CAPTION_STYLE,
  DEFAULT_CLIP_VOLUME,
  DEFAULT_FADE_IN_OUT,
  DEFAULT_PRIMARY_COLOR,
  buildStandardVideoProps,
  parseProjectJson,
} from "./videoProject";

describe("parseProjectJson", () => {
  it("不正なJSONはnullを返す", () => {
    expect(parseProjectJson("{not json")).toBeNull();
  });

  it("必須フィールド(videoPath等)が欠けたデータはnullを返す", () => {
    expect(parseProjectJson(JSON.stringify({ segments: [] }))).toBeNull();
  });

  it("後から追加されたフィールドが無い古い保存データをデフォルト値で補完する", () => {
    const legacy = {
      videoPath: "videos/abc.mp4",
      videoDurationInSeconds: 10,
      segments: [
        {
          key: "1",
          caption: "hi",
          startFromSeconds: 0,
          durationInSeconds: 2,
          captionAnimation: "slide-up",
          // volume フィールドが無い(後から追加されたフィールド)
        },
      ],
      // videoFileName / primaryColor / captionStyle / fontFamily / captionPosition /
      // fontSize / fadeInOut / sfx / bgm もすべて無い
    };

    const project = parseProjectJson(JSON.stringify(legacy));
    expect(project).not.toBeNull();
    expect(project?.videoFileName).toBeNull();
    expect(project?.primaryColor).toBe(DEFAULT_PRIMARY_COLOR);
    expect(project?.captionStyle).toBe(DEFAULT_CAPTION_STYLE);
    expect(project?.fontFamily).toBe(DEFAULT_CAPTION_FONT_FAMILY);
    expect(project?.captionPosition).toBe(DEFAULT_CAPTION_POSITION);
    expect(project?.fontSize).toBe("medium");
    expect(project?.fadeInOut).toBe(DEFAULT_FADE_IN_OUT);
    expect(project?.segments[0].volume).toBe(DEFAULT_CLIP_VOLUME);
    expect(project?.sfx).toEqual([]);
    expect(project?.bgm).toBeNull();
  });

  it("bgmのfadeIn/fadeOutが無い古い保存データは0で補完する", () => {
    const legacy = {
      videoPath: "videos/abc.mp4",
      videoDurationInSeconds: 10,
      segments: [],
      bgm: { src: "audio/bgm.mp3", label: "BGM", volume: 0.4 },
    };
    const project = parseProjectJson(JSON.stringify(legacy));
    expect(project?.bgm).toEqual({
      src: "audio/bgm.mp3",
      label: "BGM",
      volume: 0.4,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
    });
  });
});

describe("buildStandardVideoProps", () => {
  const baseParams = {
    videoPath: "videos/a.mp4",
    primaryColor: "#000000",
    captionStyle: DEFAULT_CAPTION_STYLE,
    fontFamily: DEFAULT_CAPTION_FONT_FAMILY,
    captionPosition: DEFAULT_CAPTION_POSITION,
    fontSize: "medium" as const,
    fadeInOut: false,
    sfxClips: [],
    bgm: null,
  };

  it("スキーマ下限(0.3秒)を下回るクリップ尺は底上げする", () => {
    const props = buildStandardVideoProps({
      ...baseParams,
      segments: [
        {
          key: "1",
          caption: "c",
          startFromSeconds: 0,
          durationInSeconds: 0.1,
          captionAnimation: "slide-up",
          volume: 1,
        },
      ],
    });
    expect(props.clips[0].durationInSeconds).toBe(0.3);
  });

  it("segmentsの配列順をそのまま再生順として維持する(並べ替え結果を尊重)", () => {
    const props = buildStandardVideoProps({
      ...baseParams,
      segments: [
        {
          key: "2",
          caption: "second",
          startFromSeconds: 5,
          durationInSeconds: 1,
          captionAnimation: "fade",
          volume: 1,
        },
        {
          key: "1",
          caption: "first",
          startFromSeconds: 0,
          durationInSeconds: 1,
          captionAnimation: "fade",
          volume: 1,
        },
      ],
    });
    expect(props.clips.map((c) => c.caption)).toEqual(["second", "first"]);
  });

  it("bgmがnullならStandardVideoProps側もundefinedになる", () => {
    const props = buildStandardVideoProps({ ...baseParams, segments: [] });
    expect(props.bgm).toBeUndefined();
  });

  it("bgmが指定されていればそのままマッピングする", () => {
    const props = buildStandardVideoProps({
      ...baseParams,
      segments: [],
      bgm: {
        src: "audio/bgm.mp3",
        label: "BGM",
        volume: 0.4,
        fadeInSeconds: 1,
        fadeOutSeconds: 2,
      },
    });
    expect(props.bgm).toEqual({
      src: "audio/bgm.mp3",
      volume: 0.4,
      fadeInSeconds: 1,
      fadeOutSeconds: 2,
    });
  });
});
