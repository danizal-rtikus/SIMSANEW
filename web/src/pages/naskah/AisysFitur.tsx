/**
 * Fitur AISYS lanjutan untuk mahasiswa (peran AISYS: peneliti senior).
 * Setiap fitur membaca naskah yang tersimpan di server; hasil berupa arahan,
 * dan tindakan yang mengubah naskah selalu dapat dibatalkan dengan Ctrl+Z.
 */
import { useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import {
  aisys,
  JENIS_EJAAN,
  KATEGORI_LABEL,
  type BarisTerdahulu,
  type HasilAbstrak,
  type HasilCocok,
  type HasilEjaan,
  type HasilKerangka,
  type HasilKeselarasan,
  type HasilPersiapan,
  type HasilTanggapi,
  type JenisUjian,
  type Koreksi,
  type TemuanBab,
} from '../../lib/aisys';
import { buildIndex, chapterRange } from '../../lib/naskah/anchor';
import { kunciKey } from '../../lib/naskah/kunci';
import { chapters, type PmNode } from '../../lib/naskah/struktur';
import { cleanTitle, yearOf, type Reference } from '../../lib/pustaka/csl';
import { rpc } from '../../lib/queries';
import { Button } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useDialog } from '../../components/Dialog';
import { Disclaimer, copy, locateQuote, revealRange } from './aisysKit';

type Sisa = (n: number | null) => void;

function useRun<T>(onSisa: Sisa) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<T | null>(null);
  const go = async (fn: () => Promise<T & { sisa: number | null }>, before?: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await before?.();
      const r = await fn();
      onSisa(r.sisa);
      setRes(r);
      return r;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, res, setRes, go };
}

function BabSelect({ editor, value, onChange }: { editor: Editor; value: number; onChange: (n: number) => void }) {
  const list = chapters(editor.getJSON() as PmNode);
  const locked = kunciKey.getState(editor.state)?.bab;
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Bab">
      {list.map((c) => (
        <option key={c.bab} value={c.bab}>
          Bab {c.bab} {c.judul}
          {locked?.has(c.bab) ? ' (terkunci)' : ''}
        </option>
      ))}
    </select>
  );
}

function Intro({ children }: { children: string }) {
  return <p className="muted small" style={{ margin: 0 }}>{children}</p>;
}

/** Pindah ke kutipan di naskah dan sorot. */
function reveal(editor: Editor, toast: ReturnType<typeof useToast>, kutipan: string, bab?: number) {
  if (!kutipan) return;
  const hit = locateQuote(editor.state.doc, kutipan, bab);
  if (!hit) return toast.show('Bagian yang dimaksud sudah berubah atau tidak ditemukan.', 'neutral');
  revealRange(editor, hit.from, hit.to);
}

/* ================================================================== */
/* 1. Tanggapi catatan dosen                                           */
/* ================================================================== */

export interface CatatanDosen {
  id: string;
  bab: number;
  isi: string;
  kutipan: string | null;
  penulis: string;
  status: string;
}

