import { useState } from 'react';
import { useAsync } from '../lib/useAsync';
import { must, supabase } from '../lib/supabase';
import { rpc } from '../lib/queries';
import { fmtDateTime } from '../lib/format';
import { Badge, Button, Field } from './ui';
import { Modal, useDialog } from './Dialog';
import { useToast } from './Toast';

export interface TitleRequest {
  id: string;
  thesis_id: string;
  judul_lama: string;
  judul_baru: string;
  alasan: string;
  status: 'diajukan' | 'disetujui' | 'ditolak' | 'dibatalkan';
  created_at: string;
  diputuskan_at: string | null;
  approvals: { dosen_id: string; peran: 'P1' | 'P2'; setuju: boolean; catatan: string | null; created_at: string }[];
}

export interface TitleDirection {
  exam_id: string;
  dosen_id: string;
  arahan_judul: string;
  nama: string;
  jenis: string;
  selesai: boolean;
}

/** Usulan judul, arahan penguji, dan apakah seminar pertama sudah lewat. */
export function useTitleRequests(thesisId: string) {
  return useAsync(async () => {
    const [reqs, ms, panel] = await Promise.all([
      must(supabase.from('title_change_requests').select('*').eq('thesis_id', thesisId).order('created_at', { ascending: false })),
      must(supabase.from('thesis_milestones').select('jenis, status').eq('thesis_id', thesisId).eq('jenis', 'ujian')),
      must(
        supabase
          .from('exam_panel')
          .select('exam_id, dosen_id, arahan_judul, ubah_judul, dosen:profiles!exam_panel_dosen_id_fkey(nama), exam:exams(jenis, revisi_selesai_at)')
          .eq('thesis_id', thesisId)
          .eq('ubah_judul', true),
      ),
    ]);
    const list = reqs as Omit<TitleRequest, 'approvals'>[];
    const ids = list.map((r) => r.id);
    const approvals = ids.length
      ? ((await must(supabase.from('title_change_approvals').select('request_id, dosen_id, peran, setuju, catatan, created_at').in('request_id', ids))) as (TitleRequest['approvals'][number] & { request_id: string })[])
      : [];
    const requests: TitleRequest[] = list.map((r) => ({ ...r, approvals: approvals.filter((a) => a.request_id === r.id) }));
    const directions: TitleDirection[] = (panel as any[]).map((p) => ({
      exam_id: p.exam_id,
      dosen_id: p.dosen_id,
      arahan_judul: p.arahan_judul ?? '',
      nama: p.dosen?.nama ?? 'Penguji',
      jenis: p.exam?.jenis ?? '',
      selesai: !!p.exam?.revisi_selesai_at,
    }));
    return {
      requests,
      pending: requests.find((r) => r.status === 'diajukan') ?? null,
      sudahSeminar: (ms as { status: string }[]).some((m) => m.status === 'selesai'),
      directions,
    };
  }, [thesisId]);
}

const STATUS: Record<TitleRequest['status'], { label: string; tone: 'info' | 'ok' | 'bad' | 'neutral' }> = {
  diajukan: { label: 'Menunggu persetujuan', tone: 'info' },
  disetujui: { label: 'Disetujui', tone: 'ok' },
  ditolak: { label: 'Ditolak', tone: 'bad' },
  dibatalkan: { label: 'Dibatalkan', tone: 'neutral' },
};

function ApprovalChips({ r }: { r: TitleRequest }) {
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      {(['P1', 'P2'] as const).map((p) => {
        const a = r.approvals.find((x) => x.peran === p);
        return (
          <Badge key={p} tone={a ? (a.setuju ? 'ok' : 'bad') : 'neutral'}>
            {p}: {a ? (a.setuju ? 'Setuju' : 'Menolak') : 'Belum menanggapi'}
          </Badge>
        );
      })}
    </div>
  );
}

/** Arahan perubahan judul dari penguji yang revisinya belum selesai. */
export function TitleDirections({ list }: { list: TitleDirection[] }) {
  const open = list.filter((d) => !d.selesai);
  if (!open.length) return null;
  return (
    <div className="note warn">
      <div className="strong small">Penguji meminta perubahan judul</div>
      <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {open.map((d) => (
          <li key={`${d.exam_id}-${d.dosen_id}`}>
            {d.arahan_judul} <span className="muted">({d.nama})</span>
          </li>
        ))}
      </ul>
      <div className="small muted" style={{ marginTop: 6 }}>
        Ajukan judul baru di bawah. Revisi seminar dinyatakan selesai setelah judul baru disetujui Pembimbing 1 dan 2.
      </div>
    </div>
  );
}

