import { AppTopBar } from "@/components/AppTopBar";
import { UploadGenerator } from "./UploadGenerator";

export default function CreatePage() {
  return (
    <div className="flow-page">
      <AppTopBar backHref="/" backLabel="トップへ戻る" title="動画を選ぶ" step={{ current: 1, total: 6 }} />
      <UploadGenerator />
    </div>
  );
}
