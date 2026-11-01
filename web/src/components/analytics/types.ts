export interface AnalyticsSummary {
  totalMahasiswaAktif: number;
  totalMahasiswaLulus: number;
  totalBimbinganSelesai: number;
  totalBimbinganTerjadwal: number;
  rasioTepatWaktu: number; // persentase, misal 87.5
  rataMasaStudiTahun: number; // misal 3.9
  rasioEwsHijau: number; // persentase, misal 86.2
  rasioEwsKuning: number;
  rasioEwsMerah: number;
  trendMahasiswaAktif: number; // misal +8.4
  trendBimbingan: number; // misal +24.1
  trendMasaStudi: number; // misal -4.2 (turun = lebih cepat = positif)
  trendTepatWaktu: number; // misal +5.2
  trendRisiko: number; // misal -12.0 (turun = positif)
}

export interface SparklinePoint {
  time: string;
  value: number;
}

export interface WeeklyTrendPoint {
  pekan: string;
  bimbingan: number;
  target: number;
}

export interface TitleVsGraduationPoint {
  periode: string;
  pengajuan: number;
  lulus: number;
}

export interface StageDistributionPoint {
  prodi: string;
  bab1to3: number;
  sempro: number;
  bab4to5: number;
  sidang: number;
}

export interface EwsCohortPoint {
  angkatan: string;
  hijau: number;
  kuning: number;
  merah: number;
}
