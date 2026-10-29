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
import { MenungguVerifikasi } from './pages/MenungguVerifikasi';
import { ResetPassword } from './pages/ResetPassword';
import { Dashboard } from './pages/Dashboard';
import { lazyModule, registerPreload } from './lib/lazy';

/* Halaman selain Beranda dimuat saat dibutuhkan agar muatan awal kecil. */
const mJudul = lazyModule(() => import('./pages/mahasiswa/Judul'));
const mBimbinganList = lazyModule(() => import('./pages/bimbingan/BimbinganList'));
const mSession = lazyModule(() => import('./pages/bimbingan/SessionDetail'));
const mThesis = lazyModule(() => import('./pages/thesis/ThesisDetail'));
const mDosen = lazyModule(() => import('./pages/dosen/MahasiswaBimbingan'));
const mVerif = lazyModule(() => import('./pages/kaprodi/VerifikasiJudul'));
const mPembimbing = lazyModule(() => import('./pages/kaprodi/Pembimbing'));
const mPengaturan = lazyModule(() => import('./pages/kaprodi/Pengaturan'));
const mMonitoring = lazyModule(() => import('./pages/monitoring/Monitoring'));
const mPedoman = lazyModule(() => import('./pages/pedoman/Pedoman'));
const mKelola = lazyModule(() => import('./pages/pedoman/KelolaPedoman'));
const mPengguna = lazyModule(() => import('./pages/admin/Pengguna'));
const mMaster = lazyModule(() => import('./pages/admin/MasterData'));
const mAudit = lazyModule(() => import('./pages/admin/AuditLog'));
const mAisys = lazyModule(() => import('./pages/admin/AisysLog'));
const mVerifikasi = lazyModule(() => import('./pages/admin/VerifikasiAkun'));
const mNotif = lazyModule(() => import('./pages/Notifikasi'));
const mProfil = lazyModule(() => import('./pages/Profil'));
const mUjianList = lazyModule(() => import('./pages/ujian/UjianList'));
const mUjianDetail = lazyModule(() => import('./pages/ujian/UjianDetail'));
const mNaskah = lazyModule(() => import('./pages/naskah/Naskah'));
const mReviewBab = lazyModule(() => import('./pages/naskah/ReviewBab'));
const mReviewList = lazyModule(() => import('./pages/naskah/ReviewList'));

const JudulMahasiswa = mJudul('JudulMahasiswa');
const BimbinganList = mBimbinganList('BimbinganList');
const SessionDetail = mSession('SessionDetail');
const MyThesis = mThesis('MyThesis');
const ThesisPage = mThesis('ThesisPage');
const DosenMahasiswa = mDosen('DosenMahasiswa');
const VerifikasiJudul = mVerif('VerifikasiJudul');
const PenetapanPembimbing = mPembimbing('PenetapanPembimbing');
const PengaturanProdi = mPengaturan('PengaturanProdi');
const Monitoring = mMonitoring('Monitoring');
const Pedoman = mPedoman('Pedoman');
const KelolaPedoman = mKelola('KelolaPedoman');
const Pengguna = mPengguna('Pengguna');
const MasterData = mMaster('MasterData');
const AuditLog = mAudit('AuditLog');
const AisysLog = mAisys('AisysLog');
const VerifikasiAkun = mVerifikasi('VerifikasiAkun');
const Notifikasi = mNotif('Notifikasi');
const Profil = mProfil('Profil');
const UjianList = mUjianList('UjianList');
const UjianDetail = mUjianDetail('UjianDetail');
const MyNaskah = mNaskah('MyNaskah');
const NaskahPage = mNaskah('NaskahPage');
const ReviewBab = mReviewBab('ReviewBab');
const ReviewList = mReviewList('ReviewList');

// Urutan penting: pola yang lebih spesifik lebih dulu.
(
  [
    [/^\/judul/, JudulMahasiswa],
    [/^\/bimbingan\/./, SessionDetail],
    [/^\/bimbingan/, BimbinganList],
    [/^\/(studi-akhir|mahasiswa-bimbingan)/, MyThesis],
    [/^\/dosen\/mahasiswa/, DosenMahasiswa],
    [/^\/kaprodi\/judul/, VerifikasiJudul],
    [/^\/kaprodi\/pembimbing/, PenetapanPembimbing],
    [/^\/kaprodi\/pengaturan/, PengaturanProdi],
    [/^\/monitoring/, Monitoring],
    [/^\/pedoman\/kelola/, KelolaPedoman],
    [/^\/pedoman/, Pedoman],
    [/^\/admin\/pengguna/, Pengguna],
    [/^\/admin\/master/, MasterData],
    [/^\/admin\/audit/, AuditLog],
    [/^\/admin\/aisys/, AisysLog],
    [/^\/admin\/verifikasi/, VerifikasiAkun],
    [/^\/notifikasi/, Notifikasi],
    [/^\/profil/, Profil],
    [/^\/ujian\/./, UjianDetail],
    [/^\/ujian/, UjianList],
    [/^\/naskah\/[^/]+\/ajuan/, ReviewBab],
    [/^\/naskah/, MyNaskah],
    [/^\/review/, ReviewList],
  ] as const
).forEach(([re, C]) => registerPreload(re, C.preload));

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
  const { session, loading, roles, recovery } = useAuth();
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
  if (roles.length === 0) return <MenungguVerifikasi />;
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
        <Route path="admin/verifikasi" element={<ForRole roles={['admin']}><VerifikasiAkun /></ForRole>} />
        <Route path="notifikasi" element={<Notifikasi />} />
        <Route path="profil" element={<Profil />} />
        <Route path="*" element={<Empty title="Halaman tidak ditemukan">Periksa kembali alamat yang Anda buka.</Empty>} />
      </Route>
    </Routes>
  );
}
