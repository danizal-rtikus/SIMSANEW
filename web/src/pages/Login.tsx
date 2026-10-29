import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, translateError } from '../lib/supabase';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Field } from '../components/ui';
import { useDialog } from '../components/Dialog';
import { IconEye, IconEyeOff, IconMoon, IconSun } from '../components/Icons';
import { BRAND } from '../lib/brand';
import { applyTheme, readTheme } from '../lib/theme';

/** Fase studi akhir beserta cuplikan layar (web/public/alur/<kunci>-terang|gelap.webp). */
const FASE = [
  { kunci: 'persiapan', nama: 'Persiapan', ringkas: 'Pendaftaran dan penetapan pembimbing', isi: 'Mahasiswa mengajukan judul dan sinopsis. Tim Komisi Tugas Akhir menerima pendaftaran sekaligus menetapkan Pembimbing 1 dan 2 melalui Rapat.' },
  { kunci: 'proposal', nama: 'Proposal', ringkas: 'Bab 1 sampai Bab 3, Seminar Proposal', isi: 'Naskah ditulis langsung di SIMSA dan diajukan per bab. Pembimbing memberi catatan tepat pada kalimat yang dimaksud.' },
  { kunci: 'hasil', nama: 'Skripsi/Hasil', ringkas: 'Bab 4 dan 5, Seminar Hasil', isi: 'Sitasi dan daftar pustaka bisa disusun otomatis dari Pustaka. Bab yang sudah di-ACC kedua pembimbing terekam.' },
  { kunci: 'pendadaran', nama: 'Pendadaran', ringkas: 'Berkas dan sidang akhir', isi: 'Jadwal, panel penguji, penilaian, dan berita acara tercatat dalam satu halaman ujian.' },
  { kunci: 'kelulusan', nama: 'Kelulusan', ringkas: 'Yudisium dan SK Kelulusan', isi: 'Tahap kelulusan diverifikasi dan divalidasi oleh BAAK dan disahkan melalui Rapat Komisi Tugas Akhir dalam bentuk SK Kelulusan, dengan riwayat yang dapat ditelusuri.' },
];

/** Alur studi akhir: pilih fase untuk melihat cuplikan layarnya. Berganti otomatis bila tidak sedang dipakai. */
function AlurStudi({ theme }: { theme: 'light' | 'dark' }) {
  const [i, setI] = useState(0);
  const [jeda, setJeda] = useState(false);
  const [diam] = useState(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (jeda || diam) return;
    const t = window.setTimeout(() => setI((x) => (x + 1) % FASE.length), 6500);
    return () => window.clearTimeout(t);
  }, [i, jeda, diam]);
  const f = FASE[i];
  const tema = theme === 'dark' ? 'gelap' : 'terang';
  return (
    <section className="alur" aria-labelledby="alur-judul" onMouseEnter={() => setJeda(true)} onMouseLeave={() => setJeda(false)} onFocus={() => setJeda(true)} onBlur={() => setJeda(false)}>
      <h2 id="alur-judul">Alur studi akhir</h2>
      <div className="alur-steps" role="tablist" aria-label="Fase studi akhir">
        {FASE.map((x, k) => (
          <button
            key={x.kunci}
            type="button"
            role="tab"
            id={`alur-tab-${x.kunci}`}
            aria-selected={k === i}
            aria-controls="alur-panel"
            className={`alur-step ${k === i ? 'on' : ''} ${k < i ? 'lewat' : ''}`}
            onClick={() => setI(k)}
          >
            <span className="alur-no">{k + 1}</span>
            <span className="alur-nama">{x.nama}</span>
          </button>
        ))}
      </div>
      <div className="alur-panel" id="alur-panel" role="tabpanel" aria-labelledby={`alur-tab-${f.kunci}`}>
        <h3>
          {f.nama} <span className="alur-ringkas">{f.ringkas}</span>
        </h3>
        <p>{f.isi}</p>
        <div className="alur-shot">
          {FASE.map((x, k) => (
            <img key={x.kunci} src={`/alur/${x.kunci}-${tema}.webp`} alt={k === i ? `Cuplikan layar SIMSA, fase ${x.nama}` : ''} aria-hidden={k !== i} className={k === i ? 'on' : ''} width={1040} height={650} decoding="async" />
          ))}
        </div>
      </div>
    </section>
  );
}

type Mode = 'masuk' | 'daftar';

