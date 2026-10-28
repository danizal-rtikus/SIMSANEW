import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useAsync } from '../../lib/useAsync';
import { must, supabase, translateError } from '../../lib/supabase';
import { useProdi } from '../../lib/master';
import { fmtDate, toDateInput } from '../../lib/format';
import { Badge, Button, Empty, ErrorNote, Field, Loading, PageHeader, Panel } from '../../components/ui';
import { Modal, useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import { KATEGORI_LABEL, type Guideline, type Section } from './Pedoman';

export function KelolaPedoman() {
  const { active } = useAuth();
  const prodiList = useProdi();
  const dialog = useDialog();
  const toast = useToast();
  const [prodiId, setProdiId] = useState<string>(active?.role === 'kaprodi' ? active.prodi_id ?? '' : '');
  const [selected, setSelected] = useState<string>('');
  const [editG, setEditG] = useState<Partial<Guideline> | null>(null);
  const [editS, setEditS] = useState<Partial<Section> | null>(null);

  useEffect(() => {
    if (!prodiId && prodiList.length && active?.role === 'admin') setProdiId(prodiList[0].id);
  }, [prodiList, prodiId, active?.role]);

  const gl = useAsync(async () => {
    if (!prodiId) return [] as Guideline[];
    return (await must(supabase.from('guidelines').select('*').eq('prodi_id', prodiId).order('berlaku_mulai', { ascending: false }))) as Guideline[];
  }, [prodiId]);

  useEffect(() => {
    const list = gl.data ?? [];
    if (list.length && !list.some((g) => g.id === selected)) setSelected(list[0].id);
    if (!list.length) setSelected('');
  }, [gl.data, selected]);

  const sec = useAsync(async () => {
    if (!selected) return [] as Section[];
    return (await must(supabase.from('guideline_sections').select('*').eq('guideline_id', selected).order('urutan'))) as Section[];
  }, [selected]);

  const sections = sec.data ?? [];
  const ordered: (Section & { level: number })[] = [];
  sections.filter((s) => !s.parent_id).forEach((t) => {
    ordered.push({ ...t, level: 0 });
    sections.filter((c) => c.parent_id === t.id).forEach((c) => ordered.push({ ...c, level: 1 }));
  });

  const removeSection = async (s: Section) => {
    const ok = await dialog.confirm({ title: 'Hapus bagian ini?', message: `"${s.judul}" beserta subbagiannya akan dihapus.`, confirmLabel: 'Hapus bagian', danger: true });
    if (!ok) return;
    try {
      await must(supabase.from('guideline_sections').delete().eq('id', s.id));
      toast.show('Bagian dihapus', 'ok');
      sec.reload();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };

  const g = (gl.data ?? []).find((x) => x.id === selected);

  return (
    <>
      <PageHeader
        title="Kelola pedoman"
        description="Pedoman per prodi dan tahun akademik. Susun sistematika, aturan penulisan, dan rubrik agar dapat dicari dan dipakai sebagai acuan pemeriksaan."
        actions={
          <>
            {active?.role === 'admin' && (
              <select style={{ maxWidth: 260 }} value={prodiId} onChange={(e) => setProdiId(e.target.value)} aria-label="Prodi">
                {prodiList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nama} ({p.jenjang})
                  </option>
                ))}
              </select>
            )}
            <Button variant="primary" disabled={!prodiId} onClick={() => setEditG({ prodi_id: prodiId, versi: '1.0', gaya_sitasi: 'APA 7', aktif: true, berlaku_mulai: toDateInput(new Date()) })}>
              Tambah pedoman
            </Button>
          </>
        }
      />
      {gl.loading && !gl.data ? (
        <Loading />
      ) : gl.error ? (
        <ErrorNote error={gl.error} onRetry={gl.reload} />
      ) : !(gl.data ?? []).length ? (
        <Panel>
          <Empty title="Belum ada pedoman untuk prodi ini">Tambahkan pedoman lalu susun bagian-bagiannya.</Empty>
        </Panel>
      ) : (
        <div className="grid-main" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr)' }}>
          <Panel title="Versi pedoman" flush>
            <ul className="list">
              {(gl.data ?? []).map((x) => (
                <li key={x.id} style={{ background: x.id === selected ? 'var(--almamater-soft)' : undefined }}>
                  <button className="btn-link strong" style={{ color: 'inherit', textAlign: 'left' }} onClick={() => setSelected(x.id)}>
                    {x.judul}
                  </button>
                  <div className="row small" style={{ marginTop: 4, gap: 8 }}>
                    <span className="muted">
                      Versi {x.versi}, berlaku {fmtDate(x.berlaku_mulai)}
                    </span>
                    {x.aktif ? <Badge tone="ok">Aktif</Badge> : <Badge>Arsip</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          {g && (
            <Panel
              title={g.judul}
              sub={`${sections.length} bagian. Gaya sitasi ${g.gaya_sitasi}.`}
              actions={
                <>
                  <Button size="sm" onClick={() => setEditG(g)}>
                    Ubah informasi
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => setEditS({ guideline_id: g.id, kategori: 'umum', urutan: (sections.filter((s) => !s.parent_id).length + 1) })}>
                    Tambah bagian
                  </Button>
                </>
              }
              flush
            >
              {sec.loading && !sec.data ? (
                <Loading />
              ) : ordered.length === 0 ? (
                <p className="muted small" style={{ padding: 18 }}>
                  Belum ada bagian. Mulai dari Sistematika Penulisan agar sesuai dengan milestone.
                </p>
              ) : (
                <table className="table">
                  <tbody>
                    {ordered.map((s) => (
                      <tr key={s.id}>
                        <td style={{ paddingLeft: 14 + s.level * 22 }}>
                          <span className="muted">{s.nomor}</span> <span className={s.level === 0 ? 'strong' : ''}>{s.judul}</span>
                          <div className="muted small" style={{ maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.isi}
                          </div>
                        </td>
                        <td className="small">{KATEGORI_LABEL[s.kategori]}</td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                          {s.level === 0 && (
                            <Button size="sm" variant="ghost" onClick={() => setEditS({ guideline_id: g.id, parent_id: s.id, kategori: s.kategori, urutan: sections.filter((c) => c.parent_id === s.id).length + 1 })}>
                              Subbagian
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setEditS(s)}>
                            Ubah
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => removeSection(s)}>
                            Hapus
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          )}
        </div>
      )}
      <GuidelineModal value={editG} onClose={() => setEditG(null)} onSaved={(id) => { setEditG(null); setSelected(id); gl.reload(); }} />
      <SectionModal value={editS} parents={sections.filter((s) => !s.parent_id)} onClose={() => setEditS(null)} onSaved={() => { setEditS(null); sec.reload(); }} />
    </>
  );
}

function GuidelineModal({ value, onClose, onSaved }: { value: Partial<Guideline> | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [v, setV] = useState<Partial<Guideline>>({});
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (value) {
      setV({ ...value, berlaku_mulai: value.berlaku_mulai ? toDateInput(value.berlaku_mulai) : toDateInput(new Date()) });
      setFile(null);
      setErr(null);
    }
  }, [value]);

  const save = async () => {
    if (!v.judul?.trim()) return setErr('Judul pedoman wajib diisi');
    setBusy(true);
    setErr(null);
    try {
      let file_path = v.file_path ?? null;
      if (file) {
        if (!/\.pdf$/i.test(file.name)) throw new Error('Berkas pedoman harus PDF');
        file_path = `${v.prodi_id}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, '-')}`;
        const up = await supabase.storage.from('guidelines').upload(file_path, file, { contentType: 'application/pdf' });
        if (up.error) throw new Error(translateError(up.error.message));
      }
      const row = {
        prodi_id: v.prodi_id,
        judul: v.judul.trim(),
        versi: v.versi?.trim() || '1.0',
        berlaku_mulai: v.berlaku_mulai,
        gaya_sitasi: v.gaya_sitasi?.trim() || 'APA 7',
        aktif: v.aktif ?? true,
        file_path,
      };
      const saved = v.id
        ? await must(supabase.from('guidelines').update(row).eq('id', v.id).select('id').single())
        : await must(supabase.from('guidelines').insert(row).select('id').single());
      onSaved((saved as { id: string }).id);
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
      title={v.id ? 'Ubah informasi pedoman' : 'Tambah pedoman'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Simpan pedoman
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Judul" className="full">
          <input value={v.judul ?? ''} onChange={(e) => setV({ ...v, judul: e.target.value })} placeholder="Pedoman Penulisan Skripsi" />
        </Field>
        <Field label="Versi">
          <input value={v.versi ?? ''} onChange={(e) => setV({ ...v, versi: e.target.value })} />
        </Field>
        <Field label="Berlaku mulai">
          <input type="date" value={v.berlaku_mulai ?? ''} onChange={(e) => setV({ ...v, berlaku_mulai: e.target.value })} />
        </Field>
        <Field label="Gaya sitasi">
          <input value={v.gaya_sitasi ?? ''} onChange={(e) => setV({ ...v, gaya_sitasi: e.target.value })} placeholder="APA 7, IEEE, Harvard" />
        </Field>
        <Field label="Status">
          <select value={v.aktif === false ? '0' : '1'} onChange={(e) => setV({ ...v, aktif: e.target.value === '1' })}>
            <option value="1">Aktif (terlihat oleh mahasiswa)</option>
            <option value="0">Arsip</option>
          </select>
        </Field>
        <Field label="PDF asli (opsional)" className="full" hint={v.file_path ? 'Sudah ada PDF. Pilih berkas baru untuk mengganti.' : 'Maksimal 50 MB'}>
          <input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
      </div>
      {err && <div className="note bad" style={{ marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}

function SectionModal({ value, parents, onClose, onSaved }: { value: Partial<Section> | null; parents: Section[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Partial<Section>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (value) {
      setV(value);
      setErr(null);
    }
  }, [value]);
  const save = async () => {
    if (!v.judul?.trim()) return setErr('Judul bagian wajib diisi');
    setBusy(true);
    try {
      const row = {
        guideline_id: v.guideline_id,
        parent_id: v.parent_id || null,
        urutan: Number(v.urutan ?? 0),
        nomor: v.nomor?.trim() || null,
        judul: v.judul.trim(),
        isi: v.isi ?? '',
        kategori: v.kategori ?? 'umum',
      };
      if (v.id) await must(supabase.from('guideline_sections').update(row).eq('id', v.id));
      else await must(supabase.from('guideline_sections').insert(row));
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
      wide
      title={v.id ? 'Ubah bagian' : 'Tambah bagian'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Simpan bagian
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Nomor">
          <input value={v.nomor ?? ''} onChange={(e) => setV({ ...v, nomor: e.target.value })} placeholder="mis. 2.1" />
        </Field>
        <Field label="Urutan tampil">
          <input type="number" value={String(v.urutan ?? 0)} onChange={(e) => setV({ ...v, urutan: Number(e.target.value) })} />
        </Field>
        <Field label="Judul bagian" className="full">
          <input value={v.judul ?? ''} onChange={(e) => setV({ ...v, judul: e.target.value })} />
        </Field>
        <Field label="Jenis">
          <select value={v.kategori ?? 'umum'} onChange={(e) => setV({ ...v, kategori: e.target.value as Section['kategori'] })}>
            {(Object.keys(KATEGORI_LABEL) as Section['kategori'][]).map((k) => (
              <option key={k} value={k}>
                {KATEGORI_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Induk">
          <select value={v.parent_id ?? ''} onChange={(e) => setV({ ...v, parent_id: e.target.value || null })}>
            <option value="">Bagian utama</option>
            {parents
              .filter((p) => p.id !== v.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nomor} {p.judul}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Isi" className="full" hint="Teks biasa. Baris baru dipertahankan saat ditampilkan.">
          <textarea style={{ minHeight: 220 }} value={v.isi ?? ''} onChange={(e) => setV({ ...v, isi: e.target.value })} />
        </Field>
      </div>
      {err && <div className="note bad" style={{ marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}
