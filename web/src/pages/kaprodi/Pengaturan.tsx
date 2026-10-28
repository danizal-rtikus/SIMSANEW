import { useEffect, useState, type ChangeEvent } from 'react';
import { useAuth } from '../../lib/auth';
import { useAsync } from '../../lib/useAsync';
import { must, supabase } from '../../lib/supabase';
import { loadProdi } from '../../lib/master';
import type { Jenjang, MilestoneKind, Prodi } from '../../lib/types';
import { Button, ErrorNote, Field, Loading, PageHeader, Panel } from '../../components/ui';
import { useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';

export function PengaturanProdi() {
  const { active } = useAuth();
  const prodiId = active!.prodi_id!;
  const st = useAsync(async () => (await must(supabase.from('prodi').select('*').eq('id', prodiId).single())) as Prodi, [prodiId]);
  if (st.loading && !st.data) return <Loading />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const prodi = st.data!;
  return (
    <>
      <PageHeader title="Pengaturan prodi" description={`${prodi.nama} (${prodi.jenjang}). Parameter ini dipakai untuk syarat ujian, indikator risiko, dan kuota bimbingan.`} />
      <div className="stack">
        <ParamsForm prodi={prodi} onSaved={st.reload} />
        <TemplateEditor prodiId={prodiId} jenjang={prodi.jenjang} canManage />
      </div>
    </>
  );
}

function ParamsForm({ prodi, onSaved }: { prodi: Prodi; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState(prodi);
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(prodi), [prodi]);
  const num = (k: keyof Prodi) => ({
    type: 'number',
    min: 0,
    value: String(v[k] ?? ''),
    onChange: (e: ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) }),
  });
  const save = async () => {
    setBusy(true);
    try {
      await must(
        supabase
          .from('prodi')
          .update({
            min_bimbingan: v.min_bimbingan,
            kuota_bimbingan_default: v.kuota_bimbingan_default,
            hari_tanpa_bimbingan_kuning: v.hari_tanpa_bimbingan_kuning,
            hari_tanpa_bimbingan_merah: v.hari_tanpa_bimbingan_merah,
            hari_terlambat_kuning: v.hari_terlambat_kuning,
            hari_terlambat_merah: v.hari_terlambat_merah,
          })
          .eq('id', prodi.id),
      );
      loadProdi(true);
      toast.show('Pengaturan disimpan', 'ok');
      onSaved();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Parameter" actions={<Button variant="primary" loading={busy} onClick={save}>Simpan parameter</Button>}>
      <div className="grid-3">
        <Field label="Minimal bimbingan sebelum ujian akhir" hint="Syarat otomatis Siap Pendadaran / Siap Komprehensif">
          <input {...num('min_bimbingan')} />
        </Field>
        <Field label="Kuota bimbingan per dosen" hint="Dipakai bila kuota dosen tidak diisi">
          <input {...num('kuota_bimbingan_default')} />
        </Field>
        <div />
        <Field label="Tanpa bimbingan: waspada (hari)">
          <input {...num('hari_tanpa_bimbingan_kuning')} />
        </Field>
        <Field label="Tanpa bimbingan: kritis (hari)">
          <input {...num('hari_tanpa_bimbingan_merah')} />
        </Field>
        <div />
        <Field label="Lewat tenggat: waspada (hari)">
          <input {...num('hari_terlambat_kuning')} />
        </Field>
        <Field label="Lewat tenggat: kritis (hari)">
          <input {...num('hari_terlambat_merah')} />
        </Field>
      </div>
    </Panel>
  );
}

interface TemplateRow {
  id: string;
  prodi_id: string | null;
  jenjang: Jenjang;
  urutan: number;
  kode: string;
  nama: string;
  bukti: string;
  jenis: MilestoneKind;
  bobot: number;
  durasi_hari: number;
  aktif: boolean;
}

const KIND_LABEL: Record<MilestoneKind, string> = {
  judul: 'Otomatis: pendaftaran diterima',
  pembimbing: 'Otomatis: P1 dan P2 ditetapkan',
  pembimbing_setuju: 'ACC Pembimbing 1 dan 2',
  ujian: 'Modul ujian (nilai panel)',
  revisi: 'ACC revisi seluruh panel',
  berkas: 'Verifikasi berkas oleh BAAK',
  yudisium: 'Rapat yudisium',
  sk: 'SK Ketua',
  seminar: 'Hasil seminar/ujian',
  syarat_otomatis: 'Syarat otomatis',
  penguji_setuju: 'Persetujuan penguji',
  arsip: 'Pengarsipan',
};

