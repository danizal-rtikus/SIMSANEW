import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, translateError } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Button, Field } from '../components/ui';
import { useToast } from '../components/Toast';

export function ResetPassword() {
  const { session, clearRecovery } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return setError('Kata sandi minimal 8 karakter');
    if (pw !== pw2) return setError('Konfirmasi kata sandi tidak sama');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setError(translateError(error.message));
    clearRecovery();
    toast.show('Kata sandi baru disimpan', 'ok');
    navigate('/', { replace: true });
  };

  return (
    <div className="auth-form" style={{ minHeight: '100vh' }}>
      <form onSubmit={submit}>
        <h2>Buat kata sandi baru</h2>
        {!session && <div className="note warn">Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru dari halaman masuk.</div>}
        <Field label="Kata sandi baru" hint="Minimal 8 karakter">
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="Ulangi kata sandi baru">
          <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </Field>
        {error && <div className="note bad">{error}</div>}
        <Button type="submit" variant="primary" loading={busy} disabled={!session}>
          Simpan kata sandi
        </Button>
      </form>
    </div>
  );
}