/** Daftar usulan judul. Mahasiswa dapat membatalkan, pembimbing dapat menyetujui atau menolak. */
export function TitleRequestList({
  requests,
  mode,
  myId,
  onChanged,
}: {
  requests: TitleRequest[];
  mode: 'mahasiswa' | 'pembimbing' | 'baca';
  myId: string | null;
  onChanged: () => void;
}) {
  const dialog = useDialog();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!requests.length) return null;

  const act = async (r: TitleRequest, kind: 'setuju' | 'tolak' | 'batal') => {
    let catatan: string | null = null;
    if (kind === 'tolak') {
      catatan = await dialog.prompt({ title: 'Tolak usulan judul', label: 'Alasan penolakan', multiline: true, required: true, confirmLabel: 'Tolak usulan' });
      if (catatan === null) return;
    } else if (kind === 'setuju') {
      const ok = await dialog.confirm({
        title: 'Setujui judul baru?',
        message: `"${r.judul_baru}". Judul berlaku setelah Pembimbing 1 dan Pembimbing 2 sama-sama setuju.`,
        confirmLabel: 'Setujui',
      });
      if (!ok) return;
    } else {
      const ok = await dialog.confirm({ title: 'Batalkan usulan judul?', message: 'Usulan ditarik dan pembimbing tidak perlu menanggapinya.', confirmLabel: 'Batalkan usulan', danger: true });
      if (!ok) return;
    }
    setBusy(r.id);
    try {
      if (kind === 'batal') await rpc('batalkan_usul_judul', { p_id: r.id });
      else {
        const res = await rpc<string>('tanggapi_usul_judul', { p_id: r.id, p_setuju: kind === 'setuju', p_catatan: catatan });
        toast.show(res === 'disetujui' ? 'Judul baru berlaku' : res === 'ditolak' ? 'Usulan ditolak' : 'Persetujuan tercatat, menunggu pembimbing lainnya', 'ok');
      }
      onChanged();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="list title-req">
      {requests.map((r) => {
        const mine = r.approvals.find((a) => a.dosen_id === myId);
        return (
          <li key={r.id}>
            <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="strong">{r.judul_baru}</div>
                <div className="small muted">
                  Sebelumnya: {r.judul_lama}. Diajukan {fmtDateTime(r.created_at)}.
                </div>
                <div className="small" style={{ marginTop: 4 }}>
                  Alasan: {r.alasan}
                </div>
                {r.approvals
                  .filter((a) => a.catatan)
                  .map((a) => (
                    <div key={a.dosen_id} className="small muted">
                      Catatan {a.peran}: {a.catatan}
                    </div>
                  ))}
              </div>
              <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
            </div>
            {r.status === 'diajukan' && (
              <div className="row-between" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
                <ApprovalChips r={r} />
                <div className="row" style={{ gap: 6 }}>
                  {mode === 'mahasiswa' && (
                    <Button size="sm" variant="ghost" loading={busy === r.id} onClick={() => act(r, 'batal')}>
                      Batalkan usulan
                    </Button>
                  )}
                  {mode === 'pembimbing' && !mine?.setuju && (
                    <>
                      <Button size="sm" loading={busy === r.id} onClick={() => act(r, 'tolak')}>
                        Tolak
                      </Button>
                      <Button size="sm" variant="primary" loading={busy === r.id} onClick={() => act(r, 'setuju')}>
                        Setujui judul
                      </Button>
                    </>
                  )}
                  {mode === 'pembimbing' && mine?.setuju && <span className="small muted">Anda sudah menyetujui</span>}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Formulir usulan judul baru (setelah seminar). */
export function ProposeTitleModal({ open, thesisId, current, onClose, onDone }: { open: boolean; thesisId: string; current: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [judul, setJudul] = useState(current);
  const [alasan, setAlasan] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      await rpc('usul_judul', { p_thesis: thesisId, p_judul: judul.trim(), p_alasan: alasan.trim() });
      toast.show('Usulan judul dikirim ke Pembimbing 1 dan 2', 'ok');
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Usulkan judul baru"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Kirim usulan
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <p className="small muted" style={{ margin: 0 }}>
          Setelah seminar, judul berubah lewat usulan. Judul baru berlaku setelah Pembimbing 1 dan Pembimbing 2 sama-sama menyetujui.
        </p>
        <Field label="Judul baru">
          <textarea style={{ minHeight: 70 }} value={judul} onChange={(e) => setJudul(e.target.value)} />
        </Field>
        <Field label="Alasan perubahan" hint="mis. arahan penguji Seminar Proposal">
          <textarea style={{ minHeight: 60 }} value={alasan} onChange={(e) => setAlasan(e.target.value)} />
        </Field>
        {err && <div className="note bad">{err}</div>}
      </div>
    </Modal>
  );
}
