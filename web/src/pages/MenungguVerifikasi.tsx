import { useState, type ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { useAsync } from '../lib/useAsync';
import { must, supabase } from '../lib/supabase';
import { rpc } from '../lib/queries';
import { fmtDateTime } from '../lib/format';
import { BRAND } from '../lib/brand';
import { Badge, Button, ErrorNote, Field, Loading } from '../components/ui';
import { useToast } from '../components/Toast';
import { AuthShell } from './Login';

interface Pendaftaran {
  nama: string;
  nim: string;
  prodi_id: string;
  prodi_nama: string;
  angkatan: number | null;
  email: string;
  telepon: string;
  status: 'menunggu' | 'disetujui' | 'ditolak';
  alasan: string | null;
  created_at: string;
  diputuskan_at: string | null;
}

/** Ditampilkan untuk akun yang sudah masuk tetapi belum memiliki peran. */
export function MenungguVerifikasi() {
  const { signOut, refresh, profile } = useAuth();
  const st = useAsync(async () => {
    const [rows, prodi] = await Promise.all([
      must(supabase.rpc('status_pendaftaran_saya')),
      must(supabase.from('prodi').select('id, nama, jenjang').order('jenjang').order('nama')),
    ]);
    return { req: ((rows ?? []) as Pendaftaran[])[0] ?? null, prodi: prodi as { id: string; nama: string; jenjang: string }[] };
  }, []);

  const keluar = (
    <Button variant="ghost" onClick={() => signOut()}>
      Keluar
    </Button>
  );

  if (st.loading && !st.data) return <AuthShell><Loading label="Memeriksa status akun" /></AuthShell>;
  if (st.error) return <AuthShell><ErrorNote error={st.error} onRetry={st.reload} /></AuthShell>;
  const r = st.data!.req;

  if (!r) {
    return (
      <AuthShell>
        <Head title="Akun Anda belum memiliki peran" />
        <p className="muted">Hubungi Admin {BRAND.app} agar akun {profile?.email ?? ''} diberi peran (mis. Mahasiswa atau Dosen) sebelum dapat memakai sistem.</p>
        <div className="row">{keluar}</div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <Head
        title={r.status === 'ditolak' ? 'Pendaftaran akun ditolak' : r.status === 'disetujui' ? 'Akun sudah diverifikasi' : 'Akun Anda menunggu verifikasi Admin'}
        badge={<Badge tone={r.status === 'ditolak' ? 'bad' : r.status === 'disetujui' ? 'ok' : 'info'}>{r.status === 'ditolak' ? 'Ditolak' : r.status === 'disetujui' ? 'Disetujui' : 'Menunggu verifikasi'}</Badge>}
      />
      {r.status === 'menunggu' && (
        <p className="muted">
          Admin memeriksa data Anda sebelum akun dapat dipakai. Setelah disetujui, buka kembali halaman ini atau klik Periksa ulang; menu SIMSA akan tampil.
        </p>
      )}
      {r.status === 'disetujui' && <p className="muted">Akun Anda sudah disetujui. Klik Lanjutkan untuk membuka SIMSA.</p>}
      {r.status === 'ditolak' && (
        <div className="note bad">
          <div className="strong small">Alasan dari Admin</div>
          {r.alasan}
        </div>
      )}

      {r.status === 'ditolak' ? (
        <PerbaikiForm r={r} prodi={st.data!.prodi} onDone={st.reload} />
      ) : (
        <dl className="kv auth-kv">
          <dt>Nama</dt>
          <dd>{r.nama}</dd>
          <dt>NIM</dt>
          <dd className="mono-num">{r.nim}</dd>
          <dt>Program studi</dt>
          <dd>{r.prodi_nama}</dd>
          <dt>Angkatan</dt>
          <dd>{r.angkatan ?? '-'}</dd>
          <dt>Email</dt>
          <dd>{r.email}</dd>
          <dt>Nomor HP</dt>
          <dd>{r.telepon}</dd>
          <dt>Didaftarkan</dt>
          <dd>{fmtDateTime(r.created_at)}</dd>
        </dl>
      )}

      <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
        {keluar}
        {r.status !== 'ditolak' && (
          <Button
            variant="primary"
            onClick={async () => {
              await refresh();
              st.reload();
            }}
          >
            {r.status === 'disetujui' ? 'Lanjutkan' : 'Periksa ulang'}
          </Button>
        )}
      </div>
    </AuthShell>
  );
}

function Head({ title, badge }: { title: string; badge?: ReactNode }) {
  return (
    <div className="auth-status-head">
      <img className="brand-logo" src={BRAND.logo} alt={`Logo ${BRAND.institution}`} />
      <div>
        <h2>{title}</h2>
        {badge}
      </div>
    </div>
  );
}

function PerbaikiForm({ r, prodi, onDone }: { r: Pendaftaran; prodi: { id: string; nama: string; jenjang: string }[]; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ nama: r.nama, nim: r.nim, prodi_id: r.prodi_id, telepon: r.telepon });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      await rpc('ajukan_ulang_pendaftaran', { p_nama: v.nama, p_nim: v.nim, p_prodi: v.prodi_id, p_telepon: v.telepon.replace(/[\s-]/g, '') });
      toast.show('Pendaftaran diajukan ulang', 'ok');
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack-sm">
      <p className="small muted" style={{ margin: 0 }}>
        Perbaiki data sesuai alasan di atas, lalu ajukan ulang. Email akun tetap {r.email}.
      </p>
      <Field label="Nama lengkap">
        <input value={v.nama} onChange={(e) => setV({ ...v, nama: e.target.value })} />
      </Field>
      <div className="auth-row">
        <Field label="NIM">
          <input inputMode="numeric" value={v.nim} onChange={(e) => setV({ ...v, nim: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="Program studi">
          <select value={v.prodi_id} onChange={(e) => setV({ ...v, prodi_id: e.target.value })}>
            {prodi.map((p) => (
              <option key={p.id} value={p.id}>
                {p.jenjang} {p.nama}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Nomor HP">
        <input type="tel" value={v.telepon} onChange={(e) => setV({ ...v, telepon: e.target.value })} />
      </Field>
      {err && <div className="note bad">{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button variant="primary" loading={busy} onClick={submit}>
          Ajukan ulang
        </Button>
      </div>
    </div>
  );
}
