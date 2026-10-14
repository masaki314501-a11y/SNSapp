import "@/components/editor/editor-theme.css";
import { AppTopBar } from "@/components/AppTopBar";
import { EmphasisScreen } from "./EmphasisScreen";

export default function CreateEmphasisPage() {
  return (
    <div className="flow-page">
      <AppTopBar backHref="/create/auto-edit" title="強調する字幕を選ぶ" step={{ current: 5, total: 7 }} />
      <EmphasisScreen />
    </div>
  );
}
