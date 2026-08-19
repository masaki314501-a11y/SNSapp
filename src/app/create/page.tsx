"use client";

import { useState } from "react";
import { templateRegistry, TEMPLATE_IDS, type TemplateId } from "@video/templates/registry";
import { StandardEditor } from "./StandardEditor";
import { RankingEditor } from "./RankingEditor";

export default function CreatePage() {
  const [templateId, setTemplateId] = useState<TemplateId>("standard");

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12">
      <div>
        <h1 className="text-xl font-semibold">ショート動画を作成</h1>
        <p className="mt-1 text-sm text-zinc-500">
          テンプレートを選び、内容を入力してください。
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TEMPLATE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTemplateId(id)}
            className={
              "rounded-full border px-4 py-2 text-left text-sm transition-colors " +
              (id === templateId
                ? "border-foreground bg-foreground text-background"
                : "border-zinc-300 dark:border-zinc-700")
            }
          >
            <div className="font-medium">{templateRegistry[id].label}</div>
          </button>
        ))}
      </div>
      <p className="text-xs text-zinc-500">
        {templateRegistry[templateId].description}
      </p>

      {templateId === "standard" ? <StandardEditor /> : <RankingEditor />}
    </main>
  );
}