export function TanggapiTab({ editor, thesisId, catatan, onSisa, onReplied }: { editor: Editor; thesisId: string; catatan: CatatanDosen[]; onSisa: Sisa; onReplied: () => void }) {
  const toast = useToast();
  const [pick, setPick] = useState<string>('');
  const r = useRun<HasilTanggapi>(onSisa);
  const [balasan, setBalasan] = useState('');
  const [sending, setSending] = useState(false);
  const cur = catatan.find((c) => c.id === pick) ?? null;

  const run = async () => {
    if (!cur) return;
    const out = await r.go(() => aisys.tanggapiCatatan(thesisId, cur.id));
    if (out) setBalasan(out.balasan);
  };

  const send = async () => {
    if (!cur || !balasan.trim()) return;
    setSending(true);
    try {
      await rpc('balas_komentar', { p_parent: cur.id, p_isi: balasan.trim() });
      toast.show('Balasan terkirim ke dosen', 'ok');
      onReplied();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="nk-ai-pad stack-sm">
      <section className="nk-ai-box">
        <Intro>Pilih catatan dosen yang ingin ditindaklanjuti. AISYS menjelaskan maksudnya, menyusun langkah perbaikan, dan menyiapkan draf balasan.</Intro>
        {catatan.length === 0 ? (
          <p className="muted small">Tidak ada catatan dosen yang masih aktif.</p>
        ) : (
          <ul className="nk-ai-pick">
            {catatan.map((c) => (
              <li key={c.id}>
                <button type="button" className={pick === c.id ? 'on' : ''} aria-pressed={pick === c.id} onClick={() => setPick(c.id)}>
                  <span className="muted small">
                    {c.penulis}, Bab {c.bab}
                  </span>
                  <span className="clamp small">{c.isi}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="nk-ai-row">
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="primary" loading={r.busy} disabled={!cur || r.busy} onClick={run}>
            Bantu tanggapi
          </Button>
        </div>
      </section>
      {r.err && <div className="note bad small">{r.err}</div>}
      {r.res && cur && (
        <section className="stack-sm">
          <div className="nk-ai-out">
            <div className="muted small">Maksud catatan</div>
            <p>{r.res.maksud}</p>
            {cur.kutipan && (
              <div className="nk-thread-actions">
                <button type="button" className="link-btn" onClick={() => reveal(editor, toast, cur.kutipan!, r.res!.bab)}>
                  Tunjukkan di naskah
                </button>
              </div>
            )}
          </div>
          {r.res.langkah.length > 0 && (
            <div className="nk-ai-out">
              <div className="muted small">Langkah perbaikan</div>
              <ol className="nk-ai-steps">
                {r.res.langkah.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ol>
            </div>
          )}
          {r.res.contoh && (
            <div className="nk-ai-out">
              <div className="muted small">Contoh revisi paragraf</div>
              <p>{r.res.contoh}</p>
              <div className="nk-thread-actions">
                <button type="button" className="link-btn" onClick={() => copy(r.res!.contoh, toast)}>
                  Salin
                </button>
              </div>
            </div>
          )}
          <div className="nk-ai-out">
            <div className="muted small">Draf balasan untuk dosen</div>
            <textarea rows={4} value={balasan} onChange={(e) => setBalasan(e.target.value)} />
            <div className="nk-thread-actions">
              <button type="button" className="link-btn" disabled={sending || !balasan.trim()} onClick={() => void send()}>
                {sending ? 'Mengirim' : 'Kirim balasan'}
              </button>
              <button type="button" className="link-btn" onClick={() => copy(balasan, toast)}>
                Salin
              </button>
            </div>
          </div>
          <Disclaimer>Sesuaikan balasan dengan yang benar-benar Anda kerjakan. Kirim balasan setelah perbaikan dilakukan.</Disclaimer>
        </section>
      )}
    </div>
  );
}

/* ================================================================== */
/* 2. Keselarasan antarbab                                             */
/* ================================================================== */

const STATUS_SELARAS: Record<string, { label: string; cls: string }> = {
  selaras: { label: 'Selaras', cls: 'ok' },
  sebagian: { label: 'Sebagian', cls: 'warn' },
  tidak: { label: 'Tidak selaras', cls: 'bad' },
};

function TemuanBabList({ list, editor }: { list: TemuanBab[]; editor: Editor }) {
  const toast = useToast();
  const [active, setActive] = useState<number | null>(null);
  if (!list.length) return null;
  return (
    <>
      <div className="nk-cgroup-head static">
        <span>Temuan ({list.length})</span>
      </div>
      <ul className="nk-thread-list">
        {list.map((t, i) => (
          <li
            key={i}
            className={`nk-thread nk-ai-temuan ${t.tingkat} ${active === i ? 'active' : ''}`}
            onClick={() => {
              setActive(i);
              reveal(editor, toast, t.kutipan, t.bab);
            }}
          >
            <div className="nk-thread-top">
              <span className={`nk-tag ${t.tingkat === 'penting' ? 'warn' : ''}`}>{t.tingkat === 'penting' ? 'Penting' : 'Saran'}</span>
              <span className="muted small">
                Bab {t.bab} · {KATEGORI_LABEL[t.kategori] ?? t.kategori}
              </span>
            </div>
            {t.kutipan && <blockquote className={`nk-quote ${active === i ? '' : 'clamp'}`}>{t.kutipan}</blockquote>}
            <p className="nk-thread-body">
              <span className="strong">{t.masalah}</span>
            </p>
            <p className={`nk-thread-body ${active === i ? '' : 'clamp'}`}>{t.saran}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

export function KeselarasanTab({ editor, thesisId, flush, onSisa }: { editor: Editor; thesisId: string; flush: () => Promise<void>; onSisa: Sisa }) {
  const r = useRun<HasilKeselarasan>(onSisa);
  const rows: [keyof HasilKeselarasan['butir'][number], string][] = [
    ['tujuan', 'Tujuan'],
    ['metode', 'Metode'],
    ['hasil', 'Hasil'],
    ['kesimpulan', 'Kesimpulan'],
  ];
  return (
    <div className="stack-sm">
      <section className="nk-ai-box nk-ai-pad-in">
        <Intro>AISYS menelusuri setiap rumusan masalah ke tujuan, metode, hasil, dan kesimpulan di seluruh naskah, seperti yang dilakukan penguji.</Intro>
        <div className="nk-ai-row">
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="primary" loading={r.busy} disabled={r.busy} onClick={() => void r.go(() => aisys.keselarasan(thesisId), flush)}>
            {r.res ? 'Periksa ulang' : 'Periksa keselarasan'}
          </Button>
        </div>
      </section>
      {r.err && <div className="note bad small nk-ai-pad">{r.err}</div>}
      {r.res && (
        <>
          <div className="nk-ai-pad stack-sm">
            <div className="small muted">{r.res.bab.map((b) => `Bab ${b.bab}`).join(', ')} dibaca</div>
            {r.res.ringkasan && <p style={{ margin: 0 }}>{r.res.ringkasan}</p>}
            {r.res.butir.map((b, i) => (
              <div key={i} className="nk-ai-out nk-align">
                <div className="row-between" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <span className="strong small">{b.rumusan || `Rumusan ${i + 1}`}</span>
                  <span className={`nk-tag ${STATUS_SELARAS[b.status]?.cls ?? ''}`}>{STATUS_SELARAS[b.status]?.label ?? b.status}</span>
                </div>
                <dl className="nk-align-grid">
                  {rows.map(([k, l]) => (
                    <div key={k}>
                      <dt>{l}</dt>
                      <dd className={/belum ada/i.test(String(b[k])) ? 'muted' : ''}>{String(b[k]) || '-'}</dd>
                    </div>
                  ))}
                </dl>
                {b.catatan && <p className="small" style={{ margin: 0 }}>{b.catatan}</p>}
              </div>
            ))}
          </div>
          <TemuanBabList list={r.res.temuan} editor={editor} />
          <div className="nk-ai-pad">
            <Disclaimer>Analisis berdasarkan naskah yang tersimpan. Bab yang belum ditulis ditandai "belum ada".</Disclaimer>
          </div>
        </>
      )}
    </div>
  );
}

/* ================================================================== */
/* 3. Kerangka subbab                                                  */
/* ================================================================== */

function h(level: number, text: string) {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] };
}

export function KerangkaTab({ editor, thesisId, flush, onSisa }: { editor: Editor; thesisId: string; flush: () => Promise<void>; onSisa: Sisa }) {
  const toast = useToast();
  const list = chapters(editor.getJSON() as PmNode);
  const [bab, setBab] = useState(list[0]?.bab ?? 1);
  const [catatan, setCatatan] = useState('');
  const r = useRun<HasilKerangka>(onSisa);
  const [pilih, setPilih] = useState<Set<number>>(new Set());

  const run = async () => {
    const out = await r.go(() => aisys.kerangka(thesisId, bab, catatan.trim()), flush);
    if (out) setPilih(new Set(out.subbab.map((x, i) => (x.ada ? -1 : i)).filter((i) => i >= 0)));
  };

  const insert = () => {
    if (!r.res) return;
    const range = chapterRange(editor.state.doc, r.res.bab);
    if (!range) return toast.show(`Bab ${r.res.bab} tidak ditemukan di naskah.`, 'bad');
    const nodes: unknown[] = [];
    r.res.subbab.forEach((x, i) => {
      if (!pilih.has(i)) return;
      nodes.push(h(2, x.judul), { type: 'paragraph' });
      for (const a of x.anak) nodes.push(h(3, a.judul), { type: 'paragraph' });
    });
    if (!nodes.length) return;
    const ok = editor.chain().focus().insertContentAt(range.to, nodes).run();
    if (ok) toast.show(`${pilih.size} subbab disisipkan di akhir Bab ${r.res.bab}. Tekan Ctrl+Z untuk membatalkan.`, 'ok');
  };

  return (
    <div className="nk-ai-pad stack-sm">
      <section className="nk-ai-box">
        <Intro>AISYS menyusun kerangka subbab sesuai pedoman prodi dan judul penelitian, lengkap dengan panduan isi setiap subbab.</Intro>
        <BabSelect editor={editor} value={bab} onChange={setBab} />
        <textarea rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan tambahan (opsional), mis. metode yang dipakai atau arahan pembimbing" />
        <div className="nk-ai-row">
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="primary" loading={r.busy} disabled={r.busy || !list.length} onClick={() => void run()}>
            Susun kerangka
          </Button>
        </div>
      </section>
      {r.err && <div className="note bad small">{r.err}</div>}
      {r.res && (
        <section className="stack-sm">
          <div className="small muted">
            Bab {r.res.bab} {r.res.judul}
            {r.res.pedoman ? ' · mengikuti pedoman prodi' : ' · pedoman prodi tidak tersedia'}
          </div>
          <ol className="nk-ai-outline">
            {r.res.subbab.map((x, i) => (
              <li key={i}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={pilih.has(i)}
                    disabled={x.ada}
                    onChange={(e) =>
                      setPilih((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(i);
                        else n.delete(i);
                        return n;
                      })
                    }
                  />
                  <span className="strong small">{x.judul}</span>
                  {x.ada && <span className="nk-tag">Sudah ada</span>}
                </label>
                <ul className="small muted">
                  {x.panduan.map((p, j) => (
                    <li key={j}>{p}</li>
                  ))}
                </ul>
                {x.anak.length > 0 && (
                  <ol className="nk-ai-outline sub">
                    {x.anak.map((a, j) => (
                      <li key={j}>
                        <span className="small">{a.judul}</span>
                        <ul className="small muted">
                          {a.panduan.map((p, k) => (
                            <li key={k}>{p}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ol>
          {r.res.catatan && <p className="small">{r.res.catatan}</p>}
          <div className="nk-ai-row">
            <span className="muted small" style={{ flex: 1 }}>
              Hanya judul subbab yang disisipkan; panduan tetap di panel ini.
            </span>
            <Button size="sm" disabled={!pilih.size} onClick={insert}>
              Sisipkan {pilih.size || ''} subbab
            </Button>
          </div>
          <Disclaimer />
        </section>
      )}
    </div>
  );
}

/* ================================================================== */
/* 4. Tabel penelitian terdahulu                                       */
/* ================================================================== */

const LENGKAPI = '[lengkapi dari artikel]';

function cell(content: unknown[], header = false) {
  return { type: header ? 'tableHeader' : 'tableCell', content: [{ type: 'paragraph', content }] };
}
const txt = (t: string) => (t ? [{ type: 'text', text: t }] : []);

export function TabelTab({ editor, thesisId, refs, flush, onSisa }: { editor: Editor; thesisId: string; refs: Reference[]; flush: () => Promise<void>; onSisa: Sisa }) {
  const toast = useToast();
  const [pilih, setPilih] = useState<string[]>([]);
  const r = useRun<{ baris: BarisTerdahulu[]; posisi: string }>(onSisa);
  const sorted = useMemo(() => [...refs].sort((a, b) => (yearOf(b.csl) ?? 0) - (yearOf(a.csl) ?? 0)), [refs]);

  const toggle = (id: string) => setPilih((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 10 ? p : [...p, id]));

  const insert = () => {
    if (!r.res) return;
    const head = ['No', 'Peneliti', 'Judul', 'Metode', 'Hasil', 'Perbedaan dengan penelitian ini'];
    const rows = [
      { type: 'tableRow', content: head.map((t) => cell(txt(t), true)) },
      ...r.res.baris.map((b, i) => ({
        type: 'tableRow',
        content: [
          cell(txt(String(i + 1))),
          cell([{ type: 'citation', attrs: { refs: [b.id], halaman: null, naratif: true } }]),
          cell(txt(b.judul)),
          cell(txt(b.metode || LENGKAPI)),
          cell(txt(b.hasil || LENGKAPI)),
          cell(txt(b.perbedaan || LENGKAPI)),
        ],
      })),
    ];
    const $pos = editor.state.doc.resolve(editor.state.selection.to);
    const at = $pos.depth >= 1 ? $pos.after(1) : editor.state.doc.content.size;
    const ok = editor
      .chain()
      .focus()
      .insertContentAt(at, [{ type: 'paragraph', attrs: { keterangan: 'tabel' }, content: txt('Penelitian terdahulu') }, { type: 'table', content: rows }])
      .run();
    if (ok) toast.show('Tabel disisipkan setelah posisi kursor. Lengkapi sel bertanda [lengkapi dari artikel].', 'ok');
  };

  return (
    <div className="nk-ai-pad stack-sm">
      <section className="nk-ai-box">
        <Intro>Pilih 1 sampai 10 rujukan dari pustaka. AISYS mengisi metode, hasil, dan perbedaannya dengan penelitian Anda dari abstrak; abstrak yang belum tersimpan diambil dari Crossref.</Intro>
        {refs.length === 0 ? (
          <p className="muted small">Pustaka masih kosong. Tambahkan rujukan lewat panel Pustaka atau fitur Cari jurnal.</p>
        ) : (
          <ul className="nk-ai-refs">
            {sorted.map((ref) => (
              <li key={ref.id}>
                <label className="check">
                  <input type="checkbox" checked={pilih.includes(ref.id)} disabled={!pilih.includes(ref.id) && pilih.length >= 10} onChange={() => toggle(ref.id)} />
                  <span className="small">
                    {cleanTitle(ref.csl.title)} <span className="muted">({yearOf(ref.csl) ?? 't.t.'})</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="nk-ai-row">
          <span className="muted small" style={{ flex: 1 }}>
            {pilih.length} dipilih
          </span>
          <Button size="sm" variant="primary" loading={r.busy} disabled={r.busy || !pilih.length} onClick={() => void r.go(() => aisys.tabelTerdahulu(thesisId, pilih), flush)}>
            Susun tabel
          </Button>
        </div>
      </section>
      {r.err && <div className="note bad small">{r.err}</div>}
      {r.res && (
        <section className="stack-sm">
          {r.res.baris.map((b, i) => (
            <div key={b.id} className="nk-ai-out">
              <div className="strong small">
                {i + 1}. {b.penulis} ({b.tahun ?? 't.t.'})
              </div>
              <div className="small muted clamp">{b.judul}</div>
              <dl className="nk-align-grid">
                <div>
                  <dt>Metode</dt>
                  <dd>{b.metode || <span className="muted">{LENGKAPI}</span>}</dd>
                </div>
                <div>
                  <dt>Hasil</dt>
                  <dd>{b.hasil || <span className="muted">{LENGKAPI}</span>}</dd>
                </div>
                <div>
                  <dt>Perbedaan</dt>
                  <dd>{b.perbedaan || <span className="muted">{LENGKAPI}</span>}</dd>
                </div>
              </dl>
              {!b.abstrak && <div className="small muted">Abstrak tidak tersedia; isi dari artikel aslinya.</div>}
            </div>
          ))}
          {r.res.posisi && (
            <div className="nk-ai-out">
              <div className="muted small">Posisi penelitian Anda</div>
              <p>{r.res.posisi}</p>
              <div className="nk-thread-actions">
                <button type="button" className="link-btn" onClick={() => copy(r.res!.posisi, toast)}>
                  Salin
                </button>
              </div>
            </div>
          )}
          <div className="nk-ai-row">
            <span style={{ flex: 1 }} />
            <Button size="sm" onClick={insert}>
              Sisipkan tabel ke naskah
            </Button>
          </div>
          <Disclaimer>Isi tabel disusun dari abstrak. Cocokkan dengan artikel aslinya sebelum dipakai.</Disclaimer>
        </section>
      )}
    </div>
  );
}

/* ================================================================== */
/* 5. Cocokkan rujukan                                                 */
/* ================================================================== */

/** Posisi akhir kalimat yang memuat rentang (sebelum titik), dalam blok teks yang sama. */
function sentenceEnd(doc: PMNode, to: number): number {
  const $p = doc.resolve(to);
  const end = $p.end();
  for (let p = to; p < end; p++) {
    const ch = doc.textBetween(p, p + 1, '', '￼');
    if (ch === '.' || ch === '?' || ch === '!') return p;
  }
  return end;
}

export function CocokTab({
  editor,
  thesisId,
  refs,
  flush,
  onSisa,
  onCari,
}: {
  editor: Editor;
  thesisId: string;
  refs: Reference[];
  flush: () => Promise<void>;
  onSisa: Sisa;
  onCari: (kata: string) => void;
}) {
  const toast = useToast();
  const list = chapters(editor.getJSON() as PmNode);
  const [bab, setBab] = useState(list[0]?.bab ?? 1);
  const r = useRun<HasilCocok>(onSisa);
  const [done, setDone] = useState<Set<number>>(new Set());
  const byId = useMemo(() => new Map(refs.map((x) => [x.id, x])), [refs]);

  const cite = (i: number, kutipan: string, ids: string[]) => {
    const hit = locateQuote(editor.state.doc, kutipan, r.res?.bab);
    if (!hit) return toast.show('Kalimatnya sudah berubah atau tidak ditemukan.', 'bad');
    const at = sentenceEnd(editor.state.doc, hit.to);
    const ok = editor.chain().focus().setTextSelection(at).insertCitation({ refs: ids }).run();
    if (ok) {
      setDone((s) => new Set(s).add(i));
      toast.show('Sitasi disisipkan di akhir kalimat. Tekan Ctrl+Z untuk membatalkan.', 'ok');
    }
  };

  return (
    <div className="nk-ai-pad stack-sm">
      <section className="nk-ai-box">
        <Intro>AISYS menandai klaim yang perlu rujukan dan mencocokkannya dengan pustaka Anda. Bila tidak ada yang cocok, AISYS memberi kata kunci pencarian.</Intro>
        <div className="nk-ai-row">
          <BabSelect editor={editor} value={bab} onChange={setBab} />
          <Button
            size="sm"
            variant="primary"
            loading={r.busy}
            disabled={r.busy || !list.length}
            onClick={() => {
              setDone(new Set());
              void r.go(() => aisys.cocokRujukan(thesisId, bab), flush);
            }}
          >
            Periksa
          </Button>
        </div>
      </section>
      {r.err && <div className="note bad small">{r.err}</div>}
      {r.res && (
        <section className="stack-sm">
          {r.res.butir.length === 0 && <p className="muted small">Tidak ditemukan klaim tanpa rujukan pada bab ini.</p>}
          {r.res.butir.map((b, i) => (
            <div key={i} className="nk-ai-out">
              <blockquote className="nk-quote clamp" onClick={() => reveal(editor, toast, b.kutipan, r.res!.bab)} style={{ cursor: 'pointer' }}>
                {b.kutipan}
              </blockquote>
              <p className="small" style={{ margin: 0 }}>
                {b.alasan}
              </p>
              {b.rujukan.length > 0 ? (
                <>
                  <ul className="small nk-ai-reflist">
                    {b.rujukan.map((id) => {
                      const ref = byId.get(id);
                      return <li key={id}>{ref ? `${cleanTitle(ref.csl.title)} (${yearOf(ref.csl) ?? 't.t.'})` : 'Rujukan dihapus'}</li>;
                    })}
                  </ul>
                  {b.kesesuaian && <p className="small muted" style={{ margin: 0 }}>{b.kesesuaian}</p>}
                </>
              ) : (
                <p className="small muted" style={{ margin: 0 }}>
                  Belum ada rujukan yang cocok di pustaka.{b.kata_kunci ? ` Kata kunci: ${b.kata_kunci}.` : ''}
                </p>
              )}
              <div className="nk-thread-actions">
                {b.rujukan.length > 0 &&
                  (done.has(i) ? (
                    <span className="nk-tag">Sitasi disisipkan</span>
                  ) : (
                    <button type="button" className="link-btn" onClick={() => cite(i, b.kutipan, b.rujukan.filter((id) => byId.has(id)))}>
                      Sisipkan sitasi
                    </button>
                  ))}
                {b.kata_kunci && (
                  <button type="button" className="link-btn" onClick={() => onCari(b.kata_kunci)}>
                    Cari jurnal
                  </button>
                )}
              </div>
            </div>
          ))}
          <Disclaimer>Pastikan isi rujukan benar-benar mendukung kalimat tersebut sebelum menyisipkan sitasi.</Disclaimer>
        </section>
      )}
    </div>
  );
}

/* ================================================================== */
/* 6. Ejaan dan kalimat efektif                                        */
/* ================================================================== */

/** Paragraf teks dalam satu bab, urutannya sama dengan server (babParagraphs). */
function babParagraphRanges(doc: PMNode, bab: number): { from: number; to: number }[] {
  const range = chapterRange(doc, bab);
  if (!range) return [];
  const out: { from: number; to: number }[] = [];
  doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (node.type.name === 'heading' || node.type.name === 'table' || node.type.name === 'image') return false;
    if (node.type.name === 'paragraph') {
      if (node.textContent.replace(/\s+/g, ' ').trim() && !node.attrs.keterangan) out.push({ from: pos + 1, to: pos + node.nodeSize - 1 });
      return false;
    }
    return true;
  });
  return out;
}

/** Cari potongan teks di dalam paragraf ke-p; tolak bila rentang memuat sitasi. */
function locateInParagraph(doc: PMNode, bab: number, p: number, salah: string): { from: number; to: number } | 'sitasi' | null {
  const para = babParagraphRanges(doc, bab)[p - 1];
  const tryIn = (r: { from: number; to: number }) => {
    const idx = buildIndex(doc, r.from, r.to);
    const i = idx.text.indexOf(salah);
    if (i < 0) return null;
    let s = i;
    let e = i + salah.length - 1;
    while (s <= e && idx.map[s] < 0) s++;
    while (e >= s && idx.map[e] < 0) e--;
    return s > e ? null : { from: idx.map[s], to: idx.map[e] + 1 };
  };
  let hit = para ? tryIn(para) : null;
  if (!hit) {
    // Paragraf bergeser setelah suntingan: cari di seluruh bab.
    for (const r of babParagraphRanges(doc, bab)) {
      hit = tryIn(r);
      if (hit) break;
    }
  }
  if (!hit) return null;
  let atom = false;
  doc.nodesBetween(hit.from, hit.to, (n) => {
    if (n.type.name === 'citation') atom = true;
  });
  return atom ? 'sitasi' : hit;
}

export function EjaanTab({ editor, thesisId, flush, onSisa }: { editor: Editor; thesisId: string; flush: () => Promise<void>; onSisa: Sisa }) {
  const toast = useToast();
  const list = chapters(editor.getJSON() as PmNode);
  const [bab, setBab] = useState(list[0]?.bab ?? 1);
  const r = useRun<HasilEjaan>(onSisa);
  const [state, setState] = useState<Map<number, 'diterapkan' | 'diabaikan'>>(new Map());
  const [filter, setFilter] = useState<'' | Koreksi['jenis']>('');

  const run = async (mulai: number) => {
    const out = await r.go(() => aisys.ejaan(thesisId, bab, mulai), flush);
    if (out) setState(new Map());
  };

  const apply = (k: Koreksi, i: number, quiet = false): boolean => {
    if (!r.res) return false;
    const hit = locateInParagraph(editor.state.doc, r.res.bab, k.p, k.salah);
    if (hit === 'sitasi') {
      if (!quiet) toast.show('Bagian ini memuat sitasi; perbaiki secara manual agar sitasinya tidak hilang.', 'bad');
      return false;
    }
    if (!hit) {
      if (!quiet) toast.show('Teksnya sudah berubah atau tidak ditemukan.', 'neutral');
      return false;
    }
    const tr = editor.state.tr.insertText(k.benar, hit.from, hit.to);
    editor.view.dispatch(tr);
    if (editor.state.doc.textBetween(hit.from, Math.min(hit.from + k.benar.length, editor.state.doc.content.size)) !== k.benar) return false;
    setState((m) => new Map(m).set(i, 'diterapkan'));
    return true;
  };

  const applyAll = () => {
    if (!r.res) return;
    let n = 0;
    r.res.koreksi.forEach((k, i) => {
      if (state.has(i) || k.jenis === 'kalimat_efektif' || (filter && k.jenis !== filter)) return;
      if (apply(k, i, true)) n++;
    });
    toast.show(n ? `${n} koreksi diterapkan. Koreksi kalimat efektif tetap ditinjau satu per satu.` : 'Tidak ada koreksi yang dapat diterapkan otomatis.', n ? 'ok' : 'neutral');
  };

  const shown = r.res?.koreksi.map((k, i) => ({ k, i })).filter(({ k }) => !filter || k.jenis === filter) ?? [];
  const sisa = shown.filter(({ i }) => !state.has(i)).length;

  return (
    <div className="nk-ai-pad stack-sm">
      <section className="nk-ai-box">
        <Intro>Pemeriksaan ejaan (EYD V), tanda baca, kata baku, dan kalimat efektif per bagian bab. Setiap koreksi dapat diterapkan langsung ke naskah.</Intro>
        <div className="nk-ai-row">
          <BabSelect editor={editor} value={bab} onChange={setBab} />
          <Button size="sm" variant="primary" loading={r.busy} disabled={r.busy || !list.length} onClick={() => void run(0)}>
            Periksa
          </Button>
        </div>
      </section>
      {r.err && <div className="note bad small">{r.err}</div>}
      {r.res && (
        <section className="stack-sm">
          <div className="row-between small" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="muted">
              Paragraf {r.res.dari}-{r.res.sampai} dari {r.res.total} · {r.res.koreksi.length} koreksi
            </span>
            <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Jenis koreksi" style={{ maxWidth: 170 }}>
              <option value="">Semua jenis</option>
              {(Object.keys(JENIS_EJAAN) as Koreksi['jenis'][]).map((j) => (
                <option key={j} value={j}>
                  {JENIS_EJAAN[j]}
                </option>
              ))}
            </select>
          </div>
          {shown.length === 0 && <p className="muted small">Tidak ada koreksi pada bagian ini.</p>}
          {shown.map(({ k, i }) => {
            const st = state.get(i);
            return (
              <div key={i} className={`nk-ai-out nk-fix ${st ?? ''}`}>
                <div className="row-between small" style={{ gap: 6 }}>
                  <span className="nk-tag">{JENIS_EJAAN[k.jenis]}</span>
                  <span className="muted">Paragraf {k.p}</span>
                </div>
                <div className="nk-fix-diff">
                  <del>{k.salah}</del>
                  <ins>{k.benar}</ins>
                </div>
                {k.alasan && <div className="small muted">{k.alasan}</div>}
                <div className="nk-thread-actions">
                  {st ? (
                    <span className="nk-tag">{st === 'diterapkan' ? 'Diterapkan' : 'Diabaikan'}</span>
                  ) : (
                    <>
                      <button type="button" className="link-btn" onClick={() => apply(k, i)}>
                        Terapkan
                      </button>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => {
                          const hit = locateInParagraph(editor.state.doc, r.res!.bab, k.p, k.salah);
                          if (hit && hit !== 'sitasi') revealRange(editor, hit.from, hit.to);
                          else toast.show('Teksnya sudah berubah atau tidak ditemukan.', 'neutral');
                        }}
                      >
                        Tunjukkan
                      </button>
                      <button type="button" className="link-btn" onClick={() => setState((m) => new Map(m).set(i, 'diabaikan'))}>
                        Abaikan
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <div className="nk-ai-row">
            {sisa > 0 && (
              <Button size="sm" onClick={applyAll}>
                Terapkan semua ejaan dan tanda baca
              </Button>
            )}
            <span style={{ flex: 1 }} />
            {r.res.berikutnya !== null && (
              <Button size="sm" variant="primary" loading={r.busy} onClick={() => void run(r.res!.berikutnya!)}>
                Periksa bagian berikutnya
              </Button>
            )}
          </div>
          <Disclaimer>Koreksi diterapkan sebagai suntingan biasa; tekan Ctrl+Z untuk membatalkan.</Disclaimer>
        </section>
      )}
    </div>
  );
}

/* ================================================================== */
/* 7. Draf abstrak                                                     */
/* ================================================================== */

function findHeading(doc: PMNode, re: RegExp): { pos: number; size: number } | null {
  let out: { pos: number; size: number } | null = null;
  doc.forEach((n, pos) => {
    if (!out && n.type.name === 'heading' && n.attrs.level === 1 && n.attrs.bernomor === false && re.test(n.textContent.trim())) out = { pos, size: n.nodeSize };
  });
  return out;
}

export function AbstrakTab({ editor, thesisId, flush, onSisa }: { editor: Editor; thesisId: string; flush: () => Promise<void>; onSisa: Sisa }) {
  const toast = useToast();
  const dialog = useDialog();
  const r = useRun<HasilAbstrak>(onSisa);

  const insert = async () => {
    if (!r.res) return;
    const { id, en, kata_kunci, keywords } = r.res;
    const pId = [{ type: 'paragraph', content: txt(id) }, { type: 'paragraph', content: txt(`Kata kunci: ${kata_kunci.join(', ')}`) }];
    const pEn = [{ type: 'paragraph', content: txt(en) }, { type: 'paragraph', content: txt(`Keywords: ${keywords.join(', ')}`) }];
    const doc = editor.state.doc;
    const hId = findHeading(doc, /^abstrak$/i);
    const hEn = findHeading(doc, /^abstract$/i);
    if (hId || hEn) {
      const ok = await dialog.confirm({
        title: 'Sisipkan abstrak',
        message: 'Naskah sudah memiliki bagian ABSTRAK atau ABSTRACT. Draf disisipkan tepat di bawah judul bagian tersebut; isi lama tidak dihapus.',
        confirmLabel: 'Sisipkan',
      });
      if (!ok) return;
      const headId = { type: 'heading', attrs: { level: 1, bernomor: false }, content: txt('ABSTRAK') };
      const headEn = { type: 'heading', attrs: { level: 1, bernomor: false }, content: txt('ABSTRACT') };
      const ops: { at: number; nodes: unknown[] }[] = [];
      if (hId && hEn) ops.push({ at: hId.pos + hId.size, nodes: pId }, { at: hEn.pos + hEn.size, nodes: pEn });
      else if (hId) ops.push({ at: hId.pos + hId.size, nodes: [...pId, headEn, ...pEn] });
      else if (hEn) ops.push({ at: hEn.pos, nodes: [headId, ...pId] }, { at: hEn.pos + hEn.size, nodes: pEn });
      // Sisipkan dari posisi paling belakang agar posisi depan tidak bergeser.
      ops.sort((a, b) => b.at - a.at);
      let chain = editor.chain().focus();
      for (const o of ops) chain = chain.insertContentAt(o.at, o.nodes);
      chain.run();
    } else {
      editor
        .chain()
        .focus()
        .insertContentAt(0, [
          { type: 'heading', attrs: { level: 1, bernomor: false }, content: txt('ABSTRAK') },
          ...pId,
          { type: 'heading', attrs: { level: 1, bernomor: false }, content: txt('ABSTRACT') },
          ...pEn,
        ])
        .run();
    }
    toast.show('Abstrak disisipkan di awal naskah. Tekan Ctrl+Z untuk membatalkan.', 'ok');
  };

  return (
    <div className="nk-ai-pad stack-sm">
      <section className="nk-ai-box">
        <Intro>AISYS menyusun draf abstrak bahasa Indonesia dan Inggris dari seluruh naskah: masalah, tujuan, metode, hasil, dan kesimpulan. Bagian yang belum ditulis ditandai.</Intro>
        <div className="nk-ai-row">
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="primary" loading={r.busy} disabled={r.busy} onClick={() => void r.go(() => aisys.abstrak(thesisId), flush)}>
            {r.res ? 'Susun ulang' : 'Susun abstrak'}
          </Button>
        </div>
      </section>
      {r.err && <div className="note bad small">{r.err}</div>}
      {r.res && (
        <section className="stack-sm">
          {r.res.catatan.length > 0 && (
            <div className="note warn small">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {r.res.catatan.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {(
            [
              ['ABSTRAK', r.res.id, `Kata kunci: ${r.res.kata_kunci.join(', ')}`, r.res.kata.id],
              ['ABSTRACT', r.res.en, `Keywords: ${r.res.keywords.join(', ')}`, r.res.kata.en],
            ] as const
          ).map(([t, body, kw, n]) => (
            <div key={t} className="nk-ai-out">
              <div className="row-between small">
                <span className="strong">{t}</span>
                <span className="muted">{n} kata</span>
              </div>
              <p>{body}</p>
              <p className="small">
                <em>{kw}</em>
              </p>
              <div className="nk-thread-actions">
                <button type="button" className="link-btn" onClick={() => copy(`${body}\n\n${kw}`, toast)}>
                  Salin
                </button>
              </div>
            </div>
          ))}
          <div className="nk-ai-row">
            <span style={{ flex: 1 }} />
            <Button size="sm" onClick={() => void insert()}>
              Sisipkan ke naskah
            </Button>
          </div>
          <Disclaimer>Abstrak final ditulis setelah hasil dan kesimpulan lengkap. Periksa setiap angka terhadap Bab Hasil.</Disclaimer>
        </section>
      )}
    </div>
  );
}

/* ================================================================== */
/* 8. Persiapan seminar                                                */
/* ================================================================== */

const UJIAN: Record<JenisUjian, string> = { sempro: 'Seminar Proposal', semhas: 'Seminar Hasil', pendadaran: 'Ujian Pendadaran', d3: 'Ujian Tugas Akhir' };
const KATEGORI_TANYA: Record<string, string> = { masalah: 'Masalah', teori: 'Teori', metode: 'Metode', data: 'Data', hasil: 'Hasil', kelemahan: 'Kelemahan', lainnya: 'Lainnya' };

function asText(p: HasilPersiapan): string {
  const lines = [`Persiapan ${p.label}`, '', 'PERKIRAAN PERTANYAAN PENGUJI', ''];
  p.pertanyaan.forEach((q, i) => {
    lines.push(`${i + 1}. ${q.pertanyaan}`);
    if (q.alasan) lines.push(`   Alasan: ${q.alasan}`);
    q.poin_jawaban.forEach((a) => lines.push(`   - ${a}`));
    lines.push('');
  });
  lines.push('KERANGKA SLIDE', '');
  p.slide.forEach((s, i) => {
    lines.push(`Slide ${i + 1}: ${s.judul}`);
    s.poin.forEach((a) => lines.push(`   - ${a}`));
    lines.push('');
  });
  if (p.tips.length) {
    lines.push('TIPS', '');
    p.tips.forEach((t) => lines.push(`- ${t}`));
  }
  return lines.join('\n');
}

export function PersiapanTab({ thesisId, jenjang, flush, onSisa }: { thesisId: string; jenjang: string; flush: () => Promise<void>; onSisa: Sisa }) {
  const toast = useToast();
  const opsi: JenisUjian[] = jenjang === 'D3' ? ['d3'] : ['sempro', 'semhas', 'pendadaran'];
  const [jenis, setJenis] = useState<JenisUjian>(opsi[0]);
  const [view, setView] = useState<'tanya' | 'slide'>('tanya');
  const [open, setOpen] = useState<number | null>(0);
  const r = useRun<HasilPersiapan>(onSisa);

  const download = () => {
    if (!r.res) return;
    const blob = new Blob([asText(r.res)], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `persiapan-${r.res.jenis}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  return (
    <div className="nk-ai-pad stack-sm">
      <section className="nk-ai-box">
        <Intro>AISYS berperan sebagai penguji: memperkirakan pertanyaan yang spesifik untuk naskah Anda beserta poin jawabannya, lalu menyusun kerangka slide presentasi.</Intro>
        <div className="nk-ai-row">
          <select value={jenis} onChange={(e) => setJenis(e.target.value as JenisUjian)} aria-label="Jenis ujian">
            {opsi.map((j) => (
              <option key={j} value={j}>
                {UJIAN[j]}
              </option>
            ))}
          </select>
          <Button size="sm" variant="primary" loading={r.busy} disabled={r.busy} onClick={() => void r.go(() => aisys.persiapanSeminar(thesisId, jenis), flush)}>
            Siapkan
          </Button>
        </div>
      </section>
      {r.err && <div className="note bad small">{r.err}</div>}
      {r.res && (
        <section className="stack-sm">
          <div className="nk-seg" role="tablist">
            <button type="button" role="tab" aria-selected={view === 'tanya'} className={view === 'tanya' ? 'on' : ''} onClick={() => setView('tanya')}>
              Pertanyaan ({r.res.pertanyaan.length})
            </button>
            <button type="button" role="tab" aria-selected={view === 'slide'} className={view === 'slide' ? 'on' : ''} onClick={() => setView('slide')}>
              Slide ({r.res.slide.length})
            </button>
          </div>
          {view === 'tanya' ? (
            <ol className="nk-ai-qa">
              {r.res.pertanyaan.map((q, i) => (
                <li key={i} className={open === i ? 'open' : ''}>
                  <button type="button" className="nk-ai-q" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                    <span className="nk-tag">{KATEGORI_TANYA[q.kategori] ?? q.kategori}</span>
                    <span>{q.pertanyaan}</span>
                  </button>
                  {open === i && (
                    <div className="nk-ai-a">
                      {q.alasan && <p className="small muted">{q.alasan}</p>}
                      <ul className="small">
                        {q.poin_jawaban.map((a, j) => (
                          <li key={j} className={/^\[belum ada/i.test(a) ? 'nk-ai-gap' : ''}>
                            {a}
                          </li>
                        ))}
                      </ul>
                      {q.bab && <div className="small muted">Rujuk Bab {q.bab}</div>}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <ol className="nk-ai-slides">
              {r.res.slide.map((s, i) => (
                <li key={i}>
                  <div className="strong small">{s.judul}</div>
                  <ul className="small">
                    {s.poin.map((p, j) => (
                      <li key={j}>{p}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
          {r.res.tips.length > 0 && (
            <div className="nk-ai-out">
              <div className="muted small">Tips</div>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {r.res.tips.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="nk-ai-row">
            <button type="button" className="link-btn small" onClick={() => copy(asText(r.res!), toast)}>
              Salin semua
            </button>
            <span style={{ flex: 1 }} />
            <Button size="sm" onClick={download}>
              Unduh teks
            </Button>
          </div>
          <Disclaimer>Poin bertanda [belum ada di naskah] perlu Anda lengkapi sebelum ujian.</Disclaimer>
        </section>
      )}
    </div>
  );
}
