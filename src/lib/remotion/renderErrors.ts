/**
 * @remotion/renderer は、動画/音声素材のダウンロードに失敗すると「Error while
 * downloading <url>: Error: Received a status code of 404 ...」のような、英語の
 * URLやスタックトレースを含む生のエラーをそのまま投げる。書き出し画面はこれを
 * そのまま表示してしまうため、非エンジニアの利用者にも状況と次にすることが
 * 分かる日本語メッセージに変換する。
 */
const DOWNLOAD_ERROR_PATTERN = /while downloading file/i;
const STATUS_CODE_PATTERN = /status code of (\d+)/;

/**
 * 素材ダウンロード失敗(ファイル欠落・不正パス等)は、同じプロジェクトのまま即座に
 * 再試行しても同じ理由で必ず失敗する(決定的)ため、ブラウザ起動失敗などの一過性
 * 不具合向けの自動リトライの対象からは外す(90秒近いタイムアウトを2回待たせない)。
 */
export const isRenderMediaDownloadError = (error: unknown): boolean =>
  DOWNLOAD_ERROR_PATTERN.test(error instanceof Error ? error.message : String(error));

export const toFriendlyRenderError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);

  if (DOWNLOAD_ERROR_PATTERN.test(message)) {
    const statusCode = STATUS_CODE_PATTERN.exec(message)?.[1];
    if (statusCode === "404") {
      return "書き出しに必要な動画・効果音・AIナレーションのファイルが見つかりませんでした。該当のクリップ・効果音・ナレーションを編集画面で作り直してから、もう一度お試しください";
    }
    return "書き出しに必要な動画・音声ファイルの読み込みに失敗しました。編集画面を確認し、もう一度お試しください";
  }

  return error instanceof Error ? error.message : "レンダーに失敗しました";
};
