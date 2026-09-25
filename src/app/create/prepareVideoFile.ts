/**
 * アップロード前に、動画を「どのブラウザでも読める形式(H.264のMP4)」にそろえる。
 *
 * 書き出しは利用者のブラウザ内で行うため(useWebRender.ts)、元動画をそのブラウザが読めないと
 * 「The video could not be decoded by the browser」で書き出しが止まる。iPhoneで撮ったHEVC(特にHDR)の
 * .movは、撮ったiPhoneのSafariでは読めても、Windows版ChromeやAndroidでは読めないことがある。
 * サーバーで変換するのはメモリ512MB・非力なCPUの本番では現実的でないため、アップロードする人の
 * ブラウザ(=たいてい撮影した端末なので元動画を読める)で一度だけ変換しておき、以降の編集・書き出しは
 * どの端末からでも読めるようにする。
 *
 * mediabunnyは重いので、動画を選んだときにだけ読み込む。
 */

/** 変換後の短辺の上限。完成動画は1080x1920なので、それ以上の解像度(4K等)は持っていても使われない。 */
const MAX_SHORT_SIDE = 1080;

export class VideoNotReadableError extends Error {}

/**
 * 変換が要らない動画はそのまま返す。変換が必要なら onProgress に0〜100を渡しながら変換し、MP4のFileを返す。
 * このブラウザでは読めない動画だった場合は VideoNotReadableError を投げる。
 */
export const prepareVideoFile = async (
  file: File,
  onProgress?: (percent: number) => void
): Promise<File> => {
  const mb = await import("mediabunny");

  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  let videoTrack: Awaited<ReturnType<typeof input.getPrimaryVideoTrack>>;
  try {
    videoTrack = await input.getPrimaryVideoTrack();
  } catch {
    // mediabunnyが中身を解析できない形式。変換はできないが、アップロード自体は今まで通り通す
    // (解析できない=読めない、とは限らないため。ここで止めると以前より悪くなる)。
    return file;
  }
  if (!videoTrack) return file;

  const canDecode = await videoTrack.canDecode();

  // H.264ならほぼ全ブラウザで読めるので、時間をかけて変換しない(iPhoneの「互換性優先」設定の動画など)。
  // HDRかどうかは見ない: H.264のHDRは普通に読め、変換しても色情報がそのまま引き継がれて意味がなかったため。
  if (videoTrack.codec === "avc" && canDecode) return file;

  if (!canDecode) {
    throw new VideoNotReadableError(
      "この動画はこのブラウザでは読み込めない形式です。撮影したスマホから(iPhoneならSafariで)アップロードし直してください。"
    );
  }

  // Firefox等はブラウザ自体にAACの書き出し機能がないため、同梱のエンコーダーで補う
  // (元の音声がAACならそのままコピーされるので、ここを使うのは音声の形式が違うときだけ)。
  if (!(await mb.canEncodeAudio("aac"))) {
    const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
    registerAacEncoder();
  }

  const [width, height] = await Promise.all([videoTrack.getDisplayWidth(), videoTrack.getDisplayHeight()]);
  const scale = Math.min(1, MAX_SHORT_SIDE / Math.min(width, height));
  // H.264は幅・高さが偶数である必要がある
  const toEven = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);

  const output = new mb.Output({
    format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new mb.BufferTarget(),
  });
  const conversion = await mb.Conversion.init({
    input,
    output,
    video: {
      codec: "avc",
      bitrate: mb.QUALITY_HIGH,
      forceTranscode: true,
      // 既定の5秒間隔だと、クリップの途中から再生するたびに最大5秒分を読み直すことになり、
      // 細かく切った動画のプレビューが重くなる。1秒ごとにして頭出しを軽くする(ファイルは少し大きくなる)。
      keyFrameInterval: 1,
      ...(scale < 1 ? { width: toEven(width), height: toEven(height), fit: "fill" as const } : {}),
    },
    audio: { codec: "aac" },
  });
  if (!conversion.isValid) {
    throw new VideoNotReadableError(
      "この動画をこのブラウザで変換できませんでした。撮影したスマホから(iPhoneならSafariで)アップロードし直してください。"
    );
  }
  conversion.onProgress = (progress) => onProgress?.(Math.round(progress * 100));
  await conversion.execute();

  const buffer = output.target.buffer;
  if (!buffer) throw new Error("動画の変換に失敗しました");
  const baseName = file.name.replace(/\.[^.]+$/, "");
  return new File([buffer], `${baseName}.mp4`, { type: "video/mp4" });
};
