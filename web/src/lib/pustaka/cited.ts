import type { PmNode } from '../naskah/struktur';

/** Id rujukan yang dikutip, menurut urutan kemunculan pertama di naskah (JSON). */
export function citedIds(doc: PmNode | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (n: PmNode) => {
    if (n.type === 'citation') {
      for (const id of (n.attrs?.refs as string[] | undefined) ?? []) {
        if (!seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
      return;
    }
    n.content?.forEach(walk);
  };
  if (doc) walk(doc);
  return out;
}