export function Login() {
  const { session, loading } = useAuth();
  const location = useLocation() as { state?: { from?: string } };
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get('mode') === 'daftar' ? 'daftar' : 'masuk';
  const setMode = (m: Mode) => setParams(new URLSearchParams(m === 'daftar' ? { mode: 'daftar' } : {}), { replace: true });
  const [theme, setTheme] = useState(readTheme());

  if (!loading && session) return <Navigate to={location.state?.from || '/'} replace />;

  return (
    <div className="auth">
      <div className="auth-shell">
        <section className="auth-info" aria-label={BRAND.appLong}>
          <button
            type="button"
            className="icon-btn theme-btn auth-theme"
            onClick={() => {
              const next = theme === 'dark' ? 'light' : 'dark';
              applyTheme(next);
              setTheme(next);
            }}
            aria-label={theme === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap'}
            title={theme === 'dark' ? 'Tema terang' : 'Tema gelap'}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
          <div className="auth-inner">
            <p className="auth-eyebrow">
              {BRAND.app} <span aria-hidden>·</span> {BRAND.institutionLong}
            </p>
            <div className="auth-head">
              <h1>{BRAND.appLong}</h1>
              <p className="lead">Pendaftaran, bimbingan, naskah, ujian, dan kelulusan skripsi atau tugas akhir tercatat dan disahkan di satu tempat.</p>
            </div>
            <AlurStudi theme={theme} />
            <p className="auth-foot">
              &copy; {new Date().getFullYear()} {BRAND.institutionLong}
            </p>
          </div>
        </section>
        <section className="auth-visual">
          <img className="auth-visual-img" src="/kampus.jpg" alt={`Gedung kampus ${BRAND.institution}`} />
          <div className="auth-stack">
            <img className="auth-visual-logo" src={BRAND.logo} alt={`Logo ${BRAND.institution}`} />
            <div className="auth-card">
              <div className="auth-tabs" role="tablist" aria-label="Masuk atau daftar">
                <button type="button" role="tab" aria-selected={mode === 'masuk'} className={mode === 'masuk' ? 'on' : ''} onClick={() => setMode('masuk')}>
                  Masuk
                </button>
                <button type="button" role="tab" aria-selected={mode === 'daftar'} className={mode === 'daftar' ? 'on' : ''} onClick={() => setMode('daftar')}>
                  Daftar akun
                </button>
              </div>
              {mode === 'masuk' ? <MasukForm onDaftar={() => setMode('daftar')} /> : <DaftarForm onMasuk={() => setMode('masuk')} />}
            </div>
          </div>
          <span className="auth-visual-cap">Kampus {BRAND.institution}</span>
        </section>
      </div>
    </div>
  );
}

function PasswordInput({ value, onChange, autoComplete, id }: { value: string; onChange: (v: string) => void; autoComplete: string; id?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-field">
      <input id={id} type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} required />
      <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-label={show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'} title={show ? 'Sembunyikan' : 'Tampilkan'}>
        {show ? <IconEyeOff size={17} /> : <IconEye size={17} />}
      </button>
    </div>
  );
}

function MasukForm({ onDaftar }: { onDaftar: () => void }) {
  const dialog = useDialog();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setError(translateError(error.message));
    navigate(location.state?.from || '/', { replace: true });
  };

  const forgot = async () => {
    const addr = await dialog.prompt({
      title: 'Atur ulang kata sandi',
      message: 'Kami akan mengirim tautan untuk membuat kata sandi baru ke email Anda.',
      label: 'Email akun',
      initial: email,
      required: true,
      confirmLabel: 'Kirim tautan',
    });
    if (!addr) return;
    const { error } = await supabase.auth.resetPasswordForEmail(addr, { redirectTo: `${window.location.origin}/reset-password` });
    await dialog.alert({
      title: error ? 'Tautan tidak terkirim' : 'Periksa email Anda',
      message: error ? translateError(error.message) : `Jika ${addr} terdaftar, tautan atur ulang kata sandi sudah dikirim.`,
    });
  };

  return (
    <form onSubmit={submit} noValidate className="auth-fields">
      <div>
        <h2>Masuk ke {BRAND.app}</h2>
        <p className="muted small">Gunakan email dan kata sandi akun Anda.</p>
      </div>
      <Field label="Email">
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label="Kata sandi">
        <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
      </Field>
      {error && <div className="note bad">{error}</div>}
      <Button type="submit" variant="primary" loading={busy} disabled={!email || !password}>
        Masuk
      </Button>
      <div className="auth-links">
        <button type="button" className="btn-link" onClick={forgot}>
          Lupa kata sandi?
        </button>
        <span className="muted small">
          Mahasiswa baru?{' '}
          <button type="button" className="btn-link" onClick={onDaftar}>
            Daftar akun
          </button>
        </span>
      </div>
    </form>
  );
}

interface ProdiOpt {
  id: string;
  kode: string;
  nama: string;
  jenjang: string;
}

function angkatanDari(nim: string): number | null {
  const y = Number(nim.slice(0, 4));
  return /^[0-9]{4}/.test(nim) && y >= 1990 && y <= new Date().getFullYear() + 1 ? y : null;
}

