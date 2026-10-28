import type { Node as PMNode } from '@tiptap/pm/model';
import { must, supabase } from '../supabase';
import type { ChapterReview, ChapterSubmission, ReviewComment } from '../types';
import { buildIndex, chapterRange, findQuote } from './anchor';
import type { CommentMark } from './extensions';

export const SUBMISSION_COLS = 'id, thesis_id, bab, nomor, judul, version_id, milestone_id, catatan, status, created_at, ditutup_at';

export interface ReviewData {
  submissions: ChapterSubmission[];
  reviews: ChapterReview[];
  comments: ReviewComment[];
  peran: Map<string, 'P1' | 'P2'>;
}

export async function loadReviewData(thesisId: string): Promise<ReviewData> {
  const [submissions, reviews, comments, sups] = await Promise.all([
    must(supabase.from('chapter_submissions').select(SUBMISSION_COLS).eq('thesis_id', thesisId).order('bab').order('nomor')),
    must(supabase.from('chapter_reviews').select('*, dosen:profiles!chapter_reviews_dosen_id_fkey(nama)').eq('thesis_id', thesisId).order('created_at')),
    must(supabase.from('review_comments').select('*, penulis:profiles!review_comments_penulis_id_fkey(nama)').eq('thesis_id', thesisId).order('created_at')),
    must(supabase.from('thesis_supervisors').select('dosen_id, peran').eq('thesis_id', thesisId).eq('aktif', true)),
  ]);
  return {
    submissions: submissions as unknown as ChapterSubmission[],
    reviews: reviews as unknown as ChapterReview[],
    comments: comments as unknown as ReviewComment[],
    peran: new Map((sups as { dosen_id: string; peran: 'P1' | 'P2' }[]).map((s) => [s.dosen_id, s.peran])),
  };
}

export interface BabState {
  label: string;
  tone: 'neutral' | 'info' | 'warn' | 'ok';
  latest: ChapterSubmission | null;
}

/** Status ringkas satu bab dari pengajuan terakhir dan keputusan pembimbing. */
export function babState(data: Pick<ReviewData, 'submissions' | 'reviews'>, bab: number): BabState {
  const subs = data.submissions.filter((s) => s.bab === bab && s.status !== 'ditarik');
  const latest = subs[subs.length - 1] ?? null;
  if (!latest) return { label: 'Belum diajukan', tone: 'neutral', latest: null };
  const accBy = new Set(
    data.reviews.filter((r) => r.hasil === 'acc' && subs.some((s) => s.id === r.submission_id)).map((r) => r.peran),
  );
  if (latest.status === 'acc') return { label: 'ACC', tone: 'ok', latest };
  if (latest.status === 'revisi') return { label: `Revisi (ke-${latest.nomor})`, tone: 'warn', latest };
  const revisiBy = data.reviews.filter((r) => r.submission_id === latest.id && r.hasil === 'revisi').map((r) => r.peran);
  if (revisiBy.length) return { label: `Revisi ${[...new Set(revisiBy)].sort().join(', ')}, menunggu pembimbing lain`, tone: 'warn', latest };
  if (accBy.size) return { label: `ACC ${[...accBy].sort().join(', ')}`, tone: 'info', latest };
  return { label: `Menunggu review (ke-${latest.nomor})`, tone: 'info', latest };
}

export interface CommentThread {
  root: ReviewComment;
  replies: ReviewComment[];
}

export function threads(comments: ReviewComment[]): CommentThread[] {
  const replies = new Map<string, ReviewComment[]>();
  for (const c of comments) {
    if (c.parent_id) {
      const arr = replies.get(c.parent_id) ?? [];
      arr.push(c);
      replies.set(c.parent_id, arr);
    }
  }
  return comments.filter((c) => !c.parent_id).map((root) => ({ root, replies: replies.get(root.id) ?? [] }));
}

/**
 * Tambatkan komentar ke dokumen.
 * - `snapshotOf`: id pengajuan yang dokumennya sedang ditampilkan (posisi tersimpan langsung dipakai).
 * - `wholeNaskah`: dokumen adalah naskah utuh, sehingga pencarian dibatasi ke rentang bab komentar.
 */
export function anchorComments(
  doc: PMNode,
  list: CommentThread[],
  opts: { snapshotOf?: string; wholeNaskah?: boolean; cls: (t: CommentThread) => string },
): { marks: CommentMark[]; orphans: Set<string> } {
  const marks: CommentMark[] = [];
  const orphans = new Set<string>();
  const indexCache = new Map<number, ReturnType<typeof buildIndex> | null>();
  for (const t of list) {
    const c = t.root;
    if (!c.kutipan) continue;
    if (opts.snapshotOf && c.submission_id === opts.snapshotOf && c.posisi && c.posisi.to <= doc.content.size) {
      marks.push({ id: c.id, from: c.posisi.from, to: c.posisi.to, cls: opts.cls(t) });
      continue;
    }
    let index = indexCache.get(opts.wholeNaskah ? c.bab : 0);
    if (index === undefined) {
      if (opts.wholeNaskah) {
        const r = chapterRange(doc, c.bab);
        index = r ? buildIndex(doc, r.from, r.to) : null;
      } else index = buildIndex(doc);
      indexCache.set(opts.wholeNaskah ? c.bab : 0, index);
    }
    const hit = index ? findQuote(index, { kutipan: c.kutipan, prefix: c.prefix ?? '', suffix: c.suffix ?? '' }) : null;
    if (hit) marks.push({ id: c.id, from: hit.from, to: hit.to, cls: opts.cls(t) });
    else orphans.add(c.id);
  }
  return { marks, orphans };
}
