import { describe, expect, it } from "vitest";
import { parseYouTubeVideoId, videoIdOfYouTubeReference, youtubeReferencePath } from "./youtubeReference";

describe("parseYouTubeVideoId", () => {
  it.each([
    ["https://www.youtube.com/shorts/jNQXAC9IVRw", "jNQXAC9IVRw"],
    ["https://youtube.com/shorts/jNQXAC9IVRw?si=abc", "jNQXAC9IVRw"],
    ["https://m.youtube.com/watch?v=jNQXAC9IVRw&t=3", "jNQXAC9IVRw"],
    ["https://youtu.be/jNQXAC9IVRw?si=abc", "jNQXAC9IVRw"],
    ["https://www.youtube.com/embed/jNQXAC9IVRw", "jNQXAC9IVRw"],
    ["youtube.com/shorts/jNQXAC9IVRw", "jNQXAC9IVRw"],
    ["  https://www.youtube.com/shorts/jNQXAC9IVRw  ", "jNQXAC9IVRw"],
  ])("%s から動画IDを取り出す", (url, id) => {
    expect(parseYouTubeVideoId(url)).toBe(id);
  });

  it.each([
    "https://www.tiktok.com/@someone/video/7300000000000000000",
    "https://www.youtube.com/@jawed",
    "https://www.youtube.com/watch?v=short",
    "https://evil.example.com/shorts/jNQXAC9IVRw",
    "https://www.youtube.com.evil.example/shorts/jNQXAC9IVRw",
    "動画のURL",
  ])("YouTubeの動画でない %s はnull", (url) => {
    expect(parseYouTubeVideoId(url)).toBeNull();
  });
});

describe("youtubeReferencePath", () => {
  it("一覧に残す形と動画IDを行き来できる", () => {
    expect(videoIdOfYouTubeReference(youtubeReferencePath("jNQXAC9IVRw"))).toBe("jNQXAC9IVRw");
    expect(videoIdOfYouTubeReference("youtube/../../etc/passwd")).toBeNull();
  });
});
