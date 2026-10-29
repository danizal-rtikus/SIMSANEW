import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { rpc } from '../../lib/queries';
import { useQueryState } from '../../lib/shell';
import { downloadXlsx, type Cell, type Sheet } from '../../lib/xlsx';
import { Badge, Button, Empty, ErrorNote, Facts, Field, Loading, PageHeader, Panel } from '../../components/ui';
import { Modal } from '../../components/Dialog';
import { useToast } from '../../components/Toast';

/* ------------------------------------------------------------------ */
/* Tipe data dari RPC dashboard_akreditasi                             */
/* ------------------------------------------------------------------ */

interface Prodi {
  id: string;
  kode: string;
  nama: string;
  jenjang: 'S1' | 'D3';
  lembaga: string | null;
  bisa_isi: boolean;
}
interface Ringkas {
  prodi_id: string;
  lulusan: [number, number, number];
  n_masa_studi: number;
  rata_masa_studi: number | null;
  tepat: number;
  tanpa_angkatan: number;
  rata_lama_ta_bulan: number | null;
  ujian_n: number;
  ujian_lulus_pertama: number;
  ujian_pertama_n: number;
  mhs_aktif: { ganjil: number; genap: number };
  sesi: { ganjil: number; genap: number };
  p1: { ganjil: number | null; genap: number | null };
  hari_review: number | null;
  berisiko: number;
}
interface BarisMasa {
  prodi_id: string;
  angkatan: number;
  k: number;
  diterima: number | null;
  lulus_per_ts: number[];
  lulus: number;
  tepat: number;
  rata_masa_studi: number | null;
  masih_aktif: number;
}
interface Tahap {
  prodi_id: string;
  pembimbing_sempro: number | null;
  sempro_semhas: number | null;
  semhas_akhir: number | null;
  pembimbing_akhir: number | null;
  akhir_lulus: number | null;
}
interface Ujian {
  prodi_id: string;
  jenis: 'sempro' | 'semhas' | 'pendadaran' | 'd3';
  n: number;
  pertama_n: number;
  lulus_pertama: number;
  mengulang: number;
}
interface Dosen {
  id: string;
  nama: string;
  homebase: string | null;
  kuota: number | null;
  p1_ganjil: number;
  p1_genap: number;
  p2_ganjil: number;
  p2_genap: number;
  sesi: number;
  n_review: number;
  hari_review: number | null;
  penguji: number;
}
interface Berisiko {
  thesis_id: string;
  nama: string;
  nim: string | null;
  prodi_id: string;
  angkatan: number;
  semester: number;
  batas: number;
  tahap: string | null;
  status: string;
}
interface Data {
  ts: number;
  ts_ditetapkan: number;
  batas: { S1: number; D3: number };
  rentang: { mulai: string; selesai: string };
  bisa_atur: boolean;
  prodi: Prodi[];
  ringkas: Ringkas[];
  masa_studi: BarisMasa[];
  tahap: Tahap[];
  ujian: Ujian[];
  dosen: Dosen[];
  berisiko: Berisiko[];
  tanpa_angkatan_aktif: number;
  topik: { prodi_id: string; bidang: string; n: number }[];
}

const UJIAN_LABEL: Record<Ujian['jenis'], string> = { sempro: 'Seminar Proposal', semhas: 'Seminar Hasil', pendadaran: 'Pendadaran', d3: 'Seminar Tertutup dan Komprehensif' };

const ta = (y: number) => `${y}/${y + 1}`;
const nf1 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const pct = (a: number, b: number | null | undefined) => (b ? `${nf1.format((a / b) * 100)}%` : '-');
const pctNum = (a: number, b: number | null | undefined) => (b ? Math.round((a / b) * 1000) / 10 : null);
const num = (v: number | null | undefined, f = nf2) => (v === null || v === undefined ? '-' : f.format(Number(v)));
const avg2 = (a: number | null, b: number | null) => (a === null && b === null ? null : ((a ?? 0) + (b ?? 0)) / ((a !== null ? 1 : 0) + (b !== null ? 1 : 0)));

