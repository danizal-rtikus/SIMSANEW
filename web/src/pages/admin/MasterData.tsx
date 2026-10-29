import { useEffect, useState } from 'react';
import { useAsync } from '../../lib/useAsync';
import { must, supabase } from '../../lib/supabase';
import { loadProdi } from '../../lib/master';
import { fmtDate } from '../../lib/format';
import type { Prodi } from '../../lib/types';
import { Badge, Button, ErrorNote, Field, Loading, PageHeader, Panel, Tabs } from '../../components/ui';
import { Modal, useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import { TemplateEditor } from '../kaprodi/Pengaturan';
import { useQueryState } from '../../lib/shell';
import { AssessmentTab, GradeTab } from './Penilaian';

type Tab = 'prodi' | 'tahun' | 'template' | 'penilaian' | 'konversi';

export function MasterData() {
  const [tab, setTab] = useQueryState<Tab>('tab', 'prodi');
  return (
    <>
      <PageHeader title="Master data" description="Program studi, tahun akademik, template milestone, form penilaian ujian, dan konversi nilai." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'prodi', label: 'Program studi' },
          { value: 'tahun', label: 'Tahun akademik' },
          { value: 'template', label: 'Template milestone' },
          { value: 'penilaian', label: 'Form penilaian' },
          { value: 'konversi', label: 'Konversi nilai' },
        ]}
      />
      {tab === 'prodi' && <ProdiTab />}
      {tab === 'tahun' && <YearTab />}
      {tab === 'penilaian' && <AssessmentTab />}
      {tab === 'konversi' && <GradeTab />}
      {tab === 'template' && (
        <div className="stack">
          <TemplateEditor prodiId={null} jenjang="S1" canManage />
          <TemplateEditor prodiId={null} jenjang="D3" canManage />
        </div>
      )}
    </>
  );
}

function ProdiTab() {
  const st = useAsync(async () => (await must(supabase.from('prodi').select('*').order('jenjang').order('nama'))) as Prodi[], []);
  const [edit, setEdit] = useState<Partial<Prodi> | null>(null);
  if (st.loading && !st.data) return <Loading variant="table" />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  return (
    <>
      <Panel title="Program studi" actions={<Button variant="primary" onClick={() => setEdit({ jenjang: 'S1', min_bimbingan: 8, kuota_bimbingan_default: 10 })}>Tambah prodi</Button>} flush>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama</th>
                <th>Jenjang</th>
                <th>Fakultas</th>
                <th className="num">Min. bimbingan</th>
                <th className="num">Kuota dosen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(st.data ?? []).map((p) => (
                <tr key={p.id}>
                  <td className="strong">{p.kode}</td>
                  <td>{p.nama}</td>
                  <td>
                    <Badge>{p.jenjang}</Badge>
                  </td>
                  <td className="small">{p.fakultas ?? '—'}</td>
                  <td className="num">{p.min_bimbingan}</td>
                  <td className="num">{p.kuota_bimbingan_default}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>
                      Ubah
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <ProdiModal value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); loadProdi(true); st.reload(); }} />
    </>
  );
}

