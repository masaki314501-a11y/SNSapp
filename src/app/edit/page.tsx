import { ClipEditor } from "@/components/editor/ClipEditor";
import "@/components/editor/editor-theme.css";

// 見出し・説明文は上部バー(AppTopBar)に置き換え、画面の高さいっぱいを編集に使う。
export default function EditPage() {
  return <ClipEditor />;
}
