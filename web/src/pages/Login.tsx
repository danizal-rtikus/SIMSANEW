import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { supabase, translateError } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Button, Field } from '../components/ui';
import { useDialog } from '../components/Dialog';
import { IconMoon, IconSun } from '../components/Icons';
import { BRAND } from '../lib/brand';
import { applyTheme, readTheme } from '../lib/theme';

const STEPS = [
  ['Pendaftaran dan sinopsis', 'Mahasiswa'],
  ['Ploting pembimbing dan penguji', 'Ka. Prodi'],
  ['ACC bab oleh P1 dan P2', 'Dosen'],
  ['Seminar, sidang, dan revisi', 'Panel'],
  ['Berkas, yudisium, dan SK', 'BAAK'],
];

export function Login() {
  const { session, loading } = useAuth();
  const dialog = useDialog();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState(readTheme());

  if (!loading && session) return <Navigate to={location.state?.from || '/'} replace />;

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
      label: 'Email institusi',
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
    <div className="auth">
      <div className="auth-side">
        <div>
          <div className="auth-brand">
            <img className="brand-logo lg" src={BRAND.logo} alt={`Logo ${BRAND.institution}`} />
            <span>
              {BRAND.app}
              <br />
              <span className="auth-inst">{BRAND.institution}</span>
            </span>
          </div>
          <h1>Manajemen studi akhir</h1>
          <p className="lead">Pendaftaran, bimbingan, ujian, dan progres skripsi atau tugas akhir tercatat di satu tempat.</p>
          <ol className="auth-steps">
            {STEPS.map(([s, who], i) => (
              <li key={s}>
                <span>{i + 1}</span>
                <span>{s}</span>
                <em>{who}</em>
              </li>
            ))}
          </ol>
        </div>
        <p className="small muted">
          Gunakan akun institusi yang diberikan Admin.
        </p>
      </div>
      <div className="auth-form">
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
        <form onSubmit={submit} noValidate>
          <h2>Masuk</h2>
          <Field label="Email">
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Kata sandi">
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <div className="note bad">{error}</div>}
          <Button type="submit" variant="primary" loading={busy} disabled={!email || !password}>
            Masuk
          </Button>
          <button type="button" className="btn-link" onClick={forgot} style={{ alignSelf: 'flex-start' }}>
            Lupa kata sandi?
          </button>
        </form>
      </div>
    </div>
  );
}