export function Akreditasi() {
  const [tsParam, setTsParam] = useQueryState<string>('ts', '');
  const [prodiParam, setProdiParam] = useQueryState<string>('prodi', '');
  const [atur, setAtur] = useState(false);
  const st = useAsync(async () => rpc<Data>('dashboard_akreditasi', { p_ts: tsParam ? Number(tsParam) : null, p_prodi: null }), [tsParam]);

  const d = st.data;
  const prodiId = d ? (d.prodi.some((p) => p.id === prodiParam) ? prodiParam : d.prodi.length === 1 ? d.prodi[0].id : '') : '';
  const prodi = d?.prodi.find((p) => p.id === prodiId) ?? null;

  const tahunPilihan = useMemo(() => {
    const now = new Date();
    const cur = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    const base = d?.ts_ditetapkan ?? cur;
    const out = new Set<number>();
    for (let y = Math.max(cur, base); y >= Math.min(cur, base) - 6; y--) out.add(y);
    return [...out];
  }, [d?.ts_ditetapkan]);

  if (st.loading && !d) return <Loading variant="page" />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  if (!d) return null;

  return (
    <>
      <PageHeader
        title="Dashboard akreditasi"
        description="Indikator studi akhir untuk penyusunan LKPS dan LED: masa studi, kelulusan tepat waktu, penyelesaian tugas akhir, ujian, dan pembimbingan."
        actions={
          <div className="row" style={{ gap: 8 }}>
            {d.bisa_atur && <Button onClick={() => setAtur(true)}>Pengaturan</Button>}
            <Button variant="primary" onClick={() => exportXlsx(d, prodi)}>
              Unduh Excel
            </Button>
          </div>
        }
      />
      <div className="row filterbar akr-filter">
        {d.prodi.length > 1 && (
          <select value={prodiId} onChange={(e) => setProdiParam(e.target.value)} aria-label="Program studi">
            <option value="">Semua program studi</option>
            {d.prodi.map((p) => (
              <option key={p.id} value={p.id}>
                {p.jenjang} {p.nama}
              </option>
            ))}
          </select>
        )}
        <select value={String(d.ts)} onChange={(e) => setTsParam(Number(e.target.value) === d.ts_ditetapkan ? '' : e.target.value)} aria-label="Tahun akademik TS">
          {tahunPilihan.map((y) => (
            <option key={y} value={y}>
              TS {ta(y)}
              {y === d.ts_ditetapkan ? ' (ditetapkan)' : ''}
            </option>
          ))}
        </select>
        <span className="muted small">
          TS-1 {ta(d.ts - 1)}, TS-2 {ta(d.ts - 2)}
          {prodi?.lembaga ? ` · ${prodi.lembaga}` : ''}
        </span>
      </div>
      {d.ts !== d.ts_ditetapkan && (
        <div className="note small" style={{ marginBottom: 16 }}>
          Anda sedang melihat TS {ta(d.ts)}. TS yang ditetapkan Admin adalah {ta(d.ts_ditetapkan)}.{' '}
          <button type="button" className="link-btn" onClick={() => setTsParam('')}>
            Kembali ke TS yang ditetapkan
          </button>
        </div>
      )}

      {prodi ? <ProdiView d={d} prodi={prodi} onReload={st.reload} /> : <SemuaView d={d} onPick={setProdiParam} />}

      <Definisi d={d} />
      {atur && <PengaturanModal d={d} onClose={() => setAtur(false)} onSaved={() => { setAtur(false); setTsParam(''); st.reload(); }} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Semua prodi                                                          */
/* ------------------------------------------------------------------ */

function SemuaView({ d, onPick }: { d: Data; onPick: (id: string) => void }) {
  const r = (id: string) => d.ringkas.find((x) => x.prodi_id === id)!;
  const tot = d.ringkas.reduce(
    (a, x) => ({ ts: a.ts + x.lulusan[0], tiga: a.tiga + x.lulusan[0] + x.lulusan[1] + x.lulusan[2], tepat: a.tepat + x.tepat, n: a.n + x.n_masa_studi, risiko: a.risiko + x.berisiko }),
    { ts: 0, tiga: 0, tepat: 0, n: 0, risiko: 0 },
  );
  return (
    <div className="stack">
      <Facts
        items={[
          { label: `Lulusan TS ${ta(d.ts)}`, value: tot.ts, note: `${tot.tiga} lulusan dalam 3 TS` },
          { label: 'Lulus tepat waktu (3 TS)', value: pct(tot.tepat, tot.n), note: `${tot.tepat} dari ${tot.n} lulusan` },
          { label: 'Berisiko terlambat', value: tot.risiko, note: 'per hari ini' },
          { label: 'Program studi', value: d.prodi.length },
        ]}
      />
      <Panel title="Perbandingan program studi" sub="Klik baris untuk melihat rincian prodi" flush>
        <div className="table-wrap">
          <table className="table akr-table">
            <thead>
              <tr>
                <th>Program studi</th>
                <th>Lembaga</th>
                <th className="num">Lulusan TS</th>
                <th className="num">TS-1</th>
                <th className="num">TS-2</th>
                <th className="num">Rata-rata masa studi (th)</th>
                <th className="num">Tepat waktu</th>
                <th className="num">Lama TA (bln)</th>
                <th className="num">Lulus ujian pertama</th>
                <th className="num">Rata-rata P1/dosen</th>
                <th className="num">Berisiko</th>
              </tr>
            </thead>
            <tbody>
              {d.prodi.map((p) => {
                const x = r(p.id);
                return (
                  <tr key={p.id} className="clickable" onClick={() => onPick(p.id)}>
                    <td>
                      <div className="strong">{p.nama}</div>
                      <div className="muted small">
                        {p.jenjang} · {p.kode}
                      </div>
                    </td>
                    <td className="small akr-nowrap">{p.lembaga ?? "-"}</td>
                    <td className="num">{x.lulusan[0]}</td>
                    <td className="num">{x.lulusan[1]}</td>
                    <td className="num">{x.lulusan[2]}</td>
                    <td className="num">{num(x.rata_masa_studi)}</td>
                    <td className="num">{pct(x.tepat, x.n_masa_studi)}</td>
                    <td className="num">{num(x.rata_lama_ta_bulan, nf1)}</td>
                    <td className="num">{pct(x.ujian_lulus_pertama, x.ujian_pertama_n)}</td>
                    <td className="num">{num(avg2(x.p1.ganjil, x.p1.genap))}</td>
                    <td className="num">{x.berisiko ? <Badge tone="warn">{x.berisiko}</Badge> : 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      <DosenPanel d={d} />
      <BerisikoPanel d={d} list={d.berisiko} showProdi />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Satu prodi                                                           */
/* ------------------------------------------------------------------ */

function ProdiView({ d, prodi, onReload }: { d: Data; prodi: Prodi; onReload: () => void }) {
  const x = d.ringkas.find((r) => r.prodi_id === prodi.id)!;
  const rows = d.masa_studi.filter((r) => r.prodi_id === prodi.id);
  const tahap = d.tahap.find((t) => t.prodi_id === prodi.id);
  const ujian = d.ujian.filter((u) => u.prodi_id === prodi.id);
  const topik = d.topik.filter((t) => t.prodi_id === prodi.id);
  const sesiPerMhs = avg2(x.mhs_aktif.ganjil ? x.sesi.ganjil / x.mhs_aktif.ganjil : null, x.mhs_aktif.genap ? x.sesi.genap / x.mhs_aktif.genap : null);

  return (
    <div className="stack">
      <Facts
        items={[
          { label: `Lulusan TS ${ta(d.ts)}`, value: x.lulusan[0], note: `TS-1: ${x.lulusan[1]} · TS-2: ${x.lulusan[2]}` },
          { label: 'Rata-rata masa studi', value: x.rata_masa_studi === null ? '-' : `${num(x.rata_masa_studi)} th`, note: `${x.n_masa_studi} lulusan dalam 3 TS` },
          { label: 'Lulus tepat waktu', value: pct(x.tepat, x.n_masa_studi), note: `${x.tepat} lulusan, batas ${d.batas[prodi.jenjang]} semester` },
          { label: 'Rata-rata lama TA', value: x.rata_lama_ta_bulan === null ? '-' : `${num(x.rata_lama_ta_bulan, nf1)} bln`, note: 'penetapan pembimbing sampai ujian akhir' },
          { label: 'Lulus ujian pertama', value: pct(x.ujian_lulus_pertama, x.ujian_pertama_n), note: `${x.ujian_n} ujian pada TS` },
          { label: 'Berisiko terlambat', value: x.berisiko, note: 'per hari ini' },
        ]}
      />
      {x.tanpa_angkatan > 0 && <div className="note warn small">{x.tanpa_angkatan} lulusan belum memiliki angkatan sehingga tidak dihitung dalam masa studi. Lengkapi angkatan di menu Pengguna.</div>}

      <MasaStudiPanel d={d} prodi={prodi} rows={rows} onReload={onReload} />

      <div className="grid-2 akr-grid">
        <Panel title="Lama penyelesaian per tahap" sub="Rata-rata hari, lulusan 3 TS terakhir">
          <TahapBars t={tahap} jenjang={prodi.jenjang} />
        </Panel>
        <Panel title={`Ujian pada TS ${ta(d.ts)}`} flush>
          {ujian.length === 0 ? (
            <p className="muted small" style={{ padding: 16, margin: 0 }}>
              Belum ada ujian yang diputuskan pada TS ini.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="table akr-table">
                <thead>
                  <tr>
                    <th>Ujian</th>
                    <th className="num">Jumlah</th>
                    <th className="num">Lulus percobaan pertama</th>
                    <th className="num">Mengulang</th>
                  </tr>
                </thead>
                <tbody>
                  {ujian.map((u) => (
                    <tr key={u.jenis}>
                      <td>{UJIAN_LABEL[u.jenis]}</td>
                      <td className="num">{u.n}</td>
                      <td className="num">
                        {pct(u.lulus_pertama, u.pertama_n)} <span className="muted small">({u.lulus_pertama}/{u.pertama_n})</span>
                      </td>
                      <td className="num">{u.mengulang}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Facts
        items={[
          { label: 'Rata-rata mahasiswa per dosen sebagai P1', value: num(avg2(x.p1.ganjil, x.p1.genap)), note: `Ganjil ${num(x.p1.ganjil)} · Genap ${num(x.p1.genap)}` },
          { label: 'Rata-rata sesi bimbingan per mahasiswa', value: num(sesiPerMhs), note: 'per semester, sesi yang selesai' },
          { label: 'Rata-rata waktu tanggap review', value: x.hari_review === null ? '-' : `${num(x.hari_review, nf1)} hari`, note: 'pengajuan bab sampai tanggapan dosen' },
          { label: 'Mahasiswa dibimbing', value: Math.max(x.mhs_aktif.ganjil, x.mhs_aktif.genap), note: `Ganjil ${x.mhs_aktif.ganjil} · Genap ${x.mhs_aktif.genap}` },
        ]}
      />
      <DosenPanel d={d} />

      <div className="grid-2 akr-grid">
        <BerisikoPanel d={d} list={d.berisiko.filter((b) => b.prodi_id === prodi.id)} />
        <Panel title="Bidang kajian" sub={`Studi akhir yang dimulai TS-2 sampai TS`}>
          {topik.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              Belum ada data.
            </p>
          ) : (
            <div className="bar-list">
              {topik.map((t) => (
                <div className="bar-row" key={t.bidang}>
                  <span className={t.bidang === 'Belum diisi' ? 'muted' : ''}>{t.bidang}</span>
                  <span className="bar">
                    <span style={{ width: `${(t.n / Math.max(...topik.map((z) => z.n))) * 100}%` }} />
                  </span>
                  <span className="num">{t.n}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function MasaStudiPanel({ d, prodi, rows, onReload }: { d: Data; prodi: Prodi; rows: BarisMasa[]; onReload: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => setEdit({}), [rows]);
  const kolom = rows[0]?.lulus_per_ts.length ?? 0;
  const dirty = Object.keys(edit).length > 0;

  const simpan = async () => {
    setSaving(true);
    try {
      for (const [ang, v] of Object.entries(edit)) {
        const t = v.trim();
        if (t && !/^\d+$/.test(t)) throw new Error(`Jumlah angkatan ${ang} harus bilangan bulat`);
        await rpc('simpan_mahasiswa_baru', { p_prodi: prodi.id, p_angkatan: Number(ang), p_jumlah: t ? Number(t) : null });
      }
      toast.show('Jumlah mahasiswa diterima disimpan', 'ok');
      onReload();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setSaving(false);
    }
  };

  const total = rows.reduce((a, r) => ({ diterima: a.diterima + (r.diterima ?? 0), lulus: a.lulus + r.lulus, tepat: a.tepat + r.tepat }), { diterima: 0, lulus: 0, tepat: 0 });

  return (
    <Panel
      title="Masa studi lulusan per angkatan"
      sub={`Bentuk tabel LKPS. Kolom TS-n berisi jumlah lulusan angkatan itu pada tahun akademik TS-n. Data lulusan dihitung sejak SIMSA dipakai.`}
      actions={
        prodi.bisa_isi && dirty ? (
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" variant="ghost" onClick={() => setEdit({})} disabled={saving}>
              Batal
            </Button>
            <Button size="sm" variant="primary" loading={saving} onClick={simpan}>
              Simpan jumlah diterima
            </Button>
          </div>
        ) : undefined
      }
      flush
    >
      <div className="table-wrap">
        <table className="table akr-table akr-masa">
          <thead>
            <tr>
              <th rowSpan={2}>Tahun masuk</th>
              <th rowSpan={2} className="num">
                Jumlah diterima
              </th>
              <th colSpan={kolom} className="akr-group">
                Jumlah lulusan pada
              </th>
              <th rowSpan={2} className="num">
                Lulusan s.d. akhir TS
              </th>
              <th rowSpan={2} className="num">
                Tepat waktu
              </th>
              <th rowSpan={2} className="num">
                Rata-rata masa studi (th)
              </th>
              <th rowSpan={2} className="num">
                Keberhasilan studi
              </th>
              <th rowSpan={2} className="num">
                Masih aktif
              </th>
            </tr>
            <tr>
              {Array.from({ length: kolom }, (_, i) => {
                const k = kolom - 1 - i;
                return (
                  <th key={k} className="num akr-sub">
                    {k ? `TS-${k}` : 'TS'}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.angkatan}>
                <td>
                  <span className="strong">{r.k ? `TS-${r.k}` : 'TS'}</span> <span className="muted small">{ta(r.angkatan)}</span>
                </td>
                <td className="num">
                  {prodi.bisa_isi ? (
                    <input
                      className="akr-input"
                      inputMode="numeric"
                      aria-label={`Jumlah diterima angkatan ${r.angkatan}`}
                      value={edit[r.angkatan] ?? (r.diterima ?? '')}
                      placeholder="-"
                      onChange={(e) => setEdit({ ...edit, [r.angkatan]: e.target.value.replace(/[^\d]/g, '') })}
                    />
                  ) : (
                    r.diterima ?? '-'
                  )}
                </td>
                {r.lulus_per_ts.map((n, i) => {
                  const k = kolom - 1 - i;
                  const mungkin = k <= r.k;
                  return (
                    <td key={i} className={`num ${mungkin ? '' : 'akr-na'}`}>
                      {mungkin ? n || '' : ''}
                    </td>
                  );
                })}
                <td className="num strong">{r.lulus}</td>
                <td className="num">{r.tepat}</td>
                <td className="num">{num(r.rata_masa_studi)}</td>
                <td className="num">{pct(r.lulus, r.diterima)}</td>
                <td className="num">{r.masih_aktif}</td>
              </tr>
            ))}
            <tr className="akr-total">
              <td className="strong">Jumlah</td>
              <td className="num">{total.diterima || '-'}</td>
              {Array.from({ length: kolom }, (_, i) => (
                <td key={i} className="num">
                  {rows.reduce((a, r) => a + (r.lulus_per_ts[i] ?? 0), 0) || ''}
                </td>
              ))}
              <td className="num strong">{total.lulus}</td>
              <td className="num">{total.tepat}</td>
              <td className="num" />
              <td className="num">{pct(total.lulus, total.diterima)}</td>
              <td className="num">{rows.reduce((a, r) => a + r.masih_aktif, 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {prodi.bisa_isi && <p className="muted small akr-foot">Isi jumlah mahasiswa diterima per angkatan (dari data PMB atau PDDikti) agar persentase keberhasilan studi terhitung.</p>}
    </Panel>
  );
}

function TahapBars({ t, jenjang }: { t: Tahap | undefined; jenjang: 'S1' | 'D3' }) {
  const items: [string, number | null | undefined][] =
    jenjang === 'D3'
      ? [
          ['Penetapan pembimbing sampai ujian', t?.pembimbing_akhir],
          ['Ujian sampai yudisium', t?.akhir_lulus],
        ]
      : [
          ['Penetapan pembimbing sampai Seminar Proposal', t?.pembimbing_sempro],
          ['Seminar Proposal sampai Seminar Hasil', t?.sempro_semhas],
          ['Seminar Hasil sampai Pendadaran', t?.semhas_akhir],
          ['Pendadaran sampai yudisium', t?.akhir_lulus],
        ];
  const max = Math.max(1, ...items.map(([, v]) => Number(v ?? 0)));
  if (items.every(([, v]) => v === null || v === undefined)) return <p className="muted small" style={{ margin: 0 }}>Belum ada lulusan dalam 3 TS terakhir.</p>;
  return (
    <div className="bar-list akr-bars">
      {items.map(([label, v]) => (
        <div className="bar-row" key={label}>
          <span>{label}</span>
          <span className="bar">
            <span style={{ width: `${(Number(v ?? 0) / max) * 100}%` }} />
          </span>
          <span className="num">{v === null || v === undefined ? '-' : `${v} hari`}</span>
        </div>
      ))}
    </div>
  );
}

function DosenPanel({ d }: { d: Data }) {
  const [semua, setSemua] = useState(false);
  const list = semua ? d.dosen : d.dosen.slice(0, 15);
  return (
    <Panel title={`Beban pembimbingan dan pengujian, TS ${ta(d.ts)}`} sub="Mahasiswa yang dibimbing pada tiap semester (dihitung sekali per mahasiswa)" flush>
      {d.dosen.length === 0 ? (
        <p className="muted small" style={{ padding: 16, margin: 0 }}>
          Belum ada data pembimbingan pada TS ini.
        </p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table akr-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Dosen</th>
                  <th colSpan={2} className="akr-group">
                    Pembimbing 1
                  </th>
                  <th colSpan={2} className="akr-group">
                    Pembimbing 2
                  </th>
                  <th rowSpan={2} className="num">
                    Sesi selesai
                  </th>
                  <th rowSpan={2} className="num">
                    Review bab
                  </th>
                  <th rowSpan={2} className="num">
                    Tanggap (hari)
                  </th>
                  <th rowSpan={2} className="num">
                    Penguji
                  </th>
                </tr>
                <tr>
                  <th className="num akr-sub">Ganjil</th>
                  <th className="num akr-sub">Genap</th>
                  <th className="num akr-sub">Ganjil</th>
                  <th className="num akr-sub">Genap</th>
                </tr>
              </thead>
              <tbody>
                {list.map((x) => {
                  const lebih = x.kuota !== null && Math.max(x.p1_ganjil + x.p2_ganjil, x.p1_genap + x.p2_genap) > x.kuota;
                  return (
                    <tr key={x.id}>
                      <td>
                        <div className="strong">{x.nama}</div>
                        <div className="muted small">
                          {x.homebase ?? 'Homebase belum diisi'}
                          {lebih && (
                            <>
                              {' '}
                              <Badge tone="warn">Melebihi kuota {x.kuota}</Badge>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="num">{x.p1_ganjil}</td>
                      <td className="num">{x.p1_genap}</td>
                      <td className="num">{x.p2_ganjil}</td>
                      <td className="num">{x.p2_genap}</td>
                      <td className="num">{x.sesi}</td>
                      <td className="num">{x.n_review}</td>
                      <td className="num">{num(x.hari_review, nf1)}</td>
                      <td className="num">{x.penguji}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {d.dosen.length > 15 && (
            <div className="akr-foot">
              <button type="button" className="link-btn small" onClick={() => setSemua(!semua)}>
                {semua ? 'Tampilkan 15 teratas' : `Tampilkan semua (${d.dosen.length} dosen)`}
              </button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function BerisikoPanel({ d, list, showProdi }: { d: Data; list: Berisiko[]; showProdi?: boolean }) {
  const kode = (id: string) => d.prodi.find((p) => p.id === id)?.kode ?? '';
  return (
    <Panel title="Berisiko tidak lulus tepat waktu" sub="Per hari ini: mahasiswa aktif pada semester terakhir batas atau melewatinya" flush>
      {list.length === 0 ? (
        <Empty title="Tidak ada mahasiswa berisiko">Semua mahasiswa aktif masih dalam batas tepat waktu.</Empty>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 420 }}>
          <table className="table akr-table">
            <thead>
              <tr>
                <th>Mahasiswa</th>
                {showProdi && <th>Prodi</th>}
                <th className="num">Semester</th>
                <th>Tahap sekarang</th>
              </tr>
            </thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.thesis_id}>
                  <td>
                    <Link to={`/mahasiswa-bimbingan/${b.thesis_id}`} className="strong">
                      {b.nama}
                    </Link>
                    <div className="muted small mono-num">
                      {b.nim} · angkatan {b.angkatan}
                    </div>
                  </td>
                  {showProdi && <td className="small">{kode(b.prodi_id)}</td>}
                  <td className="num">
                    <Badge tone={b.semester > b.batas ? 'bad' : 'warn'}>
                      {b.semester} / {b.batas}
                    </Badge>
                  </td>
                  <td className="small">{b.status === 'cuti' ? 'Cuti' : b.tahap ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d.tanpa_angkatan_aktif > 0 && <p className="muted small akr-foot">{d.tanpa_angkatan_aktif} mahasiswa aktif belum memiliki angkatan sehingga tidak dapat dinilai.</p>}
    </Panel>
  );
}

function Definisi({ d }: { d: Data }) {
  return (
    <details className="akr-def">
      <summary>Definisi dan cara hitung</summary>
      <ul className="small">
        <li>
          <b>Tahun akademik (TS)</b>: semester Ganjil dan Genap {ta(d.ts)} ({d.rentang.mulai} sampai {d.rentang.selesai}), mengikuti kalender Tahun Akademik di Master data. TS-1 dan TS-2 mengikuti TS yang dipilih.
        </li>
        <li>
          <b>Tanggal lulus</b>: tanggal milestone Yudisium dinyatakan selesai.
        </li>
        <li>
          <b>Masa studi</b>: semester lulus (dihitung dari semester Ganjil tahun angkatan) dibagi 2. Angkatan diambil dari profil mahasiswa atau 4 digit pertama NIM.
        </li>
        <li>
          <b>Tepat waktu</b>: lulus paling lambat semester {d.batas.S1} untuk S1 dan semester {d.batas.D3} untuk D3.
        </li>
        <li>
          <b>Keberhasilan studi</b>: lulusan s.d. akhir TS dibagi jumlah mahasiswa diterima pada angkatan itu.
        </li>
        <li>
          <b>Lama TA</b>: dari penetapan pembimbing sampai ujian akhir (Pendadaran atau Seminar Tertutup D3) dinyatakan lulus.
        </li>
        <li>
          <b>Rata-rata P1 per dosen</b>: jumlah mahasiswa yang dibimbing sebagai Pembimbing 1 pada semester itu, dirata-rata atas dosen yang membimbing di prodi tersebut.
        </li>
        <li>Data hanya mencakup mahasiswa yang tercatat di SIMSA. Cocokkan rumus akhir dengan instrumen lembaga akreditasi masing-masing prodi.</li>
      </ul>
    </details>
  );
}

/* ------------------------------------------------------------------ */
/* Pengaturan (Admin)                                                   */
/* ------------------------------------------------------------------ */

function PengaturanModal({ d, onClose, onSaved }: { d: Data; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const now = new Date();
  const cur = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  const [ts, setTs] = useState(d.ts_ditetapkan);
  const [s1, setS1] = useState(d.batas.S1);
  const [d3, setD3] = useState(d.batas.D3);
  const [lembaga, setLembaga] = useState<Record<string, string>>(Object.fromEntries(d.prodi.map((p) => [p.id, p.lembaga ?? ''])));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await rpc('atur_akreditasi', { p_ts: ts, p_batas_s1: s1, p_batas_d3: d3 });
      for (const p of d.prodi) if ((p.lembaga ?? '') !== lembaga[p.id]) await rpc('atur_lembaga_prodi', { p_prodi: p.id, p_lembaga: lembaga[p.id] });
      toast.show('Pengaturan akreditasi disimpan', 'ok');
      onSaved();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="Pengaturan akreditasi"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <Field label="Tahun akademik TS" hint="Dipakai sebagai bawaan untuk semua pengguna dashboard. TS-1 dan TS-2 menyesuaikan.">
          <select value={ts} onChange={(e) => setTs(Number(e.target.value))}>
            {Array.from({ length: 10 }, (_, i) => cur + 1 - i).map((y) => (
              <option key={y} value={y}>
                {ta(y)}
              </option>
            ))}
          </select>
        </Field>
        <div className="auth-row">
          <Field label="Batas tepat waktu S1 (semester)">
            <input type="number" min={6} max={14} value={s1} onChange={(e) => setS1(Number(e.target.value))} />
          </Field>
          <Field label="Batas tepat waktu D3 (semester)">
            <input type="number" min={4} max={10} value={d3} onChange={(e) => setD3(Number(e.target.value))} />
          </Field>
        </div>
        <div className="strong small">Lembaga akreditasi per prodi</div>
        {d.prodi.map((p) => (
          <div className="akr-lembaga" key={p.id}>
            <span className="small">
              {p.jenjang} {p.nama}
            </span>
            <input list="akr-lam" value={lembaga[p.id]} onChange={(e) => setLembaga({ ...lembaga, [p.id]: e.target.value })} aria-label={`Lembaga akreditasi ${p.nama}`} />
          </div>
        ))}
        <datalist id="akr-lam">
          <option value="LAM INFOKOM" />
          <option value="LAM DEPILAR" />
          <option value="BAN-PT" />
        </datalist>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Ekspor Excel                                                         */
/* ------------------------------------------------------------------ */

function exportXlsx(d: Data, only: Prodi | null) {
  const list = only ? [only] : d.prodi;
  const sheets: Sheet[] = [];
  const head = ['Program studi', 'Jenjang', 'Lembaga', 'Lulusan TS', 'Lulusan TS-1', 'Lulusan TS-2', 'Rata-rata masa studi (th, 3 TS)', 'Lulus tepat waktu (%)', 'Rata-rata lama TA (bulan)', 'Lulus ujian percobaan pertama (%)', 'Rata-rata P1 per dosen Ganjil', 'Rata-rata P1 per dosen Genap', 'Rata-rata tanggap review (hari)', 'Berisiko terlambat'];
  sheets.push({
    name: 'Ringkasan',
    bold: [0, 2],
    widths: [30, 9, 14, 11, 11, 11, 16, 14, 14, 16, 14, 14, 14, 12],
    rows: [
      [`Dashboard akreditasi SIMSA, TS ${ta(d.ts)} (TS-1 ${ta(d.ts - 1)}, TS-2 ${ta(d.ts - 2)})`],
      [],
      head,
      ...list.map((p) => {
        const x = d.ringkas.find((r) => r.prodi_id === p.id)!;
        return [p.nama, p.jenjang, p.lembaga, x.lulusan[0], x.lulusan[1], x.lulusan[2], x.rata_masa_studi, pctNum(x.tepat, x.n_masa_studi), x.rata_lama_ta_bulan, pctNum(x.ujian_lulus_pertama, x.ujian_pertama_n), x.p1.ganjil, x.p1.genap, x.hari_review, x.berisiko] as Cell[];
      }),
    ],
  });
  for (const p of list) {
    const rows = d.masa_studi.filter((r) => r.prodi_id === p.id);
    const kolom = rows[0]?.lulus_per_ts.length ?? 0;
    const tsHead = Array.from({ length: kolom }, (_, i) => {
      const k = kolom - 1 - i;
      return `Lulus pada ${k ? `TS-${k}` : 'TS'}`;
    });
    sheets.push({
      name: `Masa studi ${p.kode}`,
      bold: [0, 2],
      widths: [16, 12, ...tsHead.map(() => 11), 14, 12, 14, 14, 11],
      rows: [
        [`Masa studi lulusan ${p.jenjang} ${p.nama}, TS ${ta(d.ts)}`],
        [],
        ['Tahun masuk', 'Jumlah diterima', ...tsHead, 'Lulusan s.d. akhir TS', 'Tepat waktu', 'Rata-rata masa studi (th)', 'Keberhasilan studi (%)', 'Masih aktif'],
        ...rows.map((r) => [`${r.k ? `TS-${r.k}` : 'TS'} (${ta(r.angkatan)})`, r.diterima, ...r.lulus_per_ts.map((n, i) => (kolom - 1 - i <= r.k ? n : null)), r.lulus, r.tepat, r.rata_masa_studi, pctNum(r.lulus, r.diterima), r.masih_aktif] as Cell[]),
      ],
    });
  }
  sheets.push({
    name: 'Pembimbingan',
    bold: [0],
    widths: [34, 12, 10, 10, 10, 10, 10, 10, 12, 10],
    rows: [
      ['Dosen', 'Homebase', 'P1 Ganjil', 'P1 Genap', 'P2 Ganjil', 'P2 Genap', 'Sesi selesai', 'Review bab', 'Tanggap (hari)', 'Penguji'],
      ...d.dosen.map((x) => [x.nama, x.homebase, x.p1_ganjil, x.p1_genap, x.p2_ganjil, x.p2_genap, x.sesi, x.n_review, x.hari_review, x.penguji] as Cell[]),
    ],
  });
  const ids = new Set(list.map((p) => p.id));
  sheets.push({
    name: 'Ujian',
    bold: [0],
    widths: [14, 32, 10, 18, 12],
    rows: [['Prodi', 'Ujian', 'Jumlah', 'Lulus percobaan pertama', 'Mengulang'], ...d.ujian.filter((u) => ids.has(u.prodi_id)).map((u) => [d.prodi.find((p) => p.id === u.prodi_id)?.kode, UJIAN_LABEL[u.jenis], u.n, u.lulus_pertama, u.mengulang] as Cell[])],
  });
  sheets.push({
    name: 'Berisiko',
    bold: [0],
    widths: [30, 14, 8, 10, 10, 10, 34],
    rows: [
      ['Nama', 'NIM', 'Prodi', 'Angkatan', 'Semester', 'Batas', 'Tahap sekarang'],
      ...d.berisiko.filter((b) => ids.has(b.prodi_id)).map((b) => [b.nama, b.nim, d.prodi.find((p) => p.id === b.prodi_id)?.kode, b.angkatan, b.semester, b.batas, b.status === 'cuti' ? 'Cuti' : b.tahap] as Cell[]),
    ],
  });
  void downloadXlsx(`simsa-akreditasi-TS${d.ts}${only ? `-${only.kode}` : ''}.xlsx`, sheets);
}

