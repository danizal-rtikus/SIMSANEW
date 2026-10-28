import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { must, supabase, translateError } from '../lib/supabase';
import { ROLE_LABEL } from '../lib/labels';
import { useProdi } from '../lib/master';
import { Badge, Button, Field, PageHeader, Panel } from '../components/ui';
import { useToast } from '../components/Toast';
import { applyTheme, readTheme, type Theme } from '../lib/theme';

export function Profil() {
  const { profile, roles, refresh, has } = useAuth();
  const toast = useToast();
  const prodiList = useProdi();
  const [v, setV] = useState({ nama: '', telepon: '', bidang: '' });
  const [pw, setPw] = useState({ a: '', b: '' });
  const [busy, setBusy] = useState<'profil' | 'pw' | null>(null);
  const [theme, setTheme] = useState<Theme>(readTheme());

  useEffect(() => {
    if (profile) setV({ nama: profile.nama, telepon: profile.telepon ?? '', bidang: (profile.bidang_keahlian ?? []).join(', ') });
  }, [profile]);

  const saveProfile = async () => {
    if (!v.nama.trim()) return toast.show('Nama wajib diisi', 'bad');
    setBusy('profil');
    try {
      await must(
        supabase
          .from('profiles')
          .update({ nama: v.nama.trim(), telepon: v.telepon.trim() || null, bidang_keahlian: v.bidang.split(',').map((s) => s.trim()).filter(Boolean) })
          .eq('id', profile!.id),
      );
      await refresh();
      toast.show('Profil disimpan', 'ok');
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };

  const savePassword = async () => {
    if (pw.a.length < 8) return toast.show('Kata sandi minimal 8 karakter', 'bad');
    if (pw.a !== pw.b) return toast.show('Konfirmasi kata sandi tidak sama', 'bad');
    setBusy('pw');
    const { error } = await supabase.auth.updateUser({ password: pw.a });
    setBusy(null);
    if (error) return toast.show(translateError(error.message), 'bad');
    setPw({ a: '', b: '' });
    toast.show('Kata sandi diganti', 'ok');
  };

  return (
    <>
      <PageHeader title="Profil" />
      <div className="grid-2">
        <Panel title="Data diri" actions={<Button variant="primary" loading={busy === 'profil'} onClick={saveProfile}>Simpan profil</Button>}>
          <div className="stack-sm">
            <dl className="kv">
              <dt>Email</dt>
              <dd>{profile?.email}</dd>
              {profile?.nim && (
                <>
                  <dt>NIM</dt>
                  <dd>{profile.nim}</dd>
                </>
              )}
              {profile?.nidn && (
                <>
                  <dt>NIDN</dt>
                  <dd>{profile.nidn}</dd>
                </>
              )}
              <dt>Prodi</dt>
              <dd>{prodiList.find((p) => p.id === profile?.prodi_id)?.nama ?? '—'}</dd>
              <dt>Peran</dt>
              <dd className="row" style={{ gap: 6 }}>
                {roles.map((r) => (
                  <Badge key={`${r.role}${r.prodi_id}`}>{ROLE_LABEL[r.role]}</Badge>
                ))}
              </dd>
            </dl>
            <p className="small muted">NIM, NIDN, prodi, dan peran diubah oleh Admin.</p>
            <Field label="Nama lengkap dan gelar">
              <input value={v.nama} onChange={(e) => setV({ ...v, nama: e.target.value })} />
            </Field>
            <Field label="Telepon">
              <input value={v.telepon} onChange={(e) => setV({ ...v, telepon: e.target.value })} />
            </Field>
            {has('dosen') && (
              <Field label="Bidang keahlian" hint="Pisahkan dengan koma. Ditampilkan ke Ka. Prodi saat menetapkan pembimbing.">
                <input value={v.bidang} onChange={(e) => setV({ ...v, bidang: e.target.value })} />
              </Field>
            )}
          </div>
        </Panel>
        <div className="stack">
          <Panel title="Ganti kata sandi" actions={<Button loading={busy === 'pw'} onClick={savePassword}>Ganti kata sandi</Button>}>
            <div className="stack-sm">
              <Field label="Kata sandi baru" hint="Minimal 8 karakter">
                <input type="password" autoComplete="new-password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} />
              </Field>
              <Field label="Ulangi kata sandi baru">
                <input type="password" autoComplete="new-password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} />
              </Field>
            </div>
          </Panel>
          <Panel title="Tampilan">
            <Field label="Tema">
              <select
                value={theme}
                onChange={(e) => {
                  const t = e.target.value as Theme;
                  setTheme(t);
                  applyTheme(t);
                }}
              >
                <option value="light">Terang</option>
                <option value="dark">Gelap</option>
              </select>
            </Field>
          </Panel>
        </div>
      </div>
    </>
  );
}
