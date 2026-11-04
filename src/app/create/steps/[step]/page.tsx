import { AppTopBar } from "@/components/AppTopBar";
import { EDIT_STEPS } from "@/lib/editSteps/steps";
import { StepsScreen } from "../StepsScreen";

/** 工程ごとに編集の、1工程ぶんのページ(/create/steps/<工程の番号>)。 */
export default async function CreateStepPage({ params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  const number = Math.min(EDIT_STEPS.length, Math.max(1, Math.round(Number(step)) || 1));
  return (
    <div className="flow-page">
      <AppTopBar backHref="/create/auto-edit" title={`工程${number} / ${EDIT_STEPS.length}`} step={{ current: 4, total: 7 }} />
      <StepsScreen step={number} />
    </div>
  );
}
