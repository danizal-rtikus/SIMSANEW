import { useNavigate } from 'react-router-dom';
import { useAsync } from '../lib/useAsync';
import { must, supabase } from '../lib/supabase';
import { rpc } from '../lib/queries';
import { fmtDateTime } from '../lib/format';
import type { Notification } from '../lib/types';
import { Button, Empty, ErrorNote, Loading, PageHeader, Panel } from '../components/ui';
import { useToast } from '../components/Toast';

export function Notifikasi() {
  const navigate = useNavigate();
  const toast = useToast();
  const st = useAsync(async () => (await must(supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100))) as Notification[], []);
  const unread = (st.data ?? []).filter((n) => !n.dibaca_at).length;

  const markAll = async () => {
    try {
      await rpc('baca_notifikasi', { p_id: null });
      window.dispatchEvent(new Event('simsa:notif-read'));
      st.reload();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };
  const open = async (n: Notification) => {
    if (!n.dibaca_at) {
      await rpc('baca_notifikasi', { p_id: n.id }).catch(() => undefined);
      window.dispatchEvent(new Event('simsa:notif-read'));
    }
    if (n.tautan) navigate(n.tautan);
    else st.reload();
  };

  return (
    <>
      <PageHeader title="Notifikasi" description={unread ? `${unread} belum dibaca` : 'Semua notifikasi sudah dibaca'} actions={unread > 0 && <Button onClick={markAll}>Tandai semua dibaca</Button>} />
      {st.loading && !st.data ? (
        <Loading variant="table" />
      ) : st.error ? (
        <ErrorNote error={st.error} onRetry={st.reload} />
      ) : (st.data ?? []).length === 0 ? (
        <Panel>
          <Empty title="Belum ada notifikasi">Pengajuan, jawaban dosen, dan perubahan status akan muncul di sini.</Empty>
        </Panel>
      ) : (
        <Panel flush>
          <ul className="list">
            {st.data!.map((n) => (
              <li key={n.id} className={n.dibaca_at ? '' : 'unread'}>
                <button className="btn-link" style={{ color: 'inherit', textAlign: 'left', width: '100%' }} onClick={() => open(n)}>
                  <div className="row-between">
                    <span className="strong">{n.judul}</span>
                    <span className="muted small">{fmtDateTime(n.created_at)}</span>
                  </div>
                  {n.isi && <div className="small" style={{ marginTop: 2 }}>{n.isi}</div>}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
