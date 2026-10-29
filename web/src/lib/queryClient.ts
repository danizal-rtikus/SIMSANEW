import { QueryClient } from '@tanstack/react-query';

/**
 * Simpanan data sisi browser. Halaman yang pernah dibuka langsung tampil dari
 * simpanan lalu diperbarui di latar (stale-while-revalidate), sehingga
 * berpindah halaman terasa instan.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0, // selalu perbarui di latar saat halaman dibuka lagi
      gcTime: 10 * 60_000, // simpanan dibuang 10 menit setelah tidak dipakai
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
