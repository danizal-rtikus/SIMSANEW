import { Fragment, useState } from 'react';
import { useAsync } from '../../lib/useAsync';
import { must, supabase } from '../../lib/supabase';
import { fmtDateTime } from '../../lib/format';
import { ErrorNote, Loading, PageHeader, Panel } from '../../components/ui';

interface Log {
  id: number;
  aktor: string | null;
  aksi: string;
  entitas: string;
  entitas_id: string | null;
  sebelum: unknown;
  sesudah: unknown;
  created_at: string;
}

const ENTITAS = ['user_roles', 'profiles', 'thesis_supervisors', 'title_submissions', 'thesis_milestones', 'thesis'];

export function AuditLog() {
  const [entitas, setEntitas] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const st = useAsync(async () => {
    let q = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(300);
    if (entitas) q = q.eq('entitas', entitas);
    const logs = (await must(q)) as Log[];
    const ids = [...new Set(logs.map((l) => l.aktor).filter(Boolean))] as string[];
    const names = ids.length ? ((await must(supabase.from('profiles').select('id, nama').in('id', ids))) as { id: string; nama: string }[]) : [];
    return { logs, names: new Map(names.map((n) => [n.id, n.nama])) };
  }, [entitas]);

  return (
    <>
      <PageHeader title="Audit log" description="Aksi sensitif: perubahan peran, pembimbing, keputusan judul, tenggat, dan status studi. Menampilkan 300 entri terbaru." />
      <div className="row" style={{ marginBottom: 14 }}>
        <select style={{ maxWidth: 240 }} value={entitas} onChange={(e) => setEntitas(e.target.value)} aria-label="Entitas">
          <option value="">Semua entitas</option>
          {ENTITAS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </div>
      {st.loading && !st.data ? (
        <Loading />
      ) : st.error ? (
        <ErrorNote error={st.error} onRetry={st.reload} />
      ) : (
        <Panel flush>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Pelaku</th>
                  <th>Aksi</th>
                  <th>Entitas</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {st.data!.logs.map((l) => (
                  <Fragment key={l.id}>
                    <tr>
                      <td className="small mono-num" style={{ whiteSpace: 'nowrap' }}>
                        {fmtDateTime(l.created_at)}
                      </td>
                      <td className="small">{l.aktor ? st.data!.names.get(l.aktor) ?? l.aktor.slice(0, 8) : <span className="muted">Sistem</span>}</td>
                      <td>{l.aksi.replace(/_/g, ' ')}</td>
                      <td className="small">
                        {l.entitas}
                        {l.entitas_id && <div className="muted">{l.entitas_id.slice(0, 8)}</div>}
                      </td>
                      <td>
                        <button className="btn-link small" onClick={() => setOpen(open === l.id ? null : l.id)}>
                          {open === l.id ? 'Tutup' : 'Rincian'}
                        </button>
                      </td>
                    </tr>
                    {open === l.id && (
                      <tr>
                        <td colSpan={5} style={{ background: 'var(--surface-2)' }}>
                          <div className="grid-2">
                            <div>
                              <div className="label">Sebelum</div>
                              <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{l.sebelum ? JSON.stringify(l.sebelum, null, 2) : '—'}</pre>
                            </div>
                            <div>
                              <div className="label">Sesudah</div>
                              <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{l.sesudah ? JSON.stringify(l.sesudah, null, 2) : '—'}</pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
