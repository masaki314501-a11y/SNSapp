/** 動画に差し込む画像をサーバーにアップロードする(/api/upload-image)。 */
export const uploadImageFile = async (file: File): Promise<{ path: string; fileName: string }> => {
  const body = new FormData();
  body.set("file", file);
  const res = await fetch("/api/upload-image", { method: "POST", body });
  const data = (await res.json().catch(() => null)) as { path?: string; fileName?: string; error?: string } | null;
  if (!res.ok || !data?.path) {
    throw new Error(data?.error ?? "画像のアップロードに失敗しました");
  }
  return { path: data.path, fileName: data.fileName ?? file.name };
};
