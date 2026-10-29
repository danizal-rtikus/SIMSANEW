import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { aisys, type PanduBuku, type PanduGiliran, type PanduJawab, type PanduSesi } from '../../lib/aisys';
import { rpc } from '../../lib/queries';
import { crossrefToCsl } from '../../lib/pustaka/sources';
import { cleanTitle, normalizeDoi, type CslItem, type CslName, type Reference } from '../../lib/pustaka/csl';
import { addReferences, pustakaError } from '../../lib/pustaka/data';
import { buildContext, formatCitation } from '../../lib/pustaka/format';
import { babRanges, kunciKey } from '../../lib/naskah/kunci';
import { Button } from '../../components/ui';
import { useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import { Disclaimer } from './aisysKit';

/* ================================================================== */
/* Pandu latar belakang: sesi bertahap, satu pertanyaan per giliran    */
/* ================================================================== */

type Sisa = (n: number | null) => void;

const MARK = /\s*\[(R\d+(?:\s*[,;]\s*R\d+)*)\]/gi;

/** Pecah teks draf menjadi potongan teks dan sitasi (penanda [R1] menjadi node sitasi). */
function segmen(teks: string, refIds: string[]): ({ t: 'teks'; v: string } | { t: 'sitasi'; ids: string[] })[] {
  const out: ({ t: 'teks'; v: string } | { t: 'sitasi'; ids: string[] })[] = [];
  let last = 0;
  for (const m of teks.matchAll(MARK)) {
    const ids = m[1]
      .split(/[,;]/)
      .map((x) => refIds[Number(x.trim().slice(1)) - 1])
      .filter(Boolean);
    if (m.index! > last) out.push({ t: 'teks', v: teks.slice(last, m.index) });
    if (ids.length) out.push({ t: 'sitasi', ids });
    last = m.index! + m[0].length;
  }
  if (last < teks.length) out.push({ t: 'teks', v: teks.slice(last) });
  return out;
}

function namaCsl(nama: string): CslName {
  const parts = nama.trim().split(/\s+/);
  if (parts.length < 2) return { literal: nama.trim() };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(' ') };
}

function bukuCsl(b: PanduBuku): CslItem {
  const it: CslItem = { type: 'book', title: b.judul, author: b.penulis.map(namaCsl) };
  if (b.tahun) it.issued = { 'date-parts': [[b.tahun]] };
  if (b.penerbit) it.publisher = b.penerbit;
  if (b.isbn) it.ISBN = b.isbn;
  if (b.url) it.URL = b.url;
  return it;
}

