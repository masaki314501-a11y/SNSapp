import { AppTopBar } from "@/components/AppTopBar";
import { ExportScreen } from "@/components/editor/ExportScreen";
import "@/components/editor/editor-theme.css";

export default function ExportPage() {
  return (
    <div className="flow-page">
      <AppTopBar backHref="/edit" backLabel="編集に戻る" title="書き出し" step={{ current: 6, total: 6 }} />
      <ExportScreen />
    </div>
  );
}
