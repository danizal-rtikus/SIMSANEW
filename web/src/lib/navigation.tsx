import type { ReactNode } from 'react';
import type { AppRole } from './types';
import {
  IconBook,
  IconChart,
  IconChat,
  IconDatabase,
  IconExam,
  IconFile,
  IconFlag,
  IconHistory,
  IconHome,
  IconLog,
  IconManuscript,
  IconOverview,
  IconSettings,
  IconTitle,
  IconUserCheck,
  IconUsers,
  IconAward,
} from '../components/Icons';

export interface NavLeaf {
  to: string;
  label: string;
  /** Aktif juga saat parameter tab tidak ada di URL (tab bawaan). */
  isDefault?: boolean;
  count?: number;
}
export interface NavItem extends NavLeaf {
  icon: ReactNode;
  end?: boolean;
  children?: NavLeaf[];
}
export interface NavSection {
  label?: string;
  items: NavItem[];
}

export interface NavCounts {
  sesi: number;
  judul: number;
  review?: number;
  /** Pendaftaran akun yang menunggu verifikasi (Admin). */
  akun?: number;
}

export const HOME: NavItem = { to: '/', label: 'Beranda', icon: <IconHome />, end: true };

export function navFor(role: AppRole | undefined, c: NavCounts): NavSection[] {
  const pedoman: NavItem = { to: '/pedoman', label: 'Pedoman', icon: <IconBook />, end: true };
  const ujianStaf: NavItem = {
    to: '/ujian',
    label: 'Ujian',
    icon: <IconExam />,
    children: [
      { to: '/ujian', label: 'Perlu dijadwalkan', isDefault: true },
      { to: '/ujian?f=dijadwalkan', label: 'Terjadwal' },
      { to: '/ujian?f=selesai', label: 'Selesai' },
    ],
  };
  const monitoring: NavItem = {
    to: '/monitoring',
    label: 'Monitoring progres',
    icon: <IconChart />,
    children: [
      { to: '/monitoring', label: 'Tabel mahasiswa', isDefault: true },
      { to: '/monitoring?view=peta', label: 'Peta tahap' },
    ],
  };
  const akreditasi: NavItem = { to: '/akreditasi', label: 'Akreditasi', icon: <IconAward /> };
  switch (role) {
    case 'mahasiswa':
      return [
        {
          label: 'Studi akhir',
          items: [
            { to: '/judul', label: 'Pendaftaran TA', icon: <IconTitle /> },
            {
              to: '/studi-akhir',
              label: 'Studi akhir saya',
              icon: <IconFlag />,
              children: [
                { to: '/studi-akhir', label: 'Milestone', isDefault: true },
                { to: '/studi-akhir?tab=bimbingan', label: 'Sesi bimbingan' },
                { to: '/studi-akhir?tab=draf', label: 'Berkas draf (cadangan)' },
                { to: '/studi-akhir?tab=ujian', label: 'Ujian' },
                { to: '/studi-akhir?tab=riwayat', label: 'Riwayat perubahan' },
              ],
            },
            { to: '/naskah', label: 'Naskah', icon: <IconManuscript /> },
            { to: '/bimbingan', label: 'Bimbingan', icon: <IconChat /> },
            { to: '/ujian', label: 'Ujian', icon: <IconExam /> },
          ],
        },
        { label: 'Referensi', items: [pedoman] },
      ];
    case 'dosen':
      return [
        {
          label: 'Bimbingan',
          items: [
            { to: '/dosen/mahasiswa', label: 'Mahasiswa bimbingan', icon: <IconUsers /> },
            {
              to: '/review',
              label: 'Review naskah',
              icon: <IconManuscript />,
              count: c.review,
              children: [
                { to: '/review', label: 'Perlu ditinjau', isDefault: true, count: c.review },
                { to: '/review?f=semua', label: 'Semua pengajuan' },
              ],
            },
            {
              to: '/bimbingan',
              label: 'Sesi bimbingan',
              icon: <IconChat />,
              count: c.sesi,
              children: [
                { to: '/bimbingan', label: 'Menunggu tanggapan', isDefault: true, count: c.sesi },
                { to: '/bimbingan?f=dijadwalkan', label: 'Terjadwal' },
                { to: '/bimbingan?f=selesai', label: 'Selesai' },
                { to: '/bimbingan?f=semua', label: 'Semua sesi' },
              ],
            },
            {
              to: '/ujian',
              label: 'Ujian saya',
              icon: <IconExam />,
              children: [
                { to: '/ujian', label: 'Perlu dinilai', isDefault: true },
                { to: '/ujian?f=putuskan', label: 'Ketua sidang' },
                { to: '/ujian?f=revisi', label: 'Revisi menunggu ACC' },
                { to: '/ujian?f=riwayat', label: 'Semua ujian' },
              ],
            },
          ],
        },
        { label: 'Referensi', items: [pedoman] },
      ];
    case 'kaprodi':
      return [
        {
          label: 'Persetujuan',
          items: [
            {
              to: '/kaprodi/judul',
              label: 'Pendaftaran TA',
              icon: <IconTitle />,
              count: c.judul,
              children: [
                { to: '/kaprodi/judul', label: 'Menunggu keputusan', isDefault: true, count: c.judul },
                { to: '/kaprodi/judul?tab=riwayat', label: 'Riwayat keputusan' },
              ],
            },
            {
              to: '/kaprodi/pembimbing',
              label: 'Ploting dosen',
              icon: <IconUserCheck />,
              children: [
                { to: '/kaprodi/pembimbing', label: 'Belum lengkap', isDefault: true },
                { to: '/kaprodi/pembimbing?tab=semua', label: 'Semua mahasiswa' },
              ],
            },
            ujianStaf,
          ],
        },
        { label: 'Pemantauan', items: [monitoring, akreditasi] },
        {
          label: 'Pedoman dan pengaturan',
          items: [
            pedoman,
            { to: '/pedoman/kelola', label: 'Kelola pedoman', icon: <IconLog /> },
            { to: '/kaprodi/pengaturan', label: 'Pengaturan prodi', icon: <IconSettings /> },
          ],
        },
      ];
    case 'baak':
    case 'pimpinan':
      return [
        { label: 'Ujian', items: [ujianStaf] },
        { label: 'Pemantauan', items: role === 'pimpinan' ? [monitoring, akreditasi] : [monitoring] },
        { label: 'Referensi', items: [pedoman] },
      ];
    case 'admin':
      return [
        {
          label: 'Pengguna dan akses',
          items: [
            { to: '/admin/verifikasi', label: 'Verifikasi akun', icon: <IconUserCheck />, count: c.akun },
            { to: '/admin/pengguna', label: 'Pengguna', icon: <IconUsers /> },
            { to: '/admin/audit', label: 'Audit log', icon: <IconHistory /> },
            { to: '/admin/aisys', label: 'Log AISYS', icon: <IconChart /> },
          ],
        },
        {
          label: 'Data akademik',
          items: [
            {
              to: '/admin/master',
              label: 'Master data',
              icon: <IconDatabase />,
              children: [
                { to: '/admin/master', label: 'Program studi', isDefault: true },
                { to: '/admin/master?tab=tahun', label: 'Tahun akademik' },
                { to: '/admin/master?tab=template', label: 'Template milestone' },
                { to: '/admin/master?tab=penilaian', label: 'Form penilaian' },
                { to: '/admin/master?tab=konversi', label: 'Konversi nilai' },
              ],
            },
            { to: '/pedoman/kelola', label: 'Kelola pedoman', icon: <IconLog /> },
          ],
        },
        { label: 'Ujian dan pemantauan', items: [ujianStaf, monitoring, akreditasi] },
      ];
    default:
      return [];
  }
}

