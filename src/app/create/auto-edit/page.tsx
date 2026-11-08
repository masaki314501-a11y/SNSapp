import { AppTopBar } from "@/components/AppTopBar";
import { AutoEditScreen } from "./AutoEditScreen";

export default function CreateAutoEditPage() {
  return (
    <div className="flow-page">
      <AppTopBar backHref="/create/style" title="AIで自動編集" step={{ current: 4, total: 6 }} />
      <AutoEditScreen />
    </div>
  );
}
