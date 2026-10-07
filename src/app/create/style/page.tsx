import { AppTopBar } from "@/components/AppTopBar";
import { StyleAndTranscribe } from "./StyleAndTranscribe";

export default function CreateStylePage() {
  return (
    <div className="flow-page">
      <AppTopBar backHref="/create/cut" title="見た目の手本を選ぶ" step={{ current: 3, total: 6 }} />
      <StyleAndTranscribe />
    </div>
  );
}
