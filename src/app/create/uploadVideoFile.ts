/**
 * fetch()はアップロード進捗を取得できないため、大きい動画ファイルでも
 * 進捗率をUIに表示できるようXMLHttpRequestを使う。
 */
export const uploadVideoFile = (
  file: File,
  onProgress?: (percent: number) => void
): Promise<string> =>
  new Promise((resolve, reject) => {
    const body = new FormData();
    body.set("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.responseType = "json";

    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      const data = xhr.response as { path?: string; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && data?.path) {
        resolve(data.path);
      } else {
        reject(new Error(data?.error ?? "アップロードに失敗しました"));
      }
    };

    xhr.onerror = () => reject(new Error("通信エラーによりアップロードに失敗しました"));

    xhr.send(body);
  });
