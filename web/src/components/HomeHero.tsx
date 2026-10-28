import { Link } from 'react-router-dom';
import { useRecents } from '../lib/shell';
import { IconChevronRight, IconClock, IconSearch } from './Icons';
import { openPalette } from './Layout';

export interface HomeColumn {
  title: string;
  to?: string;
  empty: string;
  items: { label: string; sub?: string; to: string }[];
}

/** Beranda bergaya agenda: sapaan, kotak pencarian, lalu tiga kolom daftar. */
export function HomeHero({ title, lead, columns }: { title: string; lead?: string; columns: [HomeColumn, HomeColumn] }) {
  const [recents] = useRecents();
  const recentCol: HomeColumn = {
    title: 'Terakhir dibuka',
    empty: 'Halaman yang Anda buka akan muncul di sini.',
    items: recents.slice(0, 5).map((r) => ({ label: r.title, sub: r.sub, to: r.path })),
  };
  return (
    <section className="home-hero">
      <h1>{title}</h1>
      {lead && <p className="lead">{lead}</p>}
      <button className="home-search" onClick={openPalette}>
        <IconSearch size={18} />
        <span>Cari menu, halaman, atau mahasiswa</span>
        <kbd>Ctrl</kbd>
        <kbd>K</kbd>
      </button>
      <div className="home-cols">
        {[...columns, recentCol].map((c, ci) => (
          <div key={c.title}>
            <div className="home-col-head">
              {c.to ? (
                <Link to={c.to}>
                  {c.title} <IconChevronRight size={14} />
                </Link>
              ) : (
                <span>{c.title}</span>
              )}
            </div>
            <ul className="home-col-list">
              {c.items.length === 0 && <li className="home-col-empty">{c.empty}</li>}
              {c.items.map((it, i) => (
                <li key={i}>
                  <Link to={it.to}>
                    {ci === 2 && (
                      <span className="i">
                        <IconClock size={15} />
                      </span>
                    )}
                    <span className="t">{it.label}</span>
                    {it.sub && <span className="s">{it.sub}</span>}
                    {ci !== 2 && (
                      <span className="i">
                        <IconChevronRight size={15} />
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
