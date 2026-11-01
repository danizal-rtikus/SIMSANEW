import { useState } from 'react';
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
    <div className="cf-container">
      {/* Top Breadcrumb & Navigation */}
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

      {/* Sub-Tab Navigation Bar (Persis Requests, Visitors, Performance...) */}
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

      {/* ===================================================================
          ROW 1: 5 KPI SUMMARY CARDS DENGAN SPARKLINE (Persis Gambar 2 Baris 1)
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
          ROW 2: DUA GRAFIK AREA TIME SERIES (Persis Gambar 2 Baris 2)
          =================================================================== */}
      {(activeTab === 'all' || activeTab === 'bimbingan') && (
        <div className="cf-charts-2col">
          {/* Chart 1: Tren Aktivitas Bimbingan per Pekan */}
          <div className="cf-chart-panel">
            <div className="cf-panel-header">
              <div className="cf-panel-title-block">
                <div className="cf-panel-title">Sesi bimbingan per pekan</div>
                <div className="cf-panel-legend">
                  <span className="cf-legend-dot" style={{ background: '#0b5bd3' }} />
                  <span className="cf-legend-text">
                    Realisasi Sesi (Total: {summary.totalBimbinganSelesai})
                  </span>
                  <span className="cf-legend-dot" style={{ background: '#94a3b8', marginLeft: 14 }} />
                  <span className="cf-legend-text">Target Institusi (20 sesi/pekan)</span>
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
                <div className="cf-panel-legend">
                  <span className="cf-legend-dot" style={{ background: '#0891b2' }} />
                  <span className="cf-legend-text">Pendaftaran Judul Baru</span>
                  <span className="cf-legend-dot" style={{ background: '#157a5c', marginLeft: 14 }} />
                  <span className="cf-legend-text">Lulus Yudisium</span>
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
          ROW 3: DUA GRAFIK STACKED BAR (Persis Gambar 2 Baris 3)
          =================================================================== */}
      {(activeTab === 'all' || activeTab === 'tahapan' || activeTab === 'kelulusan') && (
        <div className="cf-charts-2col">
          {/* Chart 3: Sebaran Tahap per Program Studi (Stacked Bar) */}
          <div className="cf-chart-panel">
            <div className="cf-panel-header">
              <div className="cf-panel-title-block">
                <div className="cf-panel-title">Sebaran tahapan per program studi</div>
                <div className="cf-panel-legend wrap">
                  <span className="cf-legend-dot" style={{ background: '#0b5bd3' }} />
                  <span className="cf-legend-text">Bab 1–3</span>
                  <span className="cf-legend-dot" style={{ background: '#e2b04f', marginLeft: 10 }} />
                  <span className="cf-legend-text">Sempro / Revisi</span>
                  <span className="cf-legend-dot" style={{ background: '#8b5cf6', marginLeft: 10 }} />
                  <span className="cf-legend-text">Bab 4–5</span>
                  <span className="cf-legend-dot" style={{ background: '#157a5c', marginLeft: 10 }} />
                  <span className="cf-legend-text">Pendadaran / Lulus</span>
                </div>
              </div>
            </div>
            <div className="cf-chart-body">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={stageDistribution} margin={{ top: 12, right: 18, left: -10, bottom: 0 }}>
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
                  <Bar dataKey="bab1to3" stackId="tahap" fill="#0b5bd3" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="sempro" stackId="tahap" fill="#e2b04f" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="bab4to5" stackId="tahap" fill="#8b5cf6" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="sidang" stackId="tahap" fill="#157a5c" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 4: Kesehatan EWS per Angkatan (Stacked Bar) */}
          <div className="cf-chart-panel">
            <div className="cf-panel-header">
              <div className="cf-panel-title-block">
                <div className="cf-panel-title">Indikator risiko EWS per angkatan</div>
                <div className="cf-panel-legend">
                  <span className="cf-legend-dot" style={{ background: '#157a5c' }} />
                  <span className="cf-legend-text">Hijau (Aman)</span>
                  <span className="cf-legend-dot" style={{ background: '#e2b04f', marginLeft: 12 }} />
                  <span className="cf-legend-text">Kuning (Waspada)</span>
                  <span className="cf-legend-dot" style={{ background: '#c0261d', marginLeft: 12 }} />
                  <span className="cf-legend-text">Merah (Kritis)</span>
                </div>
              </div>
            </div>
            <div className="cf-chart-body">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={ewsCohorts} margin={{ top: 12, right: 18, left: -10, bottom: 0 }}>
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
                            <span className="cf-tt-label">Hijau (On Schedule):</span>
                            <span className="cf-tt-val">{payload.find((p) => p.dataKey === 'hijau')?.value ?? 0}</span>
                          </div>
                          <div className="cf-tt-row">
                            <span className="cf-tt-dot" style={{ background: '#e2b04f' }} />
                            <span className="cf-tt-label">Kuning (Mendekati Tenggat):</span>
                            <span className="cf-tt-val">{payload.find((p) => p.dataKey === 'kuning')?.value ?? 0}</span>
                          </div>
                          <div className="cf-tt-row">
                            <span className="cf-tt-dot" style={{ background: '#c0261d' }} />
                            <span className="cf-tt-label">Merah (Perlu Tindakan):</span>
                            <span className="cf-tt-val">{payload.find((p) => p.dataKey === 'merah')?.value ?? 0}</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="hijau" stackId="ews" fill="#157a5c" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="kuning" stackId="ews" fill="#e2b04f" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="merah" stackId="ews" fill="#c0261d" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
