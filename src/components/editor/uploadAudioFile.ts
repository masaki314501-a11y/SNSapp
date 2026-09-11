/**
 * SE/BGM用の音声ファイルをサーバーにアップロードする(uploadVideoFile.tsと同じXHRパターン)。
 */
export const uploadAudioFile = (file: File): Promise<{ path: string; fileName: string }> =>
  new Promise((resolve, reject) => {
    const body = new FormData();
    body.set("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload-audio");
    xhr.responseType = "json";

    xhr.onload = () => {
      const data = xhr.response as { path?: string; fileName?: string; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && data?.path) {
        resolve({ path: data.path, fileName: data.fileName ?? file.name });
      } else {
        reject(new Error(data?.error ?? "アップロードに失敗しました"));
      }
    };

    xhr.onerror = () => reject(new Error("通信エラーによりアップロードに失敗しました"));

    xhr.send(body);
  });
