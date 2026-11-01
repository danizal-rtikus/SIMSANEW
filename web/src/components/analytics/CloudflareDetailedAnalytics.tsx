import { useState, useRef, useEffect } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LabelList,
} from 'recharts';
import type {
  AnalyticsSummary,
  SparklinePoint,
  WeeklyTrendPoint,
  TitleVsGraduationPoint,
  StageDistributionPoint,
  EwsCohortPoint,
} from './types';

interface CloudflareDetailedAnalyticsProps {
  summary: AnalyticsSummary;
  sparklines: {
    mahasiswa: SparklinePoint[];
    bimbingan: SparklinePoint[];
    kelulusan: SparklinePoint[];
    ews: SparklinePoint[];
  };
  weeklyTrend: WeeklyTrendPoint[];
  titleVsGraduation: TitleVsGraduationPoint[];
  stageDistribution: StageDistributionPoint[];
  ewsCohorts: EwsCohortPoint[];
  prodiList: { id: string; kode: string; nama: string }[];
  selectedProdi: string;
  onSelectProdi: (prodiId: string) => void;
  onBackToOverview: () => void;
}

/**
 * Komponen Legenda Terpadu (Persis Cloudflare):
 * Menggunakan vektor SVG murni sehingga dijamin selalu tercetak berwarna
 * meskipun opsi "Background graphics" pada browser dimatikan oleh pengguna.
 */
function LegendBadge({
  color,
  label,
  value,
  type = 'circle',
}: {
  color: string;
  label: string;
  value?: string | number;
  type?: 'circle' | 'square' | 'line';
}) {
  return (
    <span className="cf-legend-badge-item">
      <svg width="10" height="10" viewBox="0 0 10 10" style={{ flexShrink: 0, marginRight: 4 }}>
        {type === 'circle' && <circle cx="5" cy="5" r="4.5" fill={color} stroke={color} strokeWidth="1" />}
        {type === 'square' && <rect x="0.5" y="0.5" width="9" height="9" rx="2" fill={color} stroke={color} strokeWidth="1" />}
        {type === 'line' && <line x1="0" y1="5" x2="10" y2="5" stroke={color} strokeWidth="2.5" strokeDasharray="3 2" />}
      </svg>
      <span className="cf-legend-badge-label">{label}</span>
      {value !== undefined && (
        <strong className="cf-legend-badge-val" style={{ color: color === '#94a3b8' ? 'inherit' : color }}>
          {value}
        </strong>
      )}
    </span>
  );
}

