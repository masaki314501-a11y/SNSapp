import { AppTopBar } from "@/components/AppTopBar";
import { ExactCopyScreen } from "./ExactCopyScreen";

export default function CreateExactCopyPage() {
  return (
    <div className="flow-page">
      <AppTopBar backHref="/create/style" title="完全模倣" step={{ current: 4, total: 6 }} />
      <ExactCopyScreen />
    </div>
  );
}
