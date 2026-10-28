/** Akses data pustaka (Supabase) dan utilitas sitasi pada JSON naskah. */
import { must, supabase } from '../supabase';
import { normalizeDoi, type CslItem, type Reference } from './csl';
import { styleFrom, type CiteStyle } from './format';

export const REF_COLS = 'id, thesis_id, csl, doi, sumber, created_at, updated_at';

export async function loadReferences(thesisId: string): Promise<Reference[]> {
  return (await must(supabase.from('thesis_references').select(REF_COLS).eq('thesis_id', thesisId).order('created_at'))) as Reference[];
}

/** Gaya sitasi dari pedoman aktif prodi (APA bila tidak ada atau tidak dikenali). */
export async function loadCiteStyle(prodiId: string | null | undefined): Promise<{ style: CiteStyle; label: string }> {
  if (!prodiId) return { style: 'apa', label: 'APA 7' };
  const { data } = await supabase.from('guidelines').select('gaya_sitasi').eq('prodi_id', prodiId).eq('aktif', true).order('berlaku_mulai', { ascending: false }).limit(1).maybeSingle();
  const raw = (data as { gaya_sitasi?: string } | null)?.gaya_sitasi ?? 'APA 7';
  const style = styleFrom(raw);
  return { style, label: style === 'ieee' ? 'IEEE' : 'APA 7' };
}

export type RefSource = Reference['sumber'];

export async function addReferences(thesisId: string, items: CslItem[], sumber: RefSource): Promise<{ added: Reference[]; skipped: number }> {
  if (!items.length) return { added: [], skipped: 0 };
  const existing = await loadReferences(thesisId);
  const have = new Set(existing.map((r) => r.doi?.toLowerCase()).filter(Boolean));
  const rows: { thesis_id: string; csl: CslItem; doi: string | null; sumber: RefSource }[] = [];
  let skipped = 0;
  for (const csl of items) {
    const doi = normalizeDoi(csl.DOI);
    if (doi && have.has(doi.toLowerCase())) {
      skipped++;
      continue;
    }
    if (doi) have.add(doi.toLowerCase());
    rows.push({ thesis_id: thesisId, csl: { ...csl, DOI: doi ?? undefined }, doi, sumber });
  }
  if (!rows.length) return { added: [], skipped };
  const added = (await must(supabase.from('thesis_references').insert(rows).select(REF_COLS))) as Reference[];
  return { added, skipped };
}

export async function updateReference(id: string, csl: CslItem): Promise<Reference> {
  const doi = normalizeDoi(csl.DOI);
  const row = await must(
    supabase
      .from('thesis_references')
      .update({ csl: { ...csl, DOI: doi ?? undefined }, doi })
      .eq('id', id)
      .select(REF_COLS)
      .single(),
  );
  return row as Reference;
}

export async function deleteReference(id: string): Promise<void> {
  await must(supabase.from('thesis_references').delete().eq('id', id));
}

export { citedIds } from './cited';

/** Pesan galat Supabase yang lebih ramah untuk pustaka. */
export function pustakaError(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  if (/thesis_references_doi_unik|duplicate key/i.test(m)) return 'Rujukan dengan DOI ini sudah ada di pustaka.';
  if (/row-level security/i.test(m)) return 'Anda tidak berhak mengubah pustaka studi akhir ini.';
  return m;
}
