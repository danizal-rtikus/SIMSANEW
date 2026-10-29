import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useAsync } from '../../lib/useAsync';
import { must, supabase, translateError } from '../../lib/supabase';
import { getMyThesis, getMyTitleSubmissions, rpc } from '../../lib/queries';
import { fmtDate, fmtDateTime, splitKeywords } from '../../lib/format';
import { DRAFT_TYPES, openFile, validateDraft } from '../../lib/files';
import type { Thesis, TitleSubmission } from '../../lib/types';
import { Button, ErrorNote, Field, Loading, PageHeader, Panel } from '../../components/ui';
import { TitleBadge } from '../../components/StatusBits';
import { Modal, useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';

interface Similar {
  sumber: string;
  id: string;
  judul: string;
  tahun: number;
  skor: number;
}

export function JudulMahasiswa() {
  const { userId } = useAuth();
  const st = useAsync(async () => {
    const [thesis, subs] = await Promise.all([getMyThesis(userId!), getMyTitleSubmissions(userId!)]);
    return { thesis, subs };
  }, [userId]);

  if (st.loading && !st.data) return <Loading variant="detail" />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const { thesis, subs } = st.data!;
  const pending = subs.some((s) => s.status === 'diajukan');

  return (
    <>
      <PageHeader
        title="Pendaftaran tugas akhir"
        description="Isi judul sementara dan unggah sinopsis. Ka. Prodi akan menerima pendaftaran Anda sekaligus menetapkan Pembimbing 1 dan Pembimbing 2. Judul masih boleh berubah selama proses bimbingan."
      />
      <div className="stack">
        {thesis && <CurrentTitle thesis={thesis} onChanged={st.reload} />}
        {!thesis && pending && <div className="note info">Pendaftaran Anda sedang diperiksa Ka. Prodi. Anda akan menerima notifikasi setelah ada keputusan.</div>}
        {!thesis && !pending && <RegisterForm userId={userId!} onDone={st.reload} />}
        <History subs={subs} />
      </div>
    </>
  );
}

function RegisterForm({ userId, onDone }: { userId: string; onDone: () => void }) {
  const dialog = useDialog();
  const toast = useToast();
  const [v, setV] = useState({ judul: '', bidang: '', kata_kunci: '', abstrak: '' });
  const [file, setFile] = useState<File | null>(null);
  const [similar, setSimilar] = useState<Similar[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    if (v.judul.trim().length < 5) return;
    try {
      setSimilar(await rpc<Similar[]>('cek_kemiripan_judul', { p_judul: v.judul.trim(), p_prodi: null, p_kecuali: null }));
    } catch {
      setSimilar([]);
    }
  };

  const submit = async () => {
    setErr(null);
    if (v.judul.trim().length < 10) return setErr('Judul minimal 10 karakter');
    if (!file) return setErr('Unggah berkas sinopsis');
    const bad = validateDraft(file);
    if (bad) return setErr(bad.replace('draf', 'sinopsis'));
    const ok = await dialog.confirm({
      title: 'Kirim pendaftaran tugas akhir?',
      message: 'Pendaftaran tidak dapat diubah sampai Ka. Prodi memberi keputusan.',
      confirmLabel: 'Kirim pendaftaran',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const path = `${userId}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, '-')}`;
      const up = await supabase.storage.from('pendaftaran').upload(path, file, { contentType: file.type || undefined });
      if (up.error) throw new Error(translateError(up.error.message));
      await rpc('daftar_ta', {
        p_judul: v.judul.trim(),
        p_bidang: v.bidang.trim() || null,
        p_abstrak: v.abstrak.trim(),
        p_kata_kunci: splitKeywords(v.kata_kunci),
        p_sinopsis_path: path,
        p_sinopsis_nama: file.name,
      });
      toast.show('Pendaftaran terkirim', 'ok');
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Formulir pendaftaran" actions={<Button variant="primary" loading={busy} onClick={submit}>Kirim pendaftaran</Button>}>
      <div className="form-grid">
        <Field label="Judul (sementara)" className="full" hint="Judul boleh disempurnakan selama bimbingan">
          <textarea style={{ minHeight: 60 }} value={v.judul} onChange={(e) => setV({ ...v, judul: e.target.value })} onBlur={check} />
        </Field>
        {similar && similar.length > 0 && (
          <div className="note warn full">
            <div className="strong small">Judul yang mirip di prodi Anda</div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }} className="small">
              {similar.map((s) => (
                <li key={s.id}>
                  {s.judul} <span className="muted">({s.tahun}, kemiripan {(s.skor * 100).toFixed(0)}%)</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Field label="Bidang kajian">
          <input value={v.bidang} onChange={(e) => setV({ ...v, bidang: e.target.value })} placeholder="mis. Sistem Informasi" />
        </Field>
        <Field label="Kata kunci" hint="Pisahkan dengan koma">
          <input value={v.kata_kunci} onChange={(e) => setV({ ...v, kata_kunci: e.target.value })} />
        </Field>
        <Field label="Ringkasan singkat" className="full" hint="Latar belakang, masalah, dan rencana metode dalam beberapa kalimat">
          <textarea value={v.abstrak} onChange={(e) => setV({ ...v, abstrak: e.target.value })} />
        </Field>
        <Field label="Berkas sinopsis" className="full" hint="PDF, DOC, atau DOCX, maksimal 20 MB">
          <input type="file" accept={DRAFT_TYPES} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
      </div>
      {err && <div className="note bad" style={{ marginTop: 12 }}>{err}</div>}
    </Panel>
  );
}

function CurrentTitle({ thesis, onChanged }: { thesis: Thesis; onChanged: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [judul, setJudul] = useState(thesis.judul);
  const [alasan, setAlasan] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hist = useAsync(
    async () =>
      (await must(supabase.from('thesis_title_history').select('*').eq('thesis_id', thesis.id).order('created_at', { ascending: false }))) as {
        id: number;
        judul_lama: string;
        judul_baru: string;
        alasan: string | null;
        created_at: string;
      }[],
    [thesis.id, thesis.judul],
  );

  const save = async () => {
    setErr(null);
    setBusy(true);
    try {
      await rpc('ubah_judul', { p_thesis: thesis.id, p_judul: judul.trim(), p_alasan: alasan.trim() });
      toast.show('Judul diperbarui', 'ok');
      setOpen(false);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Judul tugas akhir"
      sub="Pendaftaran Anda sudah diterima"
      actions={
        <>
          {thesis.sinopsis_path && (
            <Button size="sm" variant="ghost" onClick={() => openFile('pendaftaran', thesis.sinopsis_path!).catch((e) => toast.show(e.message, 'bad'))}>
              Lihat sinopsis
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => {
              setJudul(thesis.judul);
              setAlasan('');
              setErr(null);
              setOpen(true);
            }}
          >
            Ubah judul
          </Button>
        </>
      }
    >
      <div className="strong" style={{ fontSize: 17 }}>{thesis.judul}</div>
      {(hist.data ?? []).length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="label">Riwayat perubahan judul</div>
          <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {hist.data!.map((h) => (
              <li key={h.id}>
                <span className="muted">{fmtDateTime(h.created_at)}:</span> {h.judul_lama} <span className="muted">menjadi</span> {h.judul_baru}
                {h.alasan && <span className="muted">. {h.alasan}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Ubah judul"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button variant="primary" loading={busy} onClick={save}>
              Simpan judul
            </Button>
          </>
        }
      >
        <div className="stack-sm">
          <Field label="Judul baru">
            <textarea style={{ minHeight: 70 }} value={judul} onChange={(e) => setJudul(e.target.value)} />
          </Field>
          <Field label="Alasan perubahan" hint="Pembimbing akan menerima pemberitahuan">
            <input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. Masukan dari Pembimbing 1" />
          </Field>
          {err && <div className="note bad">{err}</div>}
        </div>
      </Modal>
    </Panel>
  );
}

function History({ subs }: { subs: TitleSubmission[] }) {
  const toast = useToast();
  if (subs.length === 0) return null;
  return (
    <Panel title="Riwayat pendaftaran" flush>
      <ul className="list">
        {subs.map((s) => (
          <li key={s.id} className="row-between" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div className="strong">{s.judul}</div>
              <div className="muted small">Dikirim {fmtDate(s.created_at)}</div>
              {s.catatan_kaprodi && <div className="small" style={{ marginTop: 4 }}>Catatan Ka. Prodi: {s.catatan_kaprodi}</div>}
              {s.sinopsis_path && (
                <button className="btn-link small" onClick={() => openFile('pendaftaran', s.sinopsis_path!).catch((e) => toast.show(e.message, 'bad'))}>
                  {s.sinopsis_nama || 'Sinopsis'}
                </button>
              )}
            </div>
            <TitleBadge s={s.status} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
