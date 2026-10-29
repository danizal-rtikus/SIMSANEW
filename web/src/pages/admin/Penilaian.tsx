import { useEffect, useState } from 'react';
import { useAsync } from '../../lib/useAsync';
import { must, supabase } from '../../lib/supabase';
import { EXAM_LABEL } from '../../lib/labels';
import type { AssessmentItem, ExamKind, GradeRow } from '../../lib/types';
import { Badge, Button, ErrorNote, Field, Loading, Panel, Tabs } from '../../components/ui';
import { Modal, useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';

const KINDS: ExamKind[] = ['sempro', 'semhas', 'pendadaran', 'd3'];

/** Form penilaian ujian: komponen dan bobot per jenis ujian. Nilai tiap dosen = rata-rata berbobot komponen. */
export function AssessmentTab() {
  const [jenis, setJenis] = useState<ExamKind>('sempro');
  const [edit, setEdit] = useState<Partial<AssessmentItem> | null>(null);
  const dialog = useDialog();
  const toast = useToast();
  const st = useAsync(async () => (await must(supabase.from('assessment_items').select('*').order('jenis').order('urutan'))) as AssessmentItem[], []);
  if (st.loading && !st.data) return <Loading variant="table" />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const rows = (st.data ?? []).filter((r) => r.jenis === jenis);
  const total = rows.filter((r) => r.aktif).reduce((a, r) => a + Number(r.bobot), 0);

  const remove = async (r: AssessmentItem) => {
    const ok = await dialog.confirm({
      title: 'Hapus komponen?',
      message: `"${r.nama}" dihapus dari form ${EXAM_LABEL[r.jenis]}. Komponen yang sudah dipakai menilai tidak dapat dihapus; nonaktifkan saja.`,
      confirmLabel: 'Hapus komponen',
      danger: true,
    });
    if (!ok) return;
    try {
      await must(supabase.from('assessment_items').delete().eq('id', r.id));
      toast.show('Komponen dihapus', 'ok');
      st.reload();
    } catch {
      toast.show('Komponen sudah dipakai pada nilai ujian. Nonaktifkan agar tidak muncul di form berikutnya.', 'bad');
    }
  };

  const toggle = async (r: AssessmentItem) => {
    try {
      await must(supabase.from('assessment_items').update({ aktif: !r.aktif }).eq('id', r.id));
      st.reload();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };

  return (
    <>
      <Tabs<ExamKind> value={jenis} onChange={setJenis} items={KINDS.map((k) => ({ value: k, label: EXAM_LABEL[k] }))} />
      <Panel
        title={`Form penilaian ${EXAM_LABEL[jenis]}`}
        sub="Setiap dosen panel mengisi skor 40 sampai 100 untuk tiap komponen aktif. Nilai dosen adalah rata-rata berbobot; nilai akhir adalah rata-rata nilai seluruh dosen panel."
        actions={
          <Button variant="primary" onClick={() => setEdit({ jenis, urutan: (rows.length ? rows[rows.length - 1].urutan : 0) + 1, bobot: 25, aktif: true })}>
            Tambah komponen
          </Button>
        }
        flush
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="num">No</th>
                <th>Komponen</th>
                <th className="num">Bobot</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted small">
                    Belum ada komponen. Ujian jenis ini tidak dapat dinilai sebelum komponen ditambahkan.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} style={r.aktif ? undefined : { opacity: 0.6 }}>
                  <td className="num">{r.urutan}</td>
                  <td>
                    <div className="strong">{r.nama}</div>
                    {r.keterangan && <div className="muted small">{r.keterangan}</div>}
                  </td>
                  <td className="num mono-num">
                    {Number(r.bobot)}
                    {r.aktif && total > 0 && <div className="muted small">{((Number(r.bobot) / total) * 100).toFixed(0)}%</div>}
                  </td>
                  <td>{r.aktif ? <Badge tone="ok">Aktif</Badge> : <Badge>Nonaktif</Badge>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>
                      Ubah
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggle(r)}>
                      {r.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(r)}>
                      Hapus
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <ItemModal value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); st.reload(); }} />
    </>
  );
}

