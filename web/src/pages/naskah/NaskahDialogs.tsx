import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Editor } from '@tiptap/react';
import { supabase } from '../../lib/supabase';
import { rpc } from '../../lib/queries';
import { fmtDateTime } from '../../lib/format';
import { chapters, roman, type PmNode } from '../../lib/naskah/struktur';
import { chapterRange } from '../../lib/naskah/anchor';
import { babState, type ReviewData } from '../../lib/naskah/review';
import type { ImportResult } from '../../lib/naskah/importDocx';
import { Badge, Button, Field } from '../../components/ui';
import { Modal, useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';

/* ------------------------------------------------------------------ */
/* Ajukan bab                                                          */
/* ------------------------------------------------------------------ */

export function AjukanBabModal({
  open,
  onClose,
  doc,
  data,
  thesisId,
  flush,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  doc: PmNode;
  data: ReviewData | null;
  thesisId: string;
  flush: () => Promise<void>;
  onDone: () => void;
}) {
  const toast = useToast();
  const dialog = useDialog();
  const list = chapters(doc);
  const [bab, setBab] = useState<number | null>(null);
  const [catatan, setCatatan] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setCatatan('');
      const firstOpen = list.find((c) => {
        const s = data ? babState(data, c.bab) : null;
        return !s?.latest || s.latest.status === 'revisi' || (s.latest.status === 'diajukan' && s.tone === 'warn');
      });
      setBab(firstOpen?.bab ?? list[0]?.bab ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    if (!bab) return;
    setBusy(true);
    try {
      await flush();
      await rpc('ajukan_bab', { p_thesis: thesisId, p_bab: bab, p_catatan: catatan.trim() || null });
      toast.show(`Bab ${bab} diajukan. Pembimbing 1 dan 2 menerima notifikasi.`, 'ok');
      onDone();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const tarik = async (id: string, n: number) => {
    const ok = await dialog.confirm({ title: `Tarik pengajuan Bab ${n}?`, message: 'Pengajuan yang belum ditinjau dapat ditarik, lalu diajukan lagi setelah diperbaiki.', confirmLabel: 'Tarik pengajuan' });
    if (!ok) return;
    try {
      await rpc('tarik_pengajuan_bab', { p_id: id });
      toast.show('Pengajuan ditarik', 'ok');
      onDone();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Ajukan bab untuk review"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" loading={busy} disabled={!bab} onClick={submit}>
            Ajukan Bab {bab ?? ''}
          </Button>
        </>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Isi bab saat ini dibekukan sebagai pengajuan. Anda tetap bisa melanjutkan menulis; perubahan berikutnya terlihat dosen sebagai Track Changes pada pengajuan berikutnya.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th />
              <th>Bab</th>
              <th className="num">Kata</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const s = data ? babState(data, c.bab) : null;
              const adaRevisi = !!s?.latest && !!data?.reviews.some((r) => r.submission_id === s.latest!.id && r.hasil === 'revisi');
              const blocked = s?.latest && (s.latest.status === 'acc' || (s.latest.status === 'diajukan' && !adaRevisi));
              const reviewed = s?.latest && data?.reviews.some((r) => r.submission_id === s.latest!.id);
              return (
                <tr key={c.bab} className={blocked ? '' : 'clickable'} onClick={() => !blocked && setBab(c.bab)}>
                  <td style={{ width: 32 }}>
                    <input type="radio" name="bab" disabled={!!blocked} checked={bab === c.bab} onChange={() => setBab(c.bab)} aria-label={`Pilih Bab ${c.bab}`} />
                  </td>
                  <td>
                    <span className="strong">BAB {roman(c.bab)}</span> {c.judul}
                  </td>
                  <td className="num mono-num">{c.kata.toLocaleString('id-ID')}</td>
                  <td>
                    <Badge tone={s?.tone ?? 'neutral'}>{s?.label ?? 'Belum diajukan'}</Badge>
                    {s?.latest && <div className="muted small">{fmtDateTime(s.latest.created_at)}</div>}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {s?.latest && (
                      <Link className="link-btn small" to={`/naskah/${thesisId}/ajuan/${s.latest.id}`} onClick={(e) => e.stopPropagation()}>
                        Lihat
                      </Link>
                    )}
                    {s?.latest?.status === 'diajukan' && !reviewed && (
                      <button
                        type="button"
                        className="link-btn small"
                        style={{ marginLeft: 10 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          tarik(s.latest!.id, c.bab);
                        }}
                      >
                        Tarik
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.length === 0 && <p className="muted">Belum ada bab bernomor di naskah.</p>}
      <Field label="Catatan untuk pembimbing (opsional)" className="full">
        <textarea style={{ minHeight: 60 }} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Mis. bagian yang ingin dikonsultasikan, atau ringkasan perbaikan dari revisi sebelumnya" />
      </Field>
    </Modal>
  );
}

/** Ambil satu bab bernomor dari hasil impor; bila tidak ada judul bab, ambil semua isi. */
function singleChapter(content: PmNode[], bab: number): PmNode[] {
  const c = chapters({ type: 'doc', content }).find((x) => x.bab === bab) ?? chapters({ type: 'doc', content })[0];
  return c ? content.slice(c.start, c.end) : content;
}

/* ------------------------------------------------------------------ */
/* Impor dari Word                                                     */
/* ------------------------------------------------------------------ */

type Target = 'semua' | 'baru' | `bab-${number}`;

export function ImportWordModal({ open, onClose, editor, thesisId, draftLink }: { open: boolean; onClose: () => void; editor: Editor; thesisId: string; draftLink: string }) {
  const toast = useToast();
  const dialog = useDialog();
  const [file, setFile] = useState<File | null>(null);
  const [abaikanAwal, setAbaikanAwal] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>('semua');
  const [busy, setBusy] = useState<string | null>(null);
  const [srcBab, setSrcBab] = useState(1);
  const list = chapters(editor.getJSON() as PmNode);
  const srcList = result ? chapters(result.doc) : [];

  useEffect(() => {
    if (open) {
      setFile(null);
      setResult(null);
      setErr(null);
      setTarget('semua');
      setSrcBab(1);
    }
  }, [open]);

  useEffect(() => {
    if (!file) return;
    let alive = true;
    setBusy('Membaca file Word');
    setErr(null);
    (async () => {
      try {
        const { importDocx } = await import('../../lib/naskah/importDocx');
        const r = await importDocx(await file.arrayBuffer(), { abaikanAwal });
        if (alive) setResult(r);
      } catch (e) {
        if (alive) {
          setResult(null);
          setErr((e as Error).message);
        }
      } finally {
        if (alive) setBusy(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [file, abaikanAwal]);

  const apply = async () => {
    if (!result) return;
    const babNo = target.startsWith('bab-') ? Number(target.slice(4)) : null;
    const ok = await dialog.confirm({
      title: target === 'semua' ? 'Ganti seluruh naskah?' : target === 'baru' ? 'Tambahkan sebagai bab baru?' : `Ganti isi Bab ${babNo}?`,
      message:
        target === 'baru'
          ? 'Isi file Word ditambahkan sebagai bab baru sebelum Daftar Pustaka.'
          : 'Isi yang ada akan diganti dengan isi file Word. Versi sebelumnya tetap dapat dilihat di Riwayat versi bila sudah disimpan. Komentar dosen pada teks yang tidak berubah tetap menempel; pada teks yang berubah ditandai "teks sudah berubah".',
      confirmLabel: 'Masukkan ke naskah',
      danger: target !== 'baru',
    });
    if (!ok) return;
    try {
      // Unggah gambar lebih dulu
      const paths = new Map<string, string>();
      for (let i = 0; i < result.images.length; i++) {
        const im = result.images[i];
        setBusy(`Mengunggah gambar ${i + 1} dari ${result.images.length}`);
        const ext = im.contentType === 'image/jpeg' ? 'jpg' : im.contentType.split('/')[1];
        const path = `${thesisId}/${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage.from('naskah').upload(path, new Blob([im.data as unknown as BlobPart], { type: im.contentType }), { contentType: im.contentType });
        if (up.error) throw new Error(`Gagal mengunggah gambar: ${up.error.message}`);
        paths.set(im.key, path);
      }
      setBusy('Memasukkan ke naskah');
      const fix = (n: PmNode): PmNode => {
        if (n.type === 'image' && typeof n.attrs?.path === 'string' && n.attrs.path.startsWith('pending:')) {
          const p = paths.get(n.attrs.path.slice(8));
          return p ? { ...n, attrs: { ...n.attrs, path: p } } : { type: 'paragraph', content: [{ type: 'text', text: '[Gambar tidak terunggah]' }] };
        }
        return n.content ? { ...n, content: n.content.map(fix) } : n;
      };
      const content = (result.doc.content ?? []).map(fix);
      const doc = editor.state.doc;
      if (target === 'semua') {
        editor.chain().focus().setContent({ type: 'doc', content }, true).run();
      } else if (target === 'baru') {
        let at = doc.content.size;
        let found = false;
        doc.forEach((node, offset) => {
          if (!found && node.type.name === 'heading' && node.attrs.level === 1 && node.attrs.bernomor === false) {
            at = offset;
            found = true;
          }
        });
        const one = singleChapter(content, srcBab);
        const body = one[0]?.type === 'heading' && one[0].attrs?.level === 1 ? one : [{ type: 'heading', attrs: { level: 1, bernomor: true, textAlign: 'center' }, content: [{ type: 'text', text: 'JUDUL BAB' }] }, ...one];
        editor.chain().focus().insertContentAt(at, body).run();
      } else {
        const r = chapterRange(doc, babNo!);
        if (!r) throw new Error(`Bab ${babNo} tidak ditemukan`);
        const head = doc.nodeAt(r.from)!.toJSON() as PmNode;
        const one = singleChapter(content, srcBab);
        const firstIsBab = one[0]?.type === 'heading' && one[0].attrs?.level === 1;
        const body = firstIsBab ? one : [head, ...one];
        editor.chain().focus().insertContentAt({ from: r.from, to: r.to }, body).run();
      }
      toast.show('Isi file Word dimasukkan. Periksa judul bab, subbab, dan keterangan gambar/tabel.', 'ok');
      onClose();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };

  const s = result?.stats;
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Impor dari Word"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" disabled={!result || !!busy} loading={!!busy && !!result} onClick={apply}>
            Masukkan ke naskah
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <p className="muted small" style={{ margin: 0 }}>
          Judul bab, subbab, daftar, tabel, gambar, dan keterangan dibawa. Font, margin, dan spasi mengikuti pedoman saat ekspor. Catatan kaki, rumus Equation, dan kotak teks belum dapat dibawa. Lakukan impor sekali di awal, lalu lanjutkan menulis di SIMSA.
        </p>
        <Field label="File Word (.docx)">
          <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <label className="check small">
          <input type="checkbox" checked={abaikanAwal} onChange={(e) => setAbaikanAwal(e.target.checked)} /> Abaikan bagian sebelum BAB I (sampul, pengesahan, kata pengantar, daftar isi)
        </label>
        {busy && <div className="note">{busy}</div>}
        {err && <div className="note bad">{err}</div>}
        {result && s && (
          <div className="note">
            <div className="strong">Terbaca dari file</div>
            <div className="small">
              {s.bab} bab, {s.subbab} subbab, {s.paragraf} paragraf, {s.daftar} daftar, {s.tabel} tabel, {s.gambar} gambar.
            </div>
            {result.warnings.length > 0 && (
              <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {result.warnings.map((w) => (
                  <li key={w}>{w.charAt(0).toUpperCase() + w.slice(1)}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {result && (
          <Field label="Masukkan ke">
            <select value={target} onChange={(e) => setTarget(e.target.value as Target)}>
              <option value="semua">Seluruh naskah (ganti semua isi)</option>
              {list.map((c) => (
                <option key={c.bab} value={`bab-${c.bab}`}>
                  Ganti BAB {roman(c.bab)} {c.judul}
                </option>
              ))}
              <option value="baru">Tambahkan sebagai bab baru</option>
            </select>
          </Field>
        )}
        {result && target !== 'semua' && srcList.length > 1 && (
          <Field label="Bab dari file Word yang dimasukkan" hint={`File berisi ${srcList.length} bab; hanya satu bab yang dimasukkan ke tujuan ini.`}>
            <select value={srcBab} onChange={(e) => setSrcBab(Number(e.target.value))}>
              {srcList.map((c) => (
                <option key={c.bab} value={c.bab}>
                  BAB {roman(c.bab)} {c.judul}
                </option>
              ))}
            </select>
          </Field>
        )}
        <p className="muted small" style={{ margin: 0 }}>
          Ingin tetap memakai file Word apa adanya? <Link to={draftLink}>Unggah sebagai draf</Link>.
        </p>
      </div>
    </Modal>
  );
}