const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function PanduTab({
  editor,
  thesisId,
  refs,
  onRefs,
  flush,
  onSisa,
}: {
  editor: Editor;
  thesisId: string;
  refs: Reference[];
  onRefs: (r: Reference[]) => void;
  flush: () => Promise<void>;
  onSisa: Sisa;
}) {
  const dialog = useDialog();
  const [sesi, setSesi] = useState<PanduSesi | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [teks, setTeks] = useState('');
  const [tulis, setTulis] = useState(false);

  useEffect(() => {
    let on = true;
    aisys
      .pandu(thesisId)
      .then((r) => on && setSesi(r.sesi))
      .catch((e) => on && (setSesi(null), setErr((e as Error).message)));
    return () => {
      on = false;
    };
  }, [thesisId]);

  const cur = sesi?.current ?? null;
  useEffect(() => {
    setTeks('');
    setTulis(false);
  }, [cur]);

  const mulai = async () => {
    if (sesi?.status === 'aktif') {
      const ok = await dialog.confirm({
        title: 'Mulai ulang sesi?',
        message: 'Jawaban pada sesi ini ditinggalkan dan sesi baru dimulai dari awal. Sesi baru dihitung satu pemakaian AISYS.',
        confirmLabel: 'Mulai ulang',
      });
      if (!ok) return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await aisys.panduMulai(thesisId);
      onSisa(r.sisa);
      setSesi(r.sesi);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const kirim = async (j: PanduJawab) => {
    if (!sesi) return;
    setBusy(true);
    setErr(null);
    try {
      setSesi(await aisys.panduJawab(sesi.id, j));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (sesi === undefined) return <p className="muted small nk-ai-pad">Memuat sesi...</p>;

  if (!sesi || sesi.status !== 'aktif' && !cur) {
    return (
      <div className="nk-ai-pad stack-sm">
        <section className="nk-ai-box stack-sm">
          <p className="small" style={{ margin: 0 }}>
            AISYS memandu Anda menyusun draf Latar Belakang langkah demi langkah, satu pertanyaan per giliran:
          </p>
          <ol className="pd-steps small">
            <li>Jenis skripsi sesuai program studi</li>
            <li>Pembedahan WHY: alasan di balik setiap elemen topik</li>
            <li>Kerangka OMKKMASASOLTU: Objek, Metode, Kelebihan dan Kekurangan, Masalah, Solusi, Tujuan</li>
            <li>Literatur nyata dari Crossref (5 tahun terakhir) dan Google Books</li>
            <li>Draf dengan sitasi dari literatur terpilih, lalu disisipkan ke Bab 1</li>
          </ol>
          <p className="muted small" style={{ margin: 0 }}>Satu sesi dihitung satu pemakaian AISYS. Sesi tersimpan, jadi Anda dapat melanjutkan kapan saja.</p>
          <div className="nk-ai-row">
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="primary" loading={busy} onClick={mulai}>
              Mulai sesi
            </Button>
          </div>
        </section>
        {err && <div className="note bad small">{err}</div>}
      </div>
    );
  }

  const g = cur!;
  return (
    <div className="nk-ai-pad stack-sm">
      <div className="row-between">
        <span className="pd-progres">{g.progres}</span>
        {sesi.status === 'aktif' && (
          <button type="button" className="link-btn small" onClick={mulai} disabled={busy}>
            Mulai ulang
          </button>
        )}
      </div>

      {g.pengantar && <p className="small pd-pengantar">{g.pengantar}</p>}
      {g.umpan_balik && (
        <div className="note small">
          <div className="strong">Umpan balik</div>
          {g.umpan_balik}
        </div>
      )}
      {g.ringkasan && <blockquote className="nk-quote pd-ringkas">{g.ringkasan}</blockquote>}

      <section className="nk-ai-box stack-sm">
        <div className="strong small">{g.pertanyaan}</div>

        {(g.kind === 'pilihan' || g.kind === 'konfirmasi') && (
          <div className="pd-opsi" role="group" aria-label="Pilihan jawaban">
            {g.opsi.map((o) =>
              o.k === 'D' ? (
                <button key={o.k} type="button" className={`pd-opsi-btn ${tulis ? 'on' : ''}`} disabled={busy} onClick={() => setTulis((v) => !v)}>
                  <span className="pd-key">{o.k}</span>
                  <span>{o.teks}</span>
                </button>
              ) : (
                <button key={o.k} type="button" className="pd-opsi-btn" disabled={busy} onClick={() => kirim({ pilihan: o.k })}>
                  <span className="pd-key">{o.k}</span>
                  <span>{o.teks}</span>
                </button>
              ),
            )}
          </div>
        )}

        {((g.kind === 'pilihan' || g.kind === 'konfirmasi') && tulis) || (g.kind === 'pilihan' && g.bebas && !g.opsi.some((o) => o.k === 'D')) ? (
          <JawabSendiri
            busy={busy}
            teks={teks}
            setTeks={setTeks}
            placeholder={g.kind === 'konfirmasi' ? 'Tulis bagian yang perlu dikoreksi' : 'Tulis jawaban Anda'}
            label={g.kind === 'konfirmasi' ? 'Kirim koreksi' : 'Kirim jawaban'}
            onSend={() => kirim({ pilihan: 'D', teks })}
          />
        ) : null}

        {g.kind === 'literatur' && <Literatur g={g} busy={busy} thesisId={thesisId} refs={refs} onRefs={onRefs} kirim={kirim} />}
        {g.kind === 'draf' && <Draf g={g} busy={busy} editor={editor} thesisId={thesisId} refs={refs} flush={flush} kirim={kirim} />}
        {g.kind === 'selesai' && (
          <div className="nk-ai-row">
            <span style={{ flex: 1 }} />
            <Button size="sm" loading={busy} onClick={mulai}>
              Mulai sesi baru
            </Button>
          </div>
        )}
      </section>

      {busy && <p className="muted small">AISYS sedang menyusun langkah berikutnya...</p>}
      {err && <div className="note bad small">{err}</div>}

      {sesi.riwayat.length > 0 && (
        <details className="pd-riwayat">
          <summary className="small">Jawaban sebelumnya ({sesi.riwayat.length})</summary>
          <ol>
            {sesi.riwayat.map((r, i) => (
              <li key={i}>
                <div className="muted small">{r.tahap}</div>
                <div className="small">{r.pertanyaan}</div>
                <div className="small strong">{r.jawaban}</div>
              </li>
            ))}
          </ol>
        </details>
      )}
      <Disclaimer>Opsi dari AISYS hanya contoh arah berpikir. Jawaban yang paling baik adalah yang benar-benar sesuai kondisi penelitian Anda.</Disclaimer>
    </div>
  );
}

function JawabSendiri({ busy, teks, setTeks, placeholder, label, onSend }: { busy: boolean; teks: string; setTeks: (s: string) => void; placeholder: string; label: string; onSend: () => void }) {
  return (
    <div className="stack-xs">
      <textarea rows={4} value={teks} maxLength={2000} onChange={(e) => setTeks(e.target.value)} placeholder={placeholder} />
      <div className="nk-ai-row">
        <span className="muted small">{teks.length}/2000</span>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="primary" loading={busy} disabled={busy || teks.trim().length < 3} onClick={onSend}>
          {label}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tahap 3: literatur                                                  */
/* ------------------------------------------------------------------ */

const ASPEK: Record<string, string> = { fenomena: 'Fenomena', teori: 'Teori/metode', terdahulu: 'Penelitian terdahulu' };

function Literatur({
  g,
  busy,
  thesisId,
  refs,
  onRefs,
  kirim,
}: {
  g: PanduGiliran;
  busy: boolean;
  thesisId: string;
  refs: Reference[];
  onRefs: (r: Reference[]) => void;
  kirim: (j: PanduJawab) => Promise<void>;
}) {
  const toast = useToast();
  const lit = g.literatur!;
  const keyA = (i: number) => `a${i}`;
  const keyB = (i: number) => `b${i}`;
  const [pilih, setPilih] = useState<Set<string>>(() => new Set([...lit.artikel.map((_, i) => keyA(i)), ...lit.buku.map((_, i) => keyB(i))]));
  const [kunci, setKunci] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => setPilih(new Set([...lit.artikel.map((_, i) => keyA(i)), ...lit.buku.map((_, i) => keyB(i))])), [lit]);

  const toggle = (k: string) =>
    setPilih((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const pakai = async () => {
    setSaving(true);
    try {
      const ids: string[] = [];
      const baru: CslItem[] = [];
      const urut: ({ ada: string } | { baru: number })[] = [];
      lit.artikel.forEach(({ work }, i) => {
        if (!pilih.has(keyA(i))) return;
        const doi = normalizeDoi(work.DOI)?.toLowerCase();
        const ada = refs.find((r) => doi && r.doi?.toLowerCase() === doi);
        if (ada) return urut.push({ ada: ada.id });
        const csl = crossrefToCsl(work);
        if (work.abstract) csl.abstract = work.abstract;
        urut.push({ baru: baru.push(csl) - 1 });
      });
      lit.buku.forEach((b, i) => {
        if (!pilih.has(keyB(i))) return;
        const ada = refs.find((r) => (b.isbn && r.csl.ISBN === b.isbn) || norm(cleanTitle(r.csl.title)) === norm(b.judul));
        if (ada) return urut.push({ ada: ada.id });
        urut.push({ baru: baru.push(bukuCsl(b)) - 1 });
      });
      let added: Reference[] = [];
      if (baru.length) {
        const r = await addReferences(thesisId, baru, 'cari');
        added = r.added;
        if (added.length) onRefs([...refs, ...added]);
      }
      // Cocokkan kembali butir baru dengan baris yang tersimpan (DOI atau judul).
      const cocok = (c: CslItem) => {
        const doi = normalizeDoi(c.DOI)?.toLowerCase();
        return added.find((r) => (doi && r.doi?.toLowerCase() === doi) || norm(cleanTitle(r.csl.title)) === norm(cleanTitle(c.title)));
      };
      for (const u of urut) {
        const id = 'ada' in u ? u.ada : cocok(baru[u.baru])?.id;
        if (id && !ids.includes(id)) ids.push(id);
      }
      if (added.length) toast.show(`${added.length} rujukan ditambahkan ke Pustaka`, 'ok');
      await kirim({ ref_ids: ids });
    } catch (e) {
      toast.show(pustakaError(e), 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack-sm">
      {lit.kueri.length > 0 && <div className="muted small">Kata kunci: {lit.kueri.join('; ')}</div>}
      {lit.artikel.length > 0 && (
        <ul className="pd-lit">
          {lit.artikel.map(({ work, alasan, aspek }, i) => {
            const csl = crossrefToCsl(work);
            const authors = (csl.author ?? []).map((a) => a.literal ?? a.family).filter(Boolean);
            const doi = normalizeDoi(work.DOI);
            return (
              <li key={keyA(i)}>
                <label className="check">
                  <input type="checkbox" checked={pilih.has(keyA(i))} onChange={() => toggle(keyA(i))} />
                  <span>
                    <span className="strong small">{cleanTitle(csl.title)}</span>
                    <span className="muted small pd-meta">
                      {[authors.length > 2 ? `${authors[0]} et al.` : authors.join(' & '), csl.issued?.['date-parts']?.[0]?.[0], csl['container-title']].filter(Boolean).join(' · ')}
                    </span>
                    {doi && (
                      <a className="small pd-meta" href={`https://doi.org/${doi}`} target="_blank" rel="noreferrer">
                        doi.org/{doi}
                      </a>
                    )}
                    <span className="small pd-meta">
                      {ASPEK[aspek] && <span className="nk-tag">{ASPEK[aspek]}</span>} {alasan}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {lit.buku.length > 0 && (
        <>
          <div className="nk-ai-menu-head">Buku</div>
          <ul className="pd-lit">
            {lit.buku.map((b, i) => (
              <li key={keyB(i)}>
                <label className="check">
                  <input type="checkbox" checked={pilih.has(keyB(i))} onChange={() => toggle(keyB(i))} />
                  <span>
                    <span className="strong small">{b.judul}</span>
                    <span className="muted small pd-meta">{[b.penulis.join(', '), b.tahun, b.penerbit].filter(Boolean).join(' · ')}</span>
                    {b.url && (
                      <a className="small pd-meta" href={b.url} target="_blank" rel="noreferrer">
                        Google Books
                      </a>
                    )}
                    <span className="small pd-meta">{b.alasan}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {(lit.artikel.length > 0 || lit.buku.length > 0) && (
        <div className="nk-ai-row">
          <span className="muted small">{pilih.size} dipilih</span>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="primary" loading={saving || busy} disabled={saving || busy} onClick={pakai}>
            {pilih.size ? 'Pakai dan susun draf' : 'Susun draf tanpa literatur'}
          </Button>
        </div>
      )}
      <div className="stack-xs">
        <div className="small strong">Cari ulang dengan kata kunci lain</div>
        <div className="nk-ai-row">
          <input value={kunci} onChange={(e) => setKunci(e.target.value)} placeholder="mis. technology acceptance model e-learning" aria-label="Kata kunci pencarian" />
          <Button size="sm" disabled={busy || kunci.trim().length < 3} onClick={() => kirim({ aksi: 'cari_ulang', teks: kunci.trim() })}>
            Cari
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tahap 4 dan 5: draf, lalu sisipkan ke Bab 1                         */
/* ------------------------------------------------------------------ */

type Blok = Record<string, unknown>;

const SUBBAB = {
  latar: { cari: /latar\s+belakang/i, judul: 'Latar Belakang' },
  rumusan: { cari: /rumusan\s+masalah/i, judul: 'Rumusan Masalah' },
  tujuan: { cari: /^tujuan/i, judul: 'Tujuan Penelitian' },
} as const;

function Draf({
  g,
  busy,
  editor,
  thesisId,
  refs,
  flush,
  kirim,
}: {
  g: PanduGiliran;
  busy: boolean;
  editor: Editor;
  thesisId: string;
  refs: Reference[];
  flush: () => Promise<void>;
  kirim: (j: PanduJawab) => Promise<void>;
}) {
  const toast = useToast();
  const dialog = useDialog();
  const d = g.draf!;
  const [catatan, setCatatan] = useState('');
  const [inserting, setInserting] = useState(false);
  const ctx = useMemo(() => buildContext(refs, 'apa', d.refs), [refs, d.refs]);
  const label = (ids: string[]) => {
    const ok = ids.filter((id) => refs.some((r) => r.id === id));
    return ok.length ? formatCitation(ok, ctx) : '[rujukan]';
  };

  const render = (t: string) =>
    segmen(t, d.refs).map((s, i) =>
      s.t === 'teks' ? (
        <span key={i}>{s.v}</span>
      ) : (
        <span key={i} className="pd-cite">
          {' '}
          {label(s.ids)}
        </span>
      ),
    );

  const inline = (t: string): Blok[] =>
    segmen(t, d.refs).flatMap((s): Blok[] =>
      s.t === 'teks' ? (s.v ? [{ type: 'text', text: s.v }] : []) : [{ type: 'text', text: ' ' }, { type: 'citation', attrs: { refs: s.ids, halaman: null, naratif: false } }],
    );
  const para = (t: string): Blok => ({ type: 'paragraph', content: inline(t) });
  const daftar = (items: string[]): Blok => ({ type: 'orderedList', content: items.map((x) => ({ type: 'listItem', content: [para(x)] })) });

  const sisipkan = async () => {
    const kunci = kunciKey.getState(editor.state)?.bab;
    if (kunci?.has(1)) return toast.show('Bab 1 sudah terkunci (ACC P1 dan P2). Draf tidak dapat disisipkan.', 'bad');
    const ok = await dialog.confirm({
      title: 'Sisipkan draf ke Bab 1?',
      message: 'Draf ditambahkan di akhir subbab Latar Belakang, Rumusan Masalah, dan Tujuan Penelitian (subbab dibuat bila belum ada). Isi yang sudah ada tidak dihapus. Versi naskah disimpan setelahnya.',
      confirmLabel: 'Sisipkan',
    });
    if (!ok) return;

    const isi: Record<keyof typeof SUBBAB, Blok[]> = {
      latar: d.paragraf.map(para),
      rumusan: [...(d.problem_statement ? [para(d.problem_statement)] : []), ...(d.research_questions.length ? [daftar(d.research_questions)] : [])],
      tujuan: d.research_objectives.length ? [daftar(d.research_objectives)] : [],
    };

    let ditambah = 0;
    let prevEnd: number | null = null;
    for (const k of ['latar', 'rumusan', 'tujuan'] as const) {
      if (!isi[k].length) continue;
      const doc = editor.state.doc;
      const bab1 = babRanges(doc)[0];
      if (!bab1) return toast.show('Bab 1 belum ada di naskah. Tambahkan bab terlebih dahulu.', 'bad');
      // Cari subbab di Bab 1.
      let head: { pos: number; size: number } | null = null;
      let end = bab1.to;
      doc.nodesBetween(bab1.from, bab1.to, (node, pos) => {
        if (pos < bab1.from) return false;
        if (node.type.name === 'heading' && Number(node.attrs.level) === 2) {
          if (head && end === bab1.to) end = pos;
          else if (!head && SUBBAB[k].cari.test(node.textContent.trim())) head = { pos, size: node.nodeSize };
        }
        return false;
      });
      if (head) {
        const h = head as { pos: number; size: number };
        // Ganti paragraf kosong bawaan kerangka, bila subbab masih kosong.
        let kosong = true;
        doc.nodesBetween(h.pos + h.size, end, (node, pos) => {
          if (pos < h.pos + h.size) return false;
          if (!(node.type.name === 'paragraph' && !node.textContent.trim() && node.childCount === 0)) kosong = false;
          return false;
        });
        const range = kosong && end > h.pos + h.size ? { from: h.pos + h.size, to: end } : end;
        if (!editor.chain().insertContentAt(range, isi[k]).run()) return toast.show('Gagal menyisipkan draf.', 'bad');
        prevEnd = null;
      } else {
        // Subbab belum ada: buat setelah subbab sebelumnya atau di awal Bab 1.
        const babHead = doc.nodeAt(bab1.from);
        const at = prevEnd ?? bab1.from + (babHead?.nodeSize ?? 0);
        const blok = [{ type: 'heading', attrs: { level: 2, bernomor: true, textAlign: 'left' }, content: [{ type: 'text', text: SUBBAB[k].judul }] }, ...isi[k]];
        if (!editor.chain().insertContentAt(at, blok).run()) return toast.show('Gagal menyisipkan draf.', 'bad');
      }
      ditambah++;
      // Posisi akhir subbab ini untuk subbab berikutnya yang belum ada.
      const nd = editor.state.doc;
      const b1 = babRanges(nd)[0];
      let after: number | null = null;
      let found = false;
      nd.nodesBetween(b1.from, b1.to, (node, pos) => {
        if (pos < b1.from) return false;
        if (node.type.name === 'heading' && Number(node.attrs.level) === 2) {
          if (found && after === null) after = pos;
          if (SUBBAB[k].cari.test(node.textContent.trim())) found = true;
        }
        return false;
      });
      prevEnd = after ?? b1.to;
    }
    if (!ditambah) return;

    setInserting(true);
    try {
      await flush();
      try {
        await rpc('buat_versi_naskah', { p_thesis: thesisId, p_catatan: 'Draf awal dari Pandu latar belakang AISYS' });
      } catch {
        /* versi bersifat pelengkap */
      }
      await kirim({ aksi: 'selesai' });
      toast.show('Draf disisipkan ke Bab 1 dan versi naskah disimpan', 'ok');
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setInserting(false);
    }
  };

  return (
    <div className="stack-sm">
      <article className="pd-draf">
        <div className="pd-draf-head">Latar Belakang</div>
        {d.paragraf.map((p, i) => (
          <p key={i}>{render(p)}</p>
        ))}
        {d.problem_statement && (
          <>
            <div className="pd-draf-head">Problem Statement</div>
            <p>{render(d.problem_statement)}</p>
          </>
        )}
        {d.research_questions.length > 0 && (
          <>
            <div className="pd-draf-head">Research Question</div>
            <ol>
              {d.research_questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
          </>
        )}
        {d.research_objectives.length > 0 && (
          <>
            <div className="pd-draf-head">Research Objective</div>
            <ol>
              {d.research_objectives.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
          </>
        )}
      </article>
      <p className="muted small" style={{ margin: 0 }}>
        Sitasi hanya dari literatur yang Anda pilih. Penanda [data perlu dicari oleh mahasiswa] dan [perlu rujukan] menunjukkan bagian yang harus Anda lengkapi.
      </p>
      <div className="nk-ai-row">
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="primary" loading={inserting} disabled={busy || inserting} onClick={sisipkan}>
          Sisipkan ke Bab 1
        </Button>
      </div>
      <div className="stack-xs">
        <div className="small strong">Minta revisi</div>
        <textarea rows={3} value={catatan} maxLength={2000} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. paragraf kedua terlalu umum, tekankan masalah pencatatan manual" />
        <div className="nk-ai-row">
          <span style={{ flex: 1 }} />
          <Button size="sm" disabled={busy || catatan.trim().length < 3} loading={busy} onClick={() => kirim({ pilihan: 'D', teks: catatan.trim() })}>
            Revisi draf
          </Button>
        </div>
      </div>
    </div>
  );
}