/** Menu konteks saat membuka satu mahasiswa (seperti menu domain di dasbor). */
export function thesisNav(base: string): NavItem[] {
  return [
    { to: base, label: 'Ringkasan dan milestone', icon: <IconOverview />, isDefault: true },
    { to: `/naskah/${base.split('/').pop()}`, label: 'Naskah', icon: <IconManuscript /> },
    { to: `${base}?tab=bimbingan`, label: 'Sesi bimbingan', icon: <IconChat /> },
    { to: `${base}?tab=draf`, label: 'Berkas draf (cadangan)', icon: <IconFile /> },
    { to: `${base}?tab=ujian`, label: 'Ujian', icon: <IconExam /> },
    { to: `${base}?tab=riwayat`, label: 'Riwayat perubahan', icon: <IconHistory /> },
  ];
}

/** Cocokkan tautan menu dengan lokasi saat ini, termasuk parameter tab. */
export function matchLink(to: string, pathname: string, search: string, opts: { end?: boolean; isDefault?: boolean; exactQuery?: boolean } = {}): boolean {
  const [p, q] = to.split('?');
  const pathOk = opts.end || opts.exactQuery ? pathname === p : pathname === p || pathname.startsWith(p + '/');
  if (!pathOk) return false;
  if (!opts.exactQuery) return true;
  const want = new URLSearchParams(q || '');
  const have = new URLSearchParams(search);
  const keys = new Set([...want.keys(), ...['tab', 'f', 'view'].filter((k) => have.has(k))]);
  if (keys.size === 0) return true;
  for (const k of keys) {
    if ((want.get(k) ?? null) !== (have.get(k) ?? null)) return false;
  }
  return true;
}

export function flatten(sections: NavSection[]): { to: string; label: string; group?: string }[] {
  const out: { to: string; label: string; group?: string }[] = [];
  sections.forEach((s) =>
    s.items.forEach((it) => {
      if (it.children?.length) it.children.forEach((ch) => out.push({ to: ch.to, label: ch.label, group: it.label }));
      else out.push({ to: it.to, label: it.label, group: s.label });
    }),
  );
  return out;
}