function ItemModal({ value, onClose, onSaved }: { value: Partial<AssessmentItem> | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Partial<AssessmentItem>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (value) {
      setV(value);
      setErr(null);
    }
  }, [value]);
  const save = async () => {
    if (!v.nama?.trim()) return setErr('Nama komponen wajib diisi');
    if (!(Number(v.bobot) > 0)) return setErr('Bobot harus lebih dari 0');
    setBusy(true);
    try {
      const row = {
        jenis: v.jenis,
        urutan: Number(v.urutan ?? 1),
        nama: v.nama.trim(),
        keterangan: v.keterangan?.trim() || null,
        bobot: Number(v.bobot),
        aktif: v.aktif ?? true,
      };
      if (v.id) await must(supabase.from('assessment_items').update(row).eq('id', v.id));
      else await must(supabase.from('assessment_items').insert(row));
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!value}
      onClose={onClose}
      title={v.id ? 'Ubah komponen penilaian' : 'Tambah komponen penilaian'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Simpan komponen
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Nama komponen" className="full">
          <input value={v.nama ?? ''} onChange={(e) => setV({ ...v, nama: e.target.value })} placeholder="Penguasaan materi" />
        </Field>
        <Field label="Keterangan (opsional)" className="full">
          <textarea style={{ minHeight: 56 }} value={v.keterangan ?? ''} onChange={(e) => setV({ ...v, keterangan: e.target.value })} />
        </Field>
        <Field label="Urutan">
          <input type="number" min={1} value={String(v.urutan ?? '')} onChange={(e) => setV({ ...v, urutan: Number(e.target.value) })} />
        </Field>
        <Field label="Bobot" hint="Bobot relatif; tidak harus berjumlah 100">
          <input type="number" min={0.5} step={0.5} value={String(v.bobot ?? '')} onChange={(e) => setV({ ...v, bobot: Number(e.target.value) })} />
        </Field>
      </div>
      {err && <div className="note bad" style={{ marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}

/** Konversi nilai angka (40–100) ke huruf mutu. */
export function GradeTab() {
  const [edit, setEdit] = useState<Partial<GradeRow> | null>(null);
  const dialog = useDialog();
  const toast = useToast();
  const st = useAsync(async () => (await must(supabase.from('grade_scale').select('*').order('nilai_min', { ascending: false }))) as GradeRow[], []);
  if (st.loading && !st.data) return <Loading variant="table" />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const rows = st.data ?? [];

  const remove = async (r: GradeRow) => {
    const ok = await dialog.confirm({ title: `Hapus huruf ${r.huruf}?`, message: 'Nilai ujian yang sudah diputuskan tidak berubah.', confirmLabel: 'Hapus', danger: true });
    if (!ok) return;
    try {
      await must(supabase.from('grade_scale').delete().eq('id', r.id));
      st.reload();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };

  return (
    <>
      <Panel
        title="Konversi nilai"
        sub="Huruf mutu diambil dari baris dengan nilai minimum tertinggi yang tidak melebihi nilai akhir. Konversi berlaku untuk keputusan ujian berikutnya."
        actions={<Button variant="primary" onClick={() => setEdit({})}>Tambah huruf</Button>}
        flush
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Huruf</th>
                <th className="num">Nilai minimum</th>
                <th>Rentang</th>
                <th className="num">Angka mutu</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="strong">{r.huruf}</td>
                  <td className="num mono-num">{Number(r.nilai_min)}</td>
                  <td className="small mono-num">
                    {Number(r.nilai_min)} sampai {i === 0 ? '100' : `< ${Number(rows[i - 1].nilai_min)}`}
                  </td>
                  <td className="num mono-num">{r.angka == null ? '—' : Number(r.angka).toFixed(2)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>
                      Ubah
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(r)}>
                      Hapus
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <GradeModal value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); st.reload(); }} />
    </>
  );
}

function GradeModal({ value, onClose, onSaved }: { value: Partial<GradeRow> | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Partial<GradeRow>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (value) {
      setV(value);
      setErr(null);
    }
  }, [value]);
  const save = async () => {
    if (!v.huruf?.trim()) return setErr('Huruf wajib diisi');
    const min = Number(v.nilai_min);
    if (!(min >= 0 && min <= 100)) return setErr('Nilai minimum harus 0 sampai 100');
    setBusy(true);
    try {
      const row = { huruf: v.huruf.trim().toUpperCase(), nilai_min: min, angka: v.angka == null || String(v.angka) === '' ? null : Number(v.angka) };
      if (v.id) await must(supabase.from('grade_scale').update(row).eq('id', v.id));
      else await must(supabase.from('grade_scale').insert(row));
      onSaved();
    } catch (e) {
      const m = (e as Error).message;
      setErr(m.includes('duplicate') ? 'Huruf ini sudah ada' : m);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!value}
      onClose={onClose}
      title={v.id ? `Ubah huruf ${value?.huruf ?? ''}` : 'Tambah huruf mutu'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Huruf">
          <input value={v.huruf ?? ''} onChange={(e) => setV({ ...v, huruf: e.target.value })} placeholder="B+" />
        </Field>
        <Field label="Nilai minimum">
          <input type="number" min={0} max={100} step={0.01} value={v.nilai_min == null ? '' : String(v.nilai_min)} onChange={(e) => setV({ ...v, nilai_min: e.target.value === '' ? undefined : Number(e.target.value) })} />
        </Field>
        <Field label="Angka mutu (opsional)">
          <input type="number" min={0} max={4} step={0.01} value={v.angka == null ? '' : String(v.angka)} onChange={(e) => setV({ ...v, angka: e.target.value === '' ? null : Number(e.target.value) })} />
        </Field>
      </div>
      {err && <div className="note bad" style={{ marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}