/** Editor template milestone. prodiId null = template default institusi (Admin). */
export function TemplateEditor({ prodiId, jenjang, canManage }: { prodiId: string | null; jenjang: Jenjang; canManage: boolean }) {
  const dialog = useDialog();
  const toast = useToast();
  const st = useAsync(async () => (await must(supabase.from('milestone_templates').select('*').eq('jenjang', jenjang).order('urutan'))) as TemplateRow[], [jenjang]);
  const [edits, setEdits] = useState<Record<string, Partial<TemplateRow>>>({});
  const [busy, setBusy] = useState(false);

  if (st.loading && !st.data) return <Loading />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const all = st.data ?? [];
  const own = all.filter((t) => t.prodi_id === prodiId);
  const defaults = all.filter((t) => t.prodi_id === null);
  const usingOwn = prodiId === null || own.length > 0;
  const rows = prodiId === null ? defaults : usingOwn ? own : defaults;
  const editable = canManage && usingOwn;
  const total = rows.reduce((s, r) => s + Number(edits[r.id]?.bobot ?? r.bobot), 0);

  const copy = async () => {
    const ok = await dialog.confirm({ title: 'Buat template khusus prodi?', message: 'Template institusi disalin untuk prodi ini lalu dapat Anda ubah. Mahasiswa yang sudah berjalan tidak terpengaruh.', confirmLabel: 'Buat template' });
    if (!ok) return;
    try {
      await must(
        supabase.from('milestone_templates').insert(
          defaults.map(({ id: _id, prodi_id: _p, ...t }) => ({ ...t, prodi_id: prodiId })),
        ),
      );
      toast.show('Template prodi dibuat', 'ok');
      st.reload();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };
  const reset = async () => {
    const ok = await dialog.confirm({ title: 'Kembali ke template institusi?', message: 'Template khusus prodi dihapus. Mahasiswa baru akan memakai template institusi.', confirmLabel: 'Hapus template prodi', danger: true });
    if (!ok) return;
    try {
      await must(supabase.from('milestone_templates').delete().eq('prodi_id', prodiId!).eq('jenjang', jenjang));
      toast.show('Memakai template institusi', 'ok');
      st.reload();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      for (const [id, patch] of Object.entries(edits)) {
        await must(supabase.from('milestone_templates').update(patch).eq('id', id));
      }
      setEdits({});
      toast.show('Template disimpan', 'ok');
      st.reload();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  const set = (id: string, patch: Partial<TemplateRow>) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));

  return (
    <Panel
      title={`Template milestone ${jenjang}`}
      sub={prodiId === null ? 'Default institusi, dipakai prodi yang tidak membuat template sendiri' : usingOwn ? 'Template khusus prodi ini' : 'Prodi ini memakai template institusi'}
      actions={
        <>
          {canManage && prodiId !== null && !usingOwn && <Button onClick={copy}>Buat template khusus prodi</Button>}
          {canManage && prodiId !== null && usingOwn && (
            <Button variant="ghost" onClick={reset}>
              Kembali ke template institusi
            </Button>
          )}
          {editable && (
            <Button variant="primary" loading={busy} disabled={Object.keys(edits).length === 0} onClick={save}>
              Simpan template
            </Button>
          )}
        </>
      }
      flush
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>No</th>
              <th>Milestone</th>
              <th>Bukti penyelesaian</th>
              <th>Cara selesai</th>
              <th className="num">Bobot</th>
              <th className="num">Durasi (hari)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const e = edits[r.id] ?? {};
              return (
                <tr key={r.id}>
                  <td className="mono-num">{r.urutan}</td>
                  <td>{editable ? <input value={e.nama ?? r.nama} onChange={(ev) => set(r.id, { nama: ev.target.value })} /> : r.nama}</td>
                  <td className="small">{editable ? <input value={e.bukti ?? r.bukti} onChange={(ev) => set(r.id, { bukti: ev.target.value })} /> : r.bukti}</td>
                  <td className="small muted">{KIND_LABEL[r.jenis]}</td>
                  <td className="num" style={{ width: 100 }}>
                    {editable ? <input type="number" min={0} value={String(e.bobot ?? r.bobot)} onChange={(ev) => set(r.id, { bobot: Number(ev.target.value) })} /> : Number(r.bobot)}
                  </td>
                  <td className="num" style={{ width: 110 }}>
                    {editable ? <input type="number" min={1} value={String(e.durasi_hari ?? r.durasi_hari)} onChange={(ev) => set(r.id, { durasi_hari: Number(ev.target.value) })} /> : r.durasi_hari}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="small muted" style={{ padding: '10px 18px' }}>
        Total bobot {total}. Persentase progres dihitung dari bobot milestone yang selesai dibagi total bobot. Perubahan berlaku untuk mahasiswa yang judulnya disetujui setelah ini.
      </div>
    </Panel>
  );
}
