import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { must, supabase } from '../../lib/supabase';
import { fmtDateTime } from '../../lib/format';
import { Badge, ErrorNote, Facts, Loading, PageHeader, Panel, Tabs } from '../../components/ui';

interface Row {
  id: number;
  user_id: string | null;
  peran: 'mahasiswa' | 'dosen';
  thesis_id: string | null;
  fitur: string;
  model: string | null;
  token_masuk: number;
  token_keluar: number;
  durasi_ms: number;
  status: 'ok' | 'gagal' | 'ditolak';
  galat: string | null;
  cuplikan: string | null;
  created_at: string;
}

const FITUR: Record<string, string> = {
  parafrase: 'Parafrase',
  susun: 'Susun paragraf',
  cari_jurnal: 'Cari jurnal',
  periksa_bab: 'Periksa bab',
  review_bab: 'Review bab (dosen)',
};

const STATUS: Record<Row['status'], { label: string; tone: 'ok' | 'bad' | 'warn' }> = {
  ok: { label: 'Berhasil', tone: 'ok' },
  gagal: { label: 'Gagal', tone: 'bad' },
  ditolak: { label: 'Ditolak', tone: 'warn' },
};

const fmt = (n: number) => n.toLocaleString('id-ID');

/** Catatan pemakaian AISYS. Hanya Admin (dijaga RLS ai_usage_logs). */
export function AisysLog() {
  const [hari, setHari] = useState(7);
  const [fitur, setFitur] = useState('');
  const [peran, setPeran] = useState('');
  const [view, setView] = useState<'pengguna' | 'riwayat'>('pengguna');
  const [open, setOpen] = useState<number | null>(null);

  const st = useAsync(async () => {
    const since = new Date(Date.now() - hari * 86400_000).toISOString();
    let q = supabase.from('ai_usage_logs').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(2000);
    if (fitur) q = q.eq('fitur', fitur);
    if (peran) q = q.eq('peran', peran);
    const rows = (await must(q)) as Row[];
    const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
    const people = ids.length ? ((await must(supabase.from('profiles').select('id, nama, nim').in('id', ids))) as { id: string; nama: string; nim: string | null }[]) : [];
    return { rows, people: new Map(people.map((p) => [p.id, p])) };
  }, [hari, fitur, peran]);

  const agg = useMemo(() => {
    const rows = st.data?.rows ?? [];
    const per = new Map<string, { user_id: string; peran: string; n: number; gagal: number; tin: number; tout: number; fitur: Map<string, number>; last: string; thesis: string | null }>();
    for (const r of rows) {
      const k = r.user_id ?? 'x';
      const a = per.get(k) ?? { user_id: k, peran: r.peran, n: 0, gagal: 0, tin: 0, tout: 0, fitur: new Map(), last: r.created_at, thesis: r.thesis_id };
      a.n++;
      if (r.status !== 'ok') a.gagal++;
      a.tin += r.token_masuk;
      a.tout += r.token_keluar;
      a.fitur.set(r.fitur, (a.fitur.get(r.fitur) ?? 0) + 1);
      per.set(k, a);
    }
    const ok = rows.filter((r) => r.status === 'ok');
    return {
      total: rows.length,
      ok: ok.length,
      gagal: rows.filter((r) => r.status === 'gagal').length,
      ditolak: rows.filter((r) => r.status === 'ditolak').length,
      pengguna: per.size,
      tin: rows.reduce((s, r) => s + r.token_masuk, 0),
      tout: rows.reduce((s, r) => s + r.token_keluar, 0),
      durasi: ok.length ? Math.round(ok.reduce((s, r) => s + r.durasi_ms, 0) / ok.length / 100) / 10 : 0,
      per: [...per.values()].sort((a, b) => b.n - a.n),
    };
  }, [st.data]);

  const name = (id: string | null) => {
    const p = id ? st.data?.people.get(id) : undefined;
    return p ? (
      <>
        {p.nama}
        {p.nim && <div className="muted small">{p.nim}</div>}
      </>
    ) : (
      <span className="muted">Pengguna dihapus</span>
    );
  };

  return (
    <>
      <PageHeader title="Log AISYS" description="Pemakaian AISYS oleh mahasiswa dan dosen. Hanya Admin yang dapat melihat halaman ini. Isi naskah dan jawaban AISYS tidak disimpan, hanya cuplikan pendek masukan." />
      <div className="row filterbar">
        <select style={{ maxWidth: 180 }} value={hari} onChange={(e) => setHari(Number(e.target.value))} aria-label="Periode">
          <option value={1}>24 jam terakhir</option>
          <option value={7}>7 hari terakhir</option>
          <option value={30}>30 hari terakhir</option>
          <option value={90}>90 hari terakhir</option>
        </select>
        <select style={{ maxWidth: 200 }} value={fitur} onChange={(e) => setFitur(e.target.value)} aria-label="Fitur">
          <option value="">Semua fitur</option>
          {Object.entries(FITUR).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select style={{ maxWidth: 160 }} value={peran} onChange={(e) => setPeran(e.target.value)} aria-label="Peran">
          <option value="">Semua peran</option>
          <option value="mahasiswa">Mahasiswa</option>
          <option value="dosen">Dosen</option>
        </select>
      </div>
      {st.loading && !st.data ? (
        <Loading variant="page" />
      ) : st.error ? (
        <ErrorNote error={st.error} onRetry={st.reload} />
      ) : (
        <div className="stack">
          <Facts
            items={[
              { label: 'Pemakaian', value: fmt(agg.total), note: `${fmt(agg.ok)} berhasil` },
              { label: 'Pengguna', value: fmt(agg.pengguna) },
              { label: 'Token', value: fmt(agg.tin + agg.tout), note: `${fmt(agg.tin)} masuk, ${fmt(agg.tout)} keluar` },
              { label: 'Rata-rata durasi', value: `${agg.durasi.toLocaleString('id-ID')} dtk` },
              { label: 'Gagal / ditolak', value: `${fmt(agg.gagal)} / ${fmt(agg.ditolak)}`, note: 'Ditolak = melewati batas harian' },
            ]}
          />
          <Tabs
            value={view}
            onChange={setView}
            items={[
              { value: 'pengguna', label: 'Per pengguna' },
              { value: 'riwayat', label: 'Riwayat' },
            ]}
          />
          {agg.total === 0 ? (
            <Panel>
              <p className="muted" style={{ margin: 0 }}>
                Belum ada pemakaian pada periode ini.
              </p>
            </Panel>
          ) : view === 'pengguna' ? (
            <Panel flush>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Pengguna</th>
                      <th>Peran</th>
                      <th className="num">Pemakaian</th>
                      <th>Fitur</th>
                      <th className="num">Token</th>
                      <th>Terakhir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agg.per.map((a) => (
                      <tr key={a.user_id}>
                        <td>
                          {a.thesis && a.peran === 'mahasiswa' ? <Link to={`/mahasiswa-bimbingan/${a.thesis}`}>{name(a.user_id)}</Link> : name(a.user_id)}
                        </td>
                        <td className="small">{a.peran === 'dosen' ? 'Dosen' : 'Mahasiswa'}</td>
                        <td className="num mono-num">
                          {fmt(a.n)}
                          {a.gagal ? <div className="muted small">{a.gagal} tidak berhasil</div> : null}
                        </td>
                        <td className="small">
                          {[...a.fitur.entries()]
                            .sort((x, y) => y[1] - x[1])
                            .map(([f, n]) => `${FITUR[f] ?? f} ${n}`)
                            .join(', ')}
                        </td>
                        <td className="num mono-num small">{fmt(a.tin + a.tout)}</td>
                        <td className="small mono-num" style={{ whiteSpace: 'nowrap' }}>
                          {fmtDateTime(a.last)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : (
            <Panel flush>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Pengguna</th>
                      <th>Fitur</th>
                      <th>Status</th>
                      <th className="num">Token</th>
                      <th className="num">Durasi</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {st.data!.rows.slice(0, 500).map((r) => (
                      <tr key={r.id}>
                        <td className="small mono-num" style={{ whiteSpace: 'nowrap' }}>
                          {fmtDateTime(r.created_at)}
                        </td>
                        <td className="small">
                          {name(r.user_id)}
                          <div className="muted small">{r.peran === 'dosen' ? 'Dosen' : 'Mahasiswa'}</div>
                        </td>
                        <td className="small">{FITUR[r.fitur] ?? r.fitur}</td>
                        <td>
                          <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                        </td>
                        <td className="num mono-num small">{r.token_masuk + r.token_keluar ? fmt(r.token_masuk + r.token_keluar) : '-'}</td>
                        <td className="num mono-num small">{r.durasi_ms ? `${(r.durasi_ms / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} dtk` : '-'}</td>
                        <td>
                          {(r.cuplikan || r.galat) && (
                            <button className="btn-link small" onClick={() => setOpen(open === r.id ? null : r.id)}>
                              {open === r.id ? 'Tutup' : 'Rincian'}
                            </button>
                          )}
                          {open === r.id && (
                            <div className="small" style={{ marginTop: 6, maxWidth: 320 }}>
                              {r.cuplikan && <div className="muted">Masukan: {r.cuplikan}</div>}
                              {r.galat && <div style={{ color: 'var(--bad)' }}>{r.galat}</div>}
                              {r.model && <div className="muted">Model: {r.model}</div>}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {st.data!.rows.length > 500 && <p className="muted small" style={{ padding: '8px 12px', margin: 0 }}>Menampilkan 500 dari {fmt(st.data!.rows.length)} entri. Persempit periode atau filter.</p>}
            </Panel>
          )}
        </div>
      )}
    </>
  );
}
