import type { StyleReferenceFile } from "./ai";
import type { ReferenceTemplate } from "./template";
import { extractReferenceTemplate } from "@/lib/exactCopy/extract";
import { referenceIdOf } from "./templateExtract";

export { referenceIdOf };

/**
 * 選んだ見た目の手本の型。手本から自動で読み取る(templateExtract.ts。同じ手本なら2回目からは覚えた物)。
 * 手本が無い・読み取れない時は null(今まで通り、AIが手本を見て決める)。
 * 以前は手本ごとに人が測って書いた型(data/reference-templates)を使っていたが、それではお客様が添付した
 * 新しい手本に使えないため、自動で読み取る形にした(2026-11)。
 * 2026-11-26: 型は、完全模倣と同じ作り方(手本の画面から測る・手本と照らして直して凍結した完成型があればそれ)で先に作り、
 * その型で工程を進める。以前の読み取り方では、ミニタイトルの位置・書体・色、テロップの書体・色、効果音が手本と違っていた。
 */
export const findReferenceTemplate = async (
  references: StyleReferenceFile[],
  referencePaths: string[]
): Promise<ReferenceTemplate | null> => {
  if (references.length === 0 || referencePaths.length === 0) return null;
  return extractReferenceTemplate(references, referencePaths);
};
