import { useState } from 'react';
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import type { AnalyticsSummary, SparklinePoint } from './types';

interface CloudflareOverviewProps {
  summary: AnalyticsSummary;
  sparklines: {
    mahasiswa: SparklinePoint[];
    bimbingan: SparklinePoint[];
    kelulusan: SparklinePoint[];
    ews: SparklinePoint[];
  };
  onDrillDown: (topic?: string) => void;
  onOpenMonitoring?: () => void;
  onOpenAkreditasi?: () => void;
}

export function CloudflareOverview({
  summary,
  sparklines,
  onDrillDown,
  onOpenMonitoring,
  onOpenAkreditasi,
}: CloudflareOverviewProps) {
  const [timeFilter, setTimeFilter] = useState<'24h' | '7d' | '30d'>('30d');

  return (
    <div className="cf-container">
      {/* Header bar dengan Time filter pills */}
      <div className="cf-overview-header">
        <div className="cf-title-block">
          <div className="cf-sub">Overview</div>
          <h2 className="cf-title">STIKOM Yos Sudarso — Manajemen Studi Akhir</h2>
          <p className="cf-desc">
            Pantau seluruh metrik bimbingan, kesehatan milestone EWS, dan laju kelulusan mahasiswa secara berkala.
          </p>
        </div>
        <div className="cf-header-actions">
          <div className="cf-time-pills">
            <button
              className={`cf-time-pill ${timeFilter === '24h' ? 'active' : ''}`}
              onClick={() => setTimeFilter('24h')}
            >
              24 Jam
            </button>
            <button
              className={`cf-time-pill ${timeFilter === '7d' ? 'active' : ''}`}
              onClick={() => setTimeFilter('7d')}
            >
              7 Hari
            </button>
            <button
              className={`cf-time-pill ${timeFilter === '30d' ? 'active' : ''}`}
              onClick={() => setTimeFilter('30d')}
            >
              30 Hari
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Layout: Left 4 Stacked Cards, Right Action/Status Rail */}
      <div className="cf-overview-grid">
        {/* Kolom Kiri: 4 Stacked Chart Cards */}
        <div className="cf-cards-stack">
          {/* Card 1: Mahasiswa Aktif */}
          <div
            className="cf-overview-card clickable"
            onClick={() => onDrillDown('tahapan')}
            role="button"
            tabIndex={0}
            title="Klik untuk membuka Analisis Detail Mahasiswa"
          >
            <div className="cf-card-left">
              <div className="cf-metric-label">Mahasiswa Bimbingan Aktif</div>
              <div className="cf-metric-value">{summary.totalMahasiswaAktif}</div>
              <div className="cf-metric-sub">
                {summary.totalMahasiswaLulus} lulus · 4 Program Studi
              </div>
              <div className="cf-metric-link">Lihat rincian analitik &rarr;</div>
            </div>
            <div className="cf-card-right">
              <ResponsiveContainer width="100%" height={110}>
                <AreaChart data={sparklines.mahasiswa} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cfBlueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0b5bd3" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#0b5bd3" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" hide />
                  <YAxis hide domain={['dataMin - 2', 'dataMax + 2']} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface)',
                      borderColor: 'var(--line)',
                      borderRadius: 6,
                      fontSize: 12,
                      boxShadow: 'var(--shadow)',
                    }}
                    labelStyle={{ color: 'var(--ink-2)' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    name="Mahasiswa"
                    stroke="#0b5bd3"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#cfBlueGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Card 2: Total Sesi Bimbingan */}
          <div
            className="cf-overview-card clickable"
            onClick={() => onDrillDown('bimbingan')}
            role="button"
            tabIndex={0}
            title="Klik untuk membuka Analisis Detail Sesi Bimbingan"
          >
            <div className="cf-card-left">
              <div className="cf-metric-label">Total Sesi Bimbingan</div>
              <div className="cf-metric-value">{summary.totalBimbinganSelesai}</div>
              <div className="cf-metric-sub">
                {summary.totalBimbinganTerjadwal} sesi terjadwal minggu ini
              </div>
              <div className="cf-metric-link">Lihat rincian analitik &rarr;</div>
            </div>
            <div className="cf-card-right">
              <ResponsiveContainer width="100%" height={110}>
                <AreaChart data={sparklines.bimbingan} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cfCyanGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0891b2" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#0891b2" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" hide />
                  <YAxis hide domain={['dataMin - 5', 'dataMax + 5']} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface)',
                      borderColor: 'var(--line)',
                      borderRadius: 6,
                      fontSize: 12,
                      boxShadow: 'var(--shadow)',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    name="Sesi Bimbingan"
                    stroke="#0891b2"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#cfCyanGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Card 3: Kelulusan Tepat Waktu */}
          <div
            className="cf-overview-card clickable"
            onClick={() => onDrillDown('kelulusan')}
            role="button"
            tabIndex={0}
            title="Klik untuk membuka Analisis Detail Kelulusan"
          >
            <div className="cf-card-left">
              <div className="cf-metric-label">Kelulusan Tepat Waktu</div>
              <div className="cf-metric-value">{summary.rasioTepatWaktu}%</div>
              <div className="cf-metric-sub">
                Rata-rata masa studi {summary.rataMasaStudiTahun} tahun (Target: ≥80%)
              </div>
              <div className="cf-metric-link">Lihat rincian analitik &rarr;</div>
            </div>
            <div className="cf-card-right">
              <ResponsiveContainer width="100%" height={110}>
                <AreaChart data={sparklines.kelulusan} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cfGreenGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#157a5c" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#157a5c" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" hide />
                  <YAxis hide domain={[70, 100]} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface)',
                      borderColor: 'var(--line)',
                      borderRadius: 6,
                      fontSize: 12,
                      boxShadow: 'var(--shadow)',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    name="Tepat Waktu (%)"
                    stroke="#157a5c"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#cfGreenGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Card 4: Indeks Kesehatan EWS */}
          <div
            className="cf-overview-card clickable"
            onClick={() => onDrillDown('ews')}
            role="button"
            tabIndex={0}
            title="Klik untuk membuka Analisis Detail EWS"
          >
            <div className="cf-card-left">
              <div className="cf-metric-label">Indeks Kesehatan EWS</div>
              <div className="cf-metric-value">{summary.rasioEwsHijau}%</div>
              <div className="cf-metric-sub">
                {summary.rasioEwsHijau}% Hijau · {summary.rasioEwsKuning}% Waspada · {summary.rasioEwsMerah}% Kritis
              </div>
              <div className="cf-metric-link">Lihat rincian analitik &rarr;</div>
            </div>
            <div className="cf-card-right">
              <ResponsiveContainer width="100%" height={110}>
                <AreaChart data={sparklines.ews} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cfEmeraldGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" hide />
                  <YAxis hide domain={[60, 100]} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface)',
                      borderColor: 'var(--line)',
                      borderRadius: 6,
                      fontSize: 12,
                      boxShadow: 'var(--shadow)',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    name="Indeks Aman (%)"
                    stroke="#10b981"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#cfEmeraldGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Kolom Kanan: Status Node & Quick Actions (Persis layout Cloudflare) */}
        <div className="cf-sidebar-rail">
          {/* Status Sistem */}
          <div className="cf-rail-box">
            <div className="cf-rail-title">Status Sistem & Data</div>
            <div className="cf-rail-status-list">
              <div className="cf-rail-status-item">
                <span className="cf-dot ok" />
                <span className="cf-rail-label">Database Supabase</span>
                <span className="cf-rail-val">Aktif</span>
              </div>
              <div className="cf-rail-status-item">
                <span className="cf-dot ok" />
                <span className="cf-rail-label">Row Level Security</span>
                <span className="cf-rail-val">16 Migrasi</span>
              </div>
              <div className="cf-rail-status-item">
                <span className="cf-dot ok" />
                <span className="cf-rail-label">Engine AISYS AI</span>
                <span className="cf-rail-val">Aktif</span>
              </div>
              <div className="cf-rail-status-item">
                <span className="cf-dot ok" />
                <span className="cf-rail-label">EWS Real-time</span>
                <span className="cf-rail-val">Berjalan</span>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="cf-rail-box">
            <div className="cf-rail-title">Aksi Cepat</div>
            <div className="cf-rail-actions">
              <button className="cf-btn-primary" onClick={() => onDrillDown()}>
                Buka Analisis Lengkap
              </button>
              <button className="cf-btn-secondary" onClick={() => window.print()} title="Cetak laporan dashboard saat ini">
                Cetak Laporan
              </button>
              {onOpenMonitoring && (
                <button className="cf-btn-secondary" onClick={onOpenMonitoring}>
                  Monitoring Mahasiswa
                </button>
              )}
              {onOpenAkreditasi && (
                <button className="cf-btn-secondary" onClick={onOpenAkreditasi}>
                  Laporan Akreditasi LKPS
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
