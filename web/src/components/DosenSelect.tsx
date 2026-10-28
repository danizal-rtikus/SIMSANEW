import { dosenOptionLabel, type DosenLoad } from '../lib/dosen';

/** Pilihan dosen yang menampilkan beban bimbingan, kuota, dan bidang keahlian. */
export function DosenSelect({
  value,
  onChange,
  list,
  exclude = [],
  placeholder = 'Pilih dosen',
  ariaLabel,
}: {
  value: string;
  onChange: (id: string) => void;
  list: DosenLoad[] | null;
  exclude?: string[];
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel} disabled={!list}>
      <option value="">{list ? placeholder : 'Memuat daftar dosen…'}</option>
      {(list ?? [])
        .filter((d) => d.dosen_id === value || !exclude.includes(d.dosen_id))
        .map((d) => (
          <option key={d.dosen_id} value={d.dosen_id}>
            {dosenOptionLabel(d)}
            {d.bimbingan_aktif >= d.kuota ? '. Kuota penuh' : ''}
          </option>
        ))}
    </select>
  );
}
