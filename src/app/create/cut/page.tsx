import { CutEditor } from "@/components/editor/CutEditor";
import "@/components/editor/editor-theme.css";

// 見出し・説明文は上部バー(AppTopBar)に置き換え、画面の高さいっぱいをカットに使う。
export default function CreateCutPage() {
  return <CutEditor />;
}
