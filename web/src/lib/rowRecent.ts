/**
 * Menandai baris tabel yang terakhir diklik (kelas `row-recent`) selama beberapa detik,
 * agar setelah dialog ditutup tetap jelas baris mana yang baru saja dikerjakan.
 */
let last: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function installRowRecent() {
  document.addEventListener(
    'click',
    (e) => {
      const row = (e.target as HTMLElement | null)?.closest?.('.table tbody tr') as HTMLElement | null;
      if (!row) return;
      if (last && last !== row) last.classList.remove('row-recent');
      row.classList.add('row-recent');
      last = row;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        last?.classList.remove('row-recent');
        last = null;
      }, 6000);
    },
    true,
  );
}
