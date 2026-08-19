export const uploadVideoFile = async (file: File): Promise<string> => {
  const body = new FormData();
  body.set("file", file);
  const res = await fetch("/api/upload", { method: "POST", body });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "アップロードに失敗しました");
  return data.path as string;
};
