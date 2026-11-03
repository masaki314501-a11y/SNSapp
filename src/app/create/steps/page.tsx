import { AppTopBar } from "@/components/AppTopBar";
import { StepsScreen } from "./StepsScreen";

export default function CreateStepsPage() {
  return (
    <div className="flow-page">
      <AppTopBar backHref="/create/auto-edit" title="工程ごとに編集" step={{ current: 4, total: 7 }} />
      <StepsScreen />
    </div>
  );
}
