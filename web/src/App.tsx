import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { isConfigured } from './lib/supabase';
import { ROLE_LABEL } from './lib/labels';
import type { AppRole } from './lib/types';
import { Layout } from './components/Layout';
import { Empty, Loading } from './components/ui';
import { BRAND } from './lib/brand';
import { Login } from './pages/Login';
import { ResetPassword } from './pages/ResetPassword';
import { Dashboard } from './pages/Dashboard';
import { JudulMahasiswa } from './pages/mahasiswa/Judul';
import { BimbinganList } from './pages/bimbingan/BimbinganList';
import { SessionDetail } from './pages/bimbingan/SessionDetail';
import { MyThesis, ThesisPage } from './pages/thesis/ThesisDetail';
import { DosenMahasiswa } from './pages/dosen/MahasiswaBimbingan';
import { VerifikasiJudul } from './pages/kaprodi/VerifikasiJudul';
import { PenetapanPembimbing } from './pages/kaprodi/Pembimbing';
import { PengaturanProdi } from './pages/kaprodi/Pengaturan';
import { Monitoring } from './pages/monitoring/Monitoring';
import { Pedoman } from './pages/pedoman/Pedoman';
import { KelolaPedoman } from './pages/pedoman/KelolaPedoman';
import { Pengguna } from './pages/admin/Pengguna';
import { MasterData } from './pages/admin/MasterData';
import { AuditLog } from './pages/admin/AuditLog';
import { AisysLog } from './pages/admin/AisysLog';
import { Notifikasi } from './pages/Notifikasi';
import { Profil } from './pages/Profil';
import { UjianList } from './pages/ujian/UjianList';
import { UjianDetail } from './pages/ujian/UjianDetail';
import { MyNaskah, NaskahPage } from './pages/naskah/Naskah';
import { ReviewBab } from './pages/naskah/ReviewBab';
import { ReviewList } from './pages/naskah/ReviewList';

function SetupNeeded() {
  return (
    <div className="auth-form" style={{ minHeight: '100vh' }}>
      <div style={{ maxWidth: 560 }} className="stack">
        <h2>SIMSA belum terhubung ke Supabase</h2>
        <p className="muted">
          Salin <code>web/.env.example</code> menjadi <code>web/.env</code>, isi <code>VITE_SUPABASE_URL</code> dan{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> dari Supabase Dashboard (Project Settings, API), lalu jalankan ulang <code>npm run dev</code>.
        </p>
      </div>
    </div>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { session, loading, roles, recovery, signOut } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="splash">
        <img className="brand-logo lg" src={BRAND.logo} alt={`Logo ${BRAND.institution}`} />
        <Loading label="Menyiapkan SIMSA…" />
      </div>
    );
  if (recovery) return <Navigate to="/reset-password" replace />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles.length === 0) {
    return (
      <div className="auth-form" style={{ minHeight: '100vh' }}>
        <img className="brand-logo lg" src={BRAND.logo} alt={`Logo ${BRAND.institution}`} />
        <Empty
          title="Akun Anda belum memiliki peran"
          action={
            <button className="btn" onClick={() => signOut()}>
              Keluar
            </button>
          }
        >
          Hubungi Admin SIMSA agar akun Anda diberi peran (mis. Mahasiswa atau Dosen) sebelum dapat memakai sistem.
        </Empty>
      </div>
    );
  }
  return <>{children}</>;
}

/** Halaman yang hanya untuk peran tertentu (sesuai peran aktif). */
function ForRole({ roles, children }: { roles: AppRole[]; children: ReactNode }) {
  const { active, roles: mine, setActive } = useAuth();
  if (active && roles.includes(active.role)) return <>{children}</>;
  const alt = mine.find((r) => roles.includes(r.role));
  return (
    <Empty
      title="Halaman ini tidak tersedia untuk peran Anda saat ini"
      action={
        alt ? (
          <button className="btn btn-primary" onClick={() => setActive(alt)}>
            Masuk sebagai {ROLE_LABEL[alt.role]}
          </button>
        ) : undefined
      }
    >
      Halaman ini untuk {roles.map((r) => ROLE_LABEL[r]).join(', ')}.
    </Empty>
  );
}

export function App() {
  if (!isConfigured) return <SetupNeeded />;
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="judul" element={<ForRole roles={['mahasiswa']}><JudulMahasiswa /></ForRole>} />
        <Route path="bimbingan" element={<ForRole roles={['mahasiswa', 'dosen']}><BimbinganList /></ForRole>} />
        <Route path="bimbingan/:id" element={<SessionDetail />} />
        <Route path="studi-akhir" element={<ForRole roles={['mahasiswa']}><MyThesis /></ForRole>} />
        <Route path="mahasiswa-bimbingan/:thesisId" element={<ThesisPage />} />
        <Route path="dosen/mahasiswa" element={<ForRole roles={['dosen']}><DosenMahasiswa /></ForRole>} />
        <Route path="kaprodi/judul" element={<ForRole roles={['kaprodi']}><VerifikasiJudul /></ForRole>} />
        <Route path="kaprodi/pembimbing" element={<ForRole roles={['kaprodi']}><PenetapanPembimbing /></ForRole>} />
        <Route path="kaprodi/pengaturan" element={<ForRole roles={['kaprodi']}><PengaturanProdi /></ForRole>} />
        <Route path="naskah" element={<ForRole roles={['mahasiswa']}><MyNaskah /></ForRole>} />
        <Route path="naskah/:thesisId" element={<NaskahPage />} />
        <Route path="naskah/:thesisId/ajuan/:submissionId" element={<ReviewBab />} />
        <Route path="review" element={<ForRole roles={['dosen']}><ReviewList /></ForRole>} />
        <Route path="ujian" element={<UjianList />} />
        <Route path="ujian/:id" element={<UjianDetail />} />
        <Route path="monitoring" element={<ForRole roles={['kaprodi', 'baak', 'pimpinan', 'admin', 'dosen']}><Monitoring /></ForRole>} />
        <Route path="pedoman" element={<Pedoman />} />
        <Route path="pedoman/kelola" element={<ForRole roles={['kaprodi', 'admin']}><KelolaPedoman /></ForRole>} />
        <Route path="admin/pengguna" element={<ForRole roles={['admin']}><Pengguna /></ForRole>} />
        <Route path="admin/master" element={<ForRole roles={['admin']}><MasterData /></ForRole>} />
        <Route path="admin/audit" element={<ForRole roles={['admin']}><AuditLog /></ForRole>} />
        <Route path="admin/aisys" element={<ForRole roles={['admin']}><AisysLog /></ForRole>} />
        <Route path="notifikasi" element={<Notifikasi />} />
        <Route path="profil" element={<Profil />} />
        <Route path="*" element={<Empty title="Halaman tidak ditemukan">Periksa kembali alamat yang Anda buka.</Empty>} />
      </Route>
    </Routes>
  );
}