function ProdiModal({ value, onClose, onSaved }: { value: Partial<Prodi> | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Partial<Prodi>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (value) {
      setV(value);
      setErr(null);
    }
  }, [value]);
  const save = async () => {
    if (!v.kode?.trim() || !v.nama?.trim()) return setErr('Kode dan nama wajib diisi');
    setBusy(true);
    try {
      const row = {
        kode: v.kode.trim().toUpperCase(),
        nama: v.nama.trim(),
        jenjang: v.jenjang,
        fakultas: v.fakultas?.trim() || null,
        min_bimbingan: Number(v.min_bimbingan ?? 8),
        kuota_bimbingan_default: Number(v.kuota_bimbingan_default ?? 10),
      };
      if (v.id) await must(supabase.from('prodi').update(row).eq('id', v.id));
      else await must(supabase.from('prodi').insert(row));
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
      title={v.id ? 'Ubah program studi' : 'Tambah program studi'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Simpan prodi
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Kode">
          <input value={v.kode ?? ''} onChange={(e) => setV({ ...v, kode: e.target.value })} placeholder="TI" />
        </Field>
        <Field label="Jenjang" hint={v.id ? 'Mengubah jenjang tidak mengubah milestone mahasiswa yang sudah berjalan' : undefined}>
          <select value={v.jenjang ?? 'S1'} onChange={(e) => setV({ ...v, jenjang: e.target.value as Prodi['jenjang'] })}>
            <option value="S1">S1 (Skripsi)</option>
            <option value="D3">D3 (Tugas Akhir)</option>
          </select>
        </Field>
        <Field label="Nama program studi" className="full">
          <input value={v.nama ?? ''} onChange={(e) => setV({ ...v, nama: e.target.value })} />
        </Field>
        <Field label="Fakultas" className="full">
          <input value={v.fakultas ?? ''} onChange={(e) => setV({ ...v, fakultas: e.target.value })} />
        </Field>
        <Field label="Minimal bimbingan">
          <input type="number" min={0} value={String(v.min_bimbingan ?? '')} onChange={(e) => setV({ ...v, min_bimbingan: Number(e.target.value) })} />
        </Field>
        <Field label="Kuota bimbingan per dosen">
          <input type="number" min={0} value={String(v.kuota_bimbingan_default ?? '')} onChange={(e) => setV({ ...v, kuota_bimbingan_default: Number(e.target.value) })} />
        </Field>
      </div>
      {err && <div className="note bad" style={{ marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}

interface Year {
  id: string;
  nama: string;
  mulai: string;
  selesai: string;
  aktif: boolean;
}

function YearTab() {
  const dialog = useDialog();
  const toast = useToast();
  const st = useAsync(async () => (await must(supabase.from('academic_years').select('*').order('mulai', { ascending: false }))) as Year[], []);
  const [edit, setEdit] = useState<Partial<Year> | null>(null);

  const activate = async (y: Year) => {
    const ok = await dialog.confirm({ title: `Jadikan ${y.nama} tahun akademik aktif?`, message: 'Studi akhir yang disetujui setelah ini tercatat pada tahun akademik tersebut.', confirmLabel: 'Jadikan aktif' });
    if (!ok) return;
    try {
      await must(supabase.from('academic_years').update({ aktif: false }).eq('aktif', true));
      await must(supabase.from('academic_years').update({ aktif: true }).eq('id', y.id));
      toast.show(`${y.nama} aktif`, 'ok');
      st.reload();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };

  if (st.loading && !st.data) return <Loading variant="table" />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  return (
    <>
      <Panel title="Tahun akademik" actions={<Button variant="primary" onClick={() => setEdit({})}>Tambah tahun akademik</Button>} flush>
        <table className="table">
          <thead>
            <tr>
              <th>Nama</th>
              <th>Periode</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(st.data ?? []).map((y) => (
              <tr key={y.id}>
                <td className="strong">{y.nama}</td>
                <td className="small">
                  {fmtDate(y.mulai)} sampai {fmtDate(y.selesai)}
                </td>
                <td>{y.aktif ? <Badge tone="ok">Aktif</Badge> : <span className="muted small">—</span>}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {!y.aktif && (
                    <Button size="sm" variant="ghost" onClick={() => activate(y)}>
                      Jadikan aktif
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setEdit(y)}>
                    Ubah
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <YearModal value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); st.reload(); }} />
    </>
  );
}

function YearModal({ value, onClose, onSaved }: { value: Partial<Year> | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Partial<Year>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (value) {
      setV(value);
      setErr(null);
    }
  }, [value]);
  const save = async () => {
    if (!v.nama?.trim() || !v.mulai || !v.selesai) return setErr('Nama dan periode wajib diisi');
    if (v.selesai <= v.mulai) return setErr('Tanggal selesai harus setelah tanggal mulai');
    setBusy(true);
    try {
      const row = { nama: v.nama.trim(), mulai: v.mulai, selesai: v.selesai };
      if (v.id) await must(supabase.from('academic_years').update(row).eq('id', v.id));
      else await must(supabase.from('academic_years').insert(row));
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
      title={v.id ? 'Ubah tahun akademik' : 'Tambah tahun akademik'}
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
        <Field label="Nama" className="full">
          <input value={v.nama ?? ''} onChange={(e) => setV({ ...v, nama: e.target.value })} placeholder="2026/2027 Genap" />
        </Field>
        <Field label="Mulai">
          <input type="date" value={v.mulai ?? ''} onChange={(e) => setV({ ...v, mulai: e.target.value })} />
        </Field>
        <Field label="Selesai">
          <input type="date" value={v.selesai ?? ''} onChange={(e) => setV({ ...v, selesai: e.target.value })} />
        </Field>
      </div>
      {err && <div className="note bad" style={{ marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}