export function CloudflareDetailedAnalytics({
  summary,
  sparklines,
  weeklyTrend,
  titleVsGraduation,
  stageDistribution,
  ewsCohorts,
  prodiList,
  selectedProdi,
  onSelectProdi,
  onBackToOverview,
}: CloudflareDetailedAnalyticsProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'bimbingan' | 'tahapan' | 'kelulusan'>('all');
  const [timeRange, setTimeRange] = useState('semester');
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    }
    if (moreMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [moreMenuOpen]);

  const selectedProdiObj = prodiList.find((p) => p.id === selectedProdi);
  const prodiLabel = selectedProdi === 'all' ? 'Semua Program Studi' : selectedProdiObj ? `${selectedProdiObj.nama} (${selectedProdiObj.kode})` : selectedProdi;

  // Agregasi Data untuk Legenda Informatif
  const totalBimbinganSelesai = weeklyTrend.reduce((s, p) => s + (p.bimbingan || 0), 0);
  const avgBimbinganPekan = Math.round(totalBimbinganSelesai / (weeklyTrend.length || 1));

  const totalPengajuan = titleVsGraduation.reduce((s, p) => s + (p.pengajuan || 0), 0);
  const totalLulus = titleVsGraduation.reduce((s, p) => s + (p.lulus || 0), 0);

  const totalBab1to3 = stageDistribution.reduce((s, p) => s + (p.bab1to3 || 0), 0);
  const totalSempro = stageDistribution.reduce((s, p) => s + (p.sempro || 0), 0);
  const totalBab4to5 = stageDistribution.reduce((s, p) => s + (p.bab4to5 || 0), 0);
  const totalSidang = stageDistribution.reduce((s, p) => s + (p.sidang || 0), 0);

  const totalHijau = ewsCohorts.reduce((s, p) => s + (p.hijau || 0), 0);
  const totalKuning = ewsCohorts.reduce((s, p) => s + (p.kuning || 0), 0);
  const totalMerah = ewsCohorts.reduce((s, p) => s + (p.merah || 0), 0);
  const totalMhsEws = (totalHijau + totalKuning + totalMerah) || 1;
  const pctHijau = Math.round((totalHijau / totalMhsEws) * 100);
  const pctKuning = Math.round((totalKuning / totalMhsEws) * 100);
  const pctMerah = Math.round((totalMerah / totalMhsEws) * 100);

  // Mini Sparkline component untuk 5 KPI Cards di Baris 1
  const renderKpiSparkline = (data: SparklinePoint[], color: string) => (
    <div style={{ width: '100%', height: 38, marginTop: 8 }}>
      <ResponsiveContainer width="100%" height={38}>
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`kpiGrad_${color}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.2} />
              <stop offset="95%" stopColor={color} stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="time" hide />
          <YAxis hide domain={['dataMin - 1', 'dataMax + 1']} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.8}
            dot={false}
            fillOpacity={1}
            fill={`url(#kpiGrad_${color})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <div className="cf-container cf-printable-report" id="cf-analytics-report">
      {/* ===================================================================
          KOP RESMI DOKUMEN CETAK (Halaman 1)
          =================================================================== */}
      <div className="cf-print-header">
        <div className="cf-print-header-content">
          <div>
            <h1 className="cf-print-main-title">Analytics</h1>
            <p className="cf-print-sub-title">Laporan Analitik Akademik Studi Akhir &bull; STIKOM Yos Sudarso</p>
            <p className="cf-print-meta-line">
              Semester 2026/2027 Ganjil &bull; Cakupan: {prodiLabel} &bull; Waktu Cetak: {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} WIB &bull; Hal. 1 dari 2
            </p>
          </div>
          <div className="cf-print-logo-box">
            <span className="cf-print-logo-mark">S</span>
            <span className="cf-print-logo-text">SIMSA ANALYTICS</span>
          </div>
        </div>
      </div>

      {/* Top Breadcrumb & Navigation (Hanya tampil di Web) */}
      <div className="cf-detail-topbar">
        <button className="cf-back-btn" onClick={onBackToOverview}>
          &larr; Kembali ke Ringkasan
        </button>
        <div className="cf-detail-controls">
          <div className="cf-select-wrap">
            <span className="cf-select-label">Prodi:</span>
            <select
              className="cf-select"
              value={selectedProdi}
              onChange={(e) => onSelectProdi(e.target.value)}
            >
              <option value="all">Semua Program Studi</option>
              {prodiList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nama} ({p.kode})
                </option>
              ))}
            </select>
          </div>
          <div className="cf-select-wrap">
            <span className="cf-select-label">Rentang:</span>
            <select
              className="cf-select"
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
            >
              <option value="semester">Semester Ini (2026/2027 Ganjil)</option>
              <option value="30d">30 Hari Terakhir</option>
              <option value="1y">1 Tahun Terakhir</option>
            </select>
          </div>
        </div>
      </div>

      {/* Sub-Tab Navigation Bar & Action Rail (Persis Cloudflare Header di Gambar 1) */}
      <div className="cf-subtabs-row">
        <div className="cf-subtabs">
          <button
            className={`cf-subtab ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            Semua Metrik
          </button>
          <button
            className={`cf-subtab ${activeTab === 'bimbingan' ? 'active' : ''}`}
            onClick={() => setActiveTab('bimbingan')}
          >
            Aktivitas Bimbingan
          </button>
          <button
            className={`cf-subtab ${activeTab === 'tahapan' ? 'active' : ''}`}
            onClick={() => setActiveTab('tahapan')}
          >
            Sebaran Tahap & EWS
          </button>
          <button
            className={`cf-subtab ${activeTab === 'kelulusan' ? 'active' : ''}`}
            onClick={() => setActiveTab('kelulusan')}
          >
            Kelulusan & Masa Studi
          </button>
        </div>

        <div className="cf-subtabs-actions">
          <div className="cf-subtabs-pill">
            <span className="cf-pill-dot" />
            <span>2026/2027 Ganjil</span>
          </div>
          <div className="cf-more-menu-wrap" ref={menuRef}>
            <button
              className="cf-more-btn"
              onClick={() => setMoreMenuOpen(!moreMenuOpen)}
              title="Opsi Laporan"
              aria-label="Opsi Laporan"
            >
              &bull;&bull;&bull;
            </button>
            {moreMenuOpen && (
              <div className="cf-more-dropdown">
                <button
                  className="cf-more-dropdown-item"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    window.print();
                  }}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ marginRight: 4 }}
                  >
                    <polyline points="6 9 6 2 18 2 18 9" />
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                    <rect x="6" y="14" width="12" height="8" />
                  </svg>
                  Print report
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===================================================================
          ROW 1: 5 KPI SUMMARY CARDS (Persis Cloudflare Layout)
          =================================================================== */}
      <div className="cf-kpi-grid">
        {/* Card 1: Total Mahasiswa Aktif */}
        <div className="cf-kpi-card">
          <div className="cf-kpi-label">Mahasiswa aktif</div>
          <div className="cf-kpi-val-row">
            <span className="cf-kpi-val">{summary.totalMahasiswaAktif}</span>
            <span className="cf-kpi-trend up">&nearr; {Math.abs(summary.trendMahasiswaAktif)}%</span>
          </div>
          {renderKpiSparkline(sparklines.mahasiswa, '#0b5bd3')}
        </div>

        {/* Card 2: Total Sesi Bimbingan */}
        <div className="cf-kpi-card">
          <div className="cf-kpi-label">Total sesi bimbingan</div>
          <div className="cf-kpi-val-row">
            <span className="cf-kpi-val">{summary.totalBimbinganSelesai}</span>
            <span className="cf-kpi-trend up">&nearr; {Math.abs(summary.trendBimbingan)}%</span>
          </div>
          {renderKpiSparkline(sparklines.bimbingan, '#0891b2')}
        </div>

        {/* Card 3: Rata-rata Masa Studi */}
        <div className="cf-kpi-card">
          <div className="cf-kpi-label">Masa studi rata-rata</div>
          <div className="cf-kpi-val-row">
            <span className="cf-kpi-val">{summary.rataMasaStudiTahun} thn</span>
            <span className="cf-kpi-trend up">&searr; {Math.abs(summary.trendMasaStudi)}%</span>
          </div>
          {renderKpiSparkline(sparklines.kelulusan, '#157a5c')}
        </div>

        {/* Card 4: Kelulusan Tepat Waktu */}
        <div className="cf-kpi-card">
          <div className="cf-kpi-label">Kelulusan tepat waktu</div>
          <div className="cf-kpi-val-row">
            <span className="cf-kpi-val">{summary.rasioTepatWaktu}%</span>
            <span className="cf-kpi-trend up">&nearr; {Math.abs(summary.trendTepatWaktu)}%</span>
          </div>
          {renderKpiSparkline(sparklines.kelulusan, '#157a5c')}
        </div>

        {/* Card 5: Mahasiswa Berisiko (EWS) */}
        <div className="cf-kpi-card">
          <div className="cf-kpi-label">Mahasiswa berisiko (kritis)</div>
          <div className="cf-kpi-val-row">
            <span className="cf-kpi-val">{summary.rasioEwsMerah}%</span>
            <span className="cf-kpi-trend up">&searr; {Math.abs(summary.trendRisiko)}%</span>
          </div>
          {renderKpiSparkline(sparklines.ews, '#c0261d')}
        </div>
      </div>

      {/* ===================================================================
          ROW 2: DUA GRAFIK TREN AREA (Halaman 1)
          =================================================================== */}
      {(activeTab === 'all' || activeTab === 'bimbingan') && (
        <div className="cf-charts-2col">
          {/* Chart 1: Tren Aktivitas Bimbingan per Pekan */}
          <div className="cf-chart-panel">
            <div className="cf-panel-header">
              <div className="cf-panel-title-block">
                <div className="cf-panel-title">Sesi bimbingan per pekan</div>
                <div className="cf-panel-legend wrap">
                  <LegendBadge color="#0b5bd3" label="Realisasi Sesi" value={`${totalBimbinganSelesai} sesi`} />
                  <LegendBadge color="#94a3b8" label="Target Institusi" value="20/pekan" type="line" />
                  <LegendBadge color="#0891b2" label="Rata-rata Berjalan" value={`${avgBimbinganPekan} sesi/pekan`} />
                </div>
              </div>
              <div className="cf-panel-group">Pekan 1 – 16</div>
            </div>
            <div className="cf-chart-body">
              <ResponsiveContainer width="100%" height={230}>
                <AreaChart data={weeklyTrend} margin={{ top: 12, right: 18, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cfAreaBlue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0b5bd3" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#0b5bd3" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="pekan" tick={{ fontSize: 11, fill: 'var(--ink-3)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--ink-3)' }} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="cf-tooltip">
                          <div className="cf-tt-title">{label}</div>
                          <div className="cf-tt-row">
                            <span className="cf-tt-dot" style={{ background: '#0b5bd3' }} />
                            <span className="cf-tt-label">Bimbingan Terlaksana:</span>
                            <span className="cf-tt-val">{payload[0]?.value} sesi</span>
                          </div>
                          <div className="cf-tt-row">
                            <span className="cf-tt-dot" style={{ background: '#94a3b8' }} />
                            <span className="cf-tt-label">Target Rata-rata:</span>
                            <span className="cf-tt-val">{payload[1]?.value} sesi</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="bimbingan"
                    name="Realisasi Bimbingan"
                    stroke="#0b5bd3"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#cfAreaBlue)"
                  />
                  <Area
                    type="monotone"
                    dataKey="target"
                    name="Target Institusi"
                    stroke="#94a3b8"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    fillOpacity={0}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Laju Pengajuan Judul vs Yudisium Lulus */}
          <div className="cf-chart-panel">
            <div className="cf-panel-header">
              <div className="cf-panel-title-block">
                <div className="cf-panel-title">Pengajuan judul vs kelulusan</div>
                <div className="cf-panel-legend wrap">
                  <LegendBadge color="#0891b2" label="Pendaftaran Judul" value={`${totalPengajuan} proposal`} />
                  <LegendBadge color="#157a5c" label="Lulus Yudisium" value={`${totalLulus} mhs (${summary.rasioTepatWaktu}% tepat waktu)`} />
                </div>
              </div>
              <div className="cf-panel-group">Semester Berjalan</div>
            </div>
            <div className="cf-chart-body">
              <ResponsiveContainer width="100%" height={230}>
                <AreaChart data={titleVsGraduation} margin={{ top: 12, right: 18, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cfAreaCyan" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0891b2" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#0891b2" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="cfAreaGreen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#157a5c" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#157a5c" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="periode" tick={{ fontSize: 11, fill: 'var(--ink-3)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--ink-3)' }} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="cf-tooltip">
                          <div className="cf-tt-title">{label}</div>
                          <div className="cf-tt-row">
                            <span className="cf-tt-dot" style={{ background: '#0891b2' }} />
                            <span className="cf-tt-label">Pendaftaran Judul:</span>
                            <span className="cf-tt-val">{payload[0]?.value} mhs</span>
                          </div>
                          <div className="cf-tt-row">
                            <span className="cf-tt-dot" style={{ background: '#157a5c' }} />
                            <span className="cf-tt-label">Lulus Yudisium:</span>
                            <span className="cf-tt-val">{payload[1]?.value} mhs</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="pengajuan"
                    name="Pengajuan Judul"
                    stroke="#0891b2"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#cfAreaCyan)"
                  />
                  <Area
                    type="monotone"
                    dataKey="lulus"
                    name="Lulus Yudisium"
                    stroke="#157a5c"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#cfAreaGreen)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          PAGE BREAK KHUSUS DOKUMEN CETAK (Halaman 2 Terstruktur Rapi)
          =================================================================== */}
      <div className="cf-print-page-break" />

      {/* Kop Resmi Khusus Halaman 2 Cetak PDF */}
      <div className="cf-print-header cf-print-header-page2">
        <div className="cf-print-header-content">
          <div>
            <h2 className="cf-print-main-title" style={{ fontSize: 18 }}>Sebaran Tahap Studi & Early Warning System (EWS)</h2>
            <p className="cf-print-sub-title">Laporan Analitik Akademik SIMSA &bull; STIKOM Yos Sudarso &bull; Lembar 2 dari 2</p>
          </div>
          <div className="cf-print-logo-box">
            <span className="cf-print-logo-mark">S</span>
            <span className="cf-print-logo-text">HALAMAN 2</span>
          </div>
        </div>
      </div>

      {/* ===================================================================
          ROW 3: DUA GRAFIK STACKED BAR DENGAN DATA LABELS & LEGENDA INFORMATIF
          =================================================================== */}
      {(activeTab === 'all' || activeTab === 'tahapan' || activeTab === 'kelulusan') && (
        <div className="cf-charts-2col">
          {/* Chart 3: Sebaran Tahap per Program Studi (Stacked Bar) */}
          <div className="cf-chart-panel">
            <div className="cf-panel-header">
              <div className="cf-panel-title-block">
                <div className="cf-panel-title">Sebaran tahapan per program studi</div>
                <div className="cf-panel-legend wrap">
                  <LegendBadge color="#0b5bd3" label="Bab 1–3 (Proposal)" value={`${totalBab1to3} mhs`} type="square" />
                  <LegendBadge color="#e2b04f" label="Sempro / Revisi" value={`${totalSempro} mhs`} type="square" />
                  <LegendBadge color="#8b5cf6" label="Bab 4–5 (Bimbingan Hasil)" value={`${totalBab4to5} mhs`} type="square" />
                  <LegendBadge color="#157a5c" label="Pendadaran / Lulus" value={`${totalSidang} mhs`} type="square" />
                </div>
              </div>
              <div className="cf-panel-group">Berdasarkan Prodi</div>
            </div>
            <div className="cf-chart-body">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={stageDistribution} margin={{ top: 16, right: 18, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="prodi" tick={{ fontSize: 11, fill: 'var(--ink-3)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--ink-3)' }} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="cf-tooltip">
                          <div className="cf-tt-title">Program Studi: {label}</div>
                          <div className="cf-tt-row">
                            <span className="cf-tt-dot" style={{ background: '#0b5bd3' }} />
                            <span className="cf-tt-label">Proposal (Bab 1–3):</span>
                            <span className="cf-tt-val">{payload.find((p) => p.dataKey === 'bab1to3')?.value ?? 0}</span>
                          </div>
                          <div className="cf-tt-row">
                            <span className="cf-tt-dot" style={{ background: '#e2b04f' }} />
                            <span className="cf-tt-label">Seminar Proposal:</span>
                            <span className="cf-tt-val">{payload.find((p) => p.dataKey === 'sempro')?.value ?? 0}</span>
                          </div>
                          <div className="cf-tt-row">
                            <span className="cf-tt-dot" style={{ background: '#8b5cf6' }} />
                            <span className="cf-tt-label">Hasil (Bab 4–5):</span>
                            <span className="cf-tt-val">{payload.find((p) => p.dataKey === 'bab4to5')?.value ?? 0}</span>
                          </div>
                          <div className="cf-tt-row">
                            <span className="cf-tt-dot" style={{ background: '#157a5c' }} />
                            <span className="cf-tt-label">Sidang / Lulus:</span>
                            <span className="cf-tt-val">{payload.find((p) => p.dataKey === 'sidang')?.value ?? 0}</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="bab1to3" stackId="tahap" fill="#0b5bd3" radius={[0, 0, 0, 0]}>
                    <LabelList dataKey="bab1to3" position="center" fill="#ffffff" fontSize={11} fontWeight={600} formatter={(v: number) => (v >= 3 ? v : '')} />
                  </Bar>
                  <Bar dataKey="sempro" stackId="tahap" fill="#e2b04f" radius={[0, 0, 0, 0]}>
                    <LabelList dataKey="sempro" position="center" fill="#ffffff" fontSize={11} fontWeight={600} formatter={(v: number) => (v >= 3 ? v : '')} />
                  </Bar>
                  <Bar dataKey="bab4to5" stackId="tahap" fill="#8b5cf6" radius={[0, 0, 0, 0]}>
                    <LabelList dataKey="bab4to5" position="center" fill="#ffffff" fontSize={11} fontWeight={600} formatter={(v: number) => (v >= 3 ? v : '')} />
                  </Bar>
                  <Bar dataKey="sidang" stackId="tahap" fill="#157a5c" radius={[3, 3, 0, 0]}>
                    <LabelList dataKey="sidang" position="center" fill="#ffffff" fontSize={11} fontWeight={600} formatter={(v: number) => (v >= 3 ? v : '')} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 4: Kesehatan EWS per Angkatan (Stacked Bar) */}
          <div className="cf-chart-panel">
            <div className="cf-panel-header">
              <div className="cf-panel-title-block">
                <div className="cf-panel-title">Indikator risiko EWS per angkatan</div>
                <div className="cf-panel-legend wrap">
                  <LegendBadge color="#157a5c" label="Hijau (Aman & Lancar)" value={`${totalHijau} mhs (${pctHijau}%)`} />
                  <LegendBadge color="#e2b04f" label="Kuning (Waspada)" value={`${totalKuning} mhs (${pctKuning}%)`} />
                  <LegendBadge color="#c0261d" label="Merah (Kritis)" value={`${totalMerah} mhs (${pctMerah}%)`} />
                </div>
              </div>
              <div className="cf-panel-group">Berdasarkan Angkatan</div>
            </div>
            <div className="cf-chart-body">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={ewsCohorts} margin={{ top: 16, right: 18, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="angkatan" tick={{ fontSize: 11, fill: 'var(--ink-3)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--ink-3)' }} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="cf-tooltip">
                          <div className="cf-tt-title">Angkatan {label}</div>
                          <div className="cf-tt-row">
                            <span className="cf-tt-dot" style={{ background: '#157a5c' }} />
                            <span className="cf-tt-label">Hijau (Aman):</span>
                            <span className="cf-tt-val">{payload.find((p) => p.dataKey === 'hijau')?.value ?? 0} mhs</span>
                          </div>
                          <div className="cf-tt-row">
                            <span className="cf-tt-dot" style={{ background: '#e2b04f' }} />
                            <span className="cf-tt-label">Kuning (Waspada):</span>
                            <span className="cf-tt-val">{payload.find((p) => p.dataKey === 'kuning')?.value ?? 0} mhs</span>
                          </div>
                          <div className="cf-tt-row">
                            <span className="cf-tt-dot" style={{ background: '#c0261d' }} />
                            <span className="cf-tt-label">Merah (Kritis):</span>
                            <span className="cf-tt-val">{payload.find((p) => p.dataKey === 'merah')?.value ?? 0} mhs</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="hijau" stackId="ews" fill="#157a5c" radius={[0, 0, 0, 0]}>
                    <LabelList dataKey="hijau" position="center" fill="#ffffff" fontSize={11} fontWeight={600} formatter={(v: number) => (v >= 3 ? v : '')} />
                  </Bar>
                  <Bar dataKey="kuning" stackId="ews" fill="#e2b04f" radius={[0, 0, 0, 0]}>
                    <LabelList dataKey="kuning" position="center" fill="#ffffff" fontSize={11} fontWeight={600} formatter={(v: number) => (v >= 2 ? v : '')} />
                  </Bar>
                  <Bar dataKey="merah" stackId="ews" fill="#c0261d" radius={[3, 3, 0, 0]}>
                    <LabelList dataKey="merah" position="top" fill="#c0261d" fontSize={11} fontWeight={700} formatter={(v: number) => (v > 0 ? `${v} Kritis` : '')} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          RINGKASAN EKSEKUTIF & REKOMENDASI AKADEMIK (Tampil di Web & Cetak)
          =================================================================== */}
      <div className="cf-takeaway-card">
        <div className="cf-takeaway-header">
          <span className="cf-takeaway-badge">Catatan Rekomendasi Eksekutif</span>
          <span className="cf-takeaway-period">Semester 2026/2027 Ganjil &bull; Status: Kondusif</span>
        </div>
        <div className="cf-takeaway-grid">
          <div className="cf-takeaway-item">
            <div className="cf-takeaway-item-title">Status Kesehatan Progres Studi</div>
            <div className="cf-takeaway-item-desc">
              Sebanyak <strong>{pctHijau}% mahasiswa ({totalHijau} mhs)</strong> berada di zona hijau dengan laju bimbingan aktif sesuai jadwal pedoman. Sebanyak <strong>{pctKuning}% ({totalKuning} mhs)</strong> dalam zona kuning (perhatian), dan <strong>{pctMerah}% ({totalMerah} mhs)</strong> kritis yang memerlukan akselerasi bimbingan intensif oleh Ka. Prodi.
            </div>
          </div>
          <div className="cf-takeaway-item">
            <div className="cf-takeaway-item-title">Efektivitas Bimbingan & Kelulusan Tepat Waktu</div>
            <div className="cf-takeaway-item-desc">
              Rasio kelulusan tepat waktu mencapai <strong>{summary.rasioTepatWaktu}%</strong> (melampaui ambang batas standar akreditasi LAM-INFOKOM minimal 75%). Sebanyak <strong>{totalBimbinganSelesai} sesi bimbingan</strong> telah tercatat dan tervalidasi dosen pembimbing di seluruh program studi.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