function DaftarForm({ onMasuk }: { onMasuk: () => void }) {
  const navigate = useNavigate();
  const [prodi, setProdi] = useState<ProdiOpt[] | null>(null);
  const [v, setV] = useState({ nama: '', nim: '', prodi_id: '', email: '', telepon: '', password: '', ulang: '' });
  const [setuju, setSetuju] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ data: ProdiOpt[] }>('/daftar/prodi')
      .then((r) => setProdi(r.data))
      .catch((e) => setError((e as Error).message));
  }, []);

  const angkatan = angkatanDari(v.nim);
  const errs = useMemo(() => {
    const e: Partial<Record<keyof typeof v, string>> = {};
    if (v.nama.trim().length < 3) e.nama = 'Isi nama lengkap sesuai data kampus';
    if (!/^[0-9]{6,20}$/.test(v.nim)) e.nim = 'NIM hanya berisi angka (6 sampai 20 digit)';
    if (!v.prodi_id) e.prodi_id = 'Pilih program studi';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = 'Format email tidak valid';
    if (!/^\+?[0-9]{8,15}$/.test(v.telepon.replace(/[\s-]/g, ''))) e.telepon = 'Nomor HP 8 sampai 15 angka';
    if (v.password.length < 8) e.password = 'Minimal 8 karakter';
    if (v.ulang !== v.password) e.ulang = 'Kata sandi tidak sama';
    return e;
  }, [v]);
  const set = (k: keyof typeof v) => (val: string) => setV((x) => ({ ...x, [k]: val }));
  const err = (k: keyof typeof v) => (touched ? errs[k] : null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (Object.keys(errs).length) return;
    if (!setuju) return setError('Centang pernyataan bahwa data yang Anda isi benar.');
    setBusy(true);
    try {
      await api('/daftar', { body: { nama: v.nama, nim: v.nim, prodi_id: v.prodi_id, email: v.email, telepon: v.telepon, password: v.password } });
      const { error: inErr } = await supabase.auth.signInWithPassword({ email: v.email.trim(), password: v.password });
      if (inErr) {
        onMasuk();
        return;
      }
      navigate('/', { replace: true });
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => {
    const m = new Map<string, ProdiOpt[]>();
    for (const p of prodi ?? []) m.set(p.jenjang, [...(m.get(p.jenjang) ?? []), p]);
    return [...m.entries()];
  }, [prodi]);

  return (
    <form onSubmit={submit} noValidate className="auth-fields">
      <div>
        <h2>Daftar akun mahasiswa</h2>
        <p className="muted small">Akun dapat dipakai setelah diverifikasi Admin. Dosen dan staf mendapat akun dari Admin.</p>
      </div>
      <Field label="Nama lengkap" error={err('nama')}>
        <input autoComplete="name" value={v.nama} onChange={(e) => set('nama')(e.target.value)} />
      </Field>
      <div className="auth-row">
        <Field label="NIM" error={err('nim')} hint={angkatan ? `Angkatan ${angkatan}` : 'Angkatan dibaca dari 4 digit pertama NIM'}>
          <input inputMode="numeric" value={v.nim} onChange={(e) => set('nim')(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="Program studi" error={err('prodi_id')}>
          <select value={v.prodi_id} onChange={(e) => set('prodi_id')(e.target.value)} disabled={!prodi}>
            <option value="">{prodi ? 'Pilih prodi' : 'Memuat'}</option>
            {groups.map(([jenjang, list]) => (
              <optgroup key={jenjang} label={jenjang}>
                {list.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nama}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
      </div>
      <div className="auth-row">
        <Field label="Email" error={err('email')}>
          <input type="email" autoComplete="email" value={v.email} onChange={(e) => set('email')(e.target.value)} />
        </Field>
        <Field label="Nomor HP" error={err('telepon')}>
          <input type="tel" inputMode="tel" autoComplete="tel" value={v.telepon} onChange={(e) => set('telepon')(e.target.value)} placeholder="08xxxxxxxxxx" />
        </Field>
      </div>
      <div className="auth-row">
        <Field label="Kata sandi" error={err('password')} hint="Minimal 8 karakter">
          <PasswordInput value={v.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        <Field label="Ulangi kata sandi" error={err('ulang')}>
          <PasswordInput value={v.ulang} onChange={set('ulang')} autoComplete="new-password" />
        </Field>
      </div>
      <label className="check small">
        <input type="checkbox" checked={setuju} onChange={(e) => setSetuju(e.target.checked)} />
        Data yang saya isi benar dan milik saya sendiri.
      </label>
      {error && <div className="note bad">{error}</div>}
      <Button type="submit" variant="primary" loading={busy}>
        Daftar
      </Button>
      <div className="auth-links">
        <span className="muted small">
          Sudah punya akun?{' '}
          <button type="button" className="btn-link" onClick={onMasuk}>
            Masuk
          </button>
        </span>
      </div>
    </form>
  );
}

/** Bingkai sederhana untuk halaman status akun (dipakai halaman menunggu verifikasi). */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-solo">
      <div className="auth-card wide">{children}</div>
    </div>
  );
}
