/**
 * 学習・正解動画を /api/dev/edit-examples/upload にストリーム保存するためのヘルパー。
 * src/app/create/uploadVideoFile.ts と同じ理由で、multipart/form-dataではなく
 * 生のバイト列をそのまま送る(サーバー側がストリームのまま書き込むため)。
 */
export const uploadEditExampleMedia = (
  which: "correct" | "raw",
  file: File,
  label: string
): Promise<{ filename: string; mimeType: string }> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/dev/edit-examples/upload?which=${which}`);
    xhr.responseType = "json";
    xhr.setRequestHeader("X-Mime-Type", file.type);
    xhr.setRequestHeader("X-Label", encodeURIComponent(label));

    xhr.onload = () => {
      const data = xhr.response as { filename?: string; mimeType?: string; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && data?.filename && data?.mimeType) {
        resolve({ filename: data.filename, mimeType: data.mimeType });
      } else {
        reject(new Error(data?.error ?? "アップロードに失敗しました"));
      }
    };

    xhr.onerror = () => reject(new Error("通信エラーによりアップロードに失敗しました"));

    xhr.send(file);
  });
