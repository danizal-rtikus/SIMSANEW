import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, roleKey } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { queryClient } from '../lib/queryClient';
import { ROLE_LABEL } from '../lib/labels';
import { HOME, matchLink, navFor, thesisNav, type NavCounts, type NavItem, type NavSection } from '../lib/navigation';
import { useEntity, useFavorites, usePref, useRecents } from '../lib/shell';
import { useProdi } from '../lib/master';
import { initials } from '../lib/format';
import { applyTheme, readTheme, type Theme } from '../lib/theme';
import { useDialog } from './Dialog';
import { BRAND } from '../lib/brand';
import { CommandPalette } from './CommandPalette';
import { Skeleton } from './Skeleton';
import { Dropdown } from './Dropdown';
import { preloadIdle, preloadPath } from '../lib/lazy';
import { isWorkspacePath, useFocusMode } from '../lib/workspace';
import {
  IconMoon,
  IconSun,
  IconBell,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconLogout,
  IconMenu,
  IconSearch,
  IconSidebar,
  IconStar,
  IconStarFill,
  IconUndo,
  IconUpDown,
  IconUserCircle,
  IconRefresh,
} from './Icons';

/** Animasi menu sidebar hanya sekali per pembukaan aplikasi. */
let introPlayed = false;

export function Layout() {
  const { profile, roles, active, setActive, signOut, userId } = useAuth();
  const dialog = useDialog();
  const navigate = useNavigate();
  const location = useLocation();
  const prodiList = useProdi();
  const { entity } = useEntity();
  const fav = useFavorites();
  const [recents, addRecent] = useRecents();
  const [collapsed, setCollapsed] = usePref<boolean>('sidebarCollapsed', false);
  const [openGroups, setOpenGroups] = usePref<Record<string, boolean>>('navOpen', {});
  const [recentsOpen, setRecentsOpen] = usePref<boolean>('recentsOpen', true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [unread, setUnread] = useState(0);
  const [counts, setCounts] = useState<NavCounts>({ sesi: 0, judul: 0, review: 0, akun: 0 });
  const [tick, setTick] = useState(0);
  const [theme, setThemeState] = useState<Theme>(readTheme());

  const sections = useMemo<NavSection[]>(() => navFor(active?.role, counts), [active?.role, counts]);
  const { pathname, search } = location;
  const workspace = isWorkspacePath(pathname);
  const [focus, setFocus] = useFocusMode();
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [intro, setIntro] = useState(() => !introPlayed);

  useEffect(() => {
    introPlayed = true;
    const t = setTimeout(() => setIntro(false), 1200);
    return () => clearTimeout(t);
  }, []);

  // Keluar dari mode fokus saat meninggalkan ruang kerja atau menekan Esc.
  useEffect(() => {
    if (!workspace) setFocus(false);
    setPeek(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);
  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.dialog-overlay, .overlay') && setFocus(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, setFocus]);

  // Muat kode halaman menu saat peramban senggang, agar perpindahan halaman instan.
  useEffect(() => {
    const paths = sections.flatMap((s) => s.items.flatMap((it) => [it.to, ...(it.children ?? []).map((c) => c.to)]));
    preloadIdle(paths);
  }, [sections]);

  useEffect(() => setMobileOpen(false), [pathname, search]);

  // Ctrl+K / Cmd+K membuka pencarian cepat
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Catat halaman menu ke "Terakhir dibuka" (tanpa parameter panel detail ?buka=).
  useEffect(() => {
    if (pathname === '/') return;
    const sp = new URLSearchParams(search);
    if (sp.has('buka')) return;
    for (const s of sections) {
      for (const it of s.items) {
        const leafs = it.children?.length ? it.children.map((c) => ({ ...c, parent: it.label })) : [{ ...it, parent: s.label }];
        const hit = leafs.find((l) => matchLink(l.to, pathname, search, { exactQuery: true }));
        if (hit) {
          // Alamat menu (tanpa filter halaman seperti ?peran=) agar satu menu tercatat sekali.
          addRecent({ path: hit.to, title: it.children?.length ? `${it.label}: ${hit.label}` : hit.label, sub: it.children?.length ? s.label : hit.parent });
          return;
        }
      }
    }
    if (pathname === '/notifikasi') addRecent({ path: pathname, title: 'Notifikasi' });
    if (pathname === '/profil') addRecent({ path: pathname, title: 'Profil' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search, sections]);

  // Notifikasi belum dibaca + pembaruan real-time
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const load = async () => {
      const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('dibaca_at', null);
      if (alive) setUnread(count ?? 0);
    };
    load();
    const channel = supabase
      .channel(`notif-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => {
        load();
        setTick((t) => t + 1);
      })
      .subscribe();
    window.addEventListener('simsa:notif-read', load);
    window.addEventListener('simsa:refresh', load);
    return () => {
      alive = false;
      window.removeEventListener('simsa:notif-read', load);
      window.removeEventListener('simsa:refresh', load);
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Penghitung antrean per peran. Saat berpindah halaman cukup diperbarui paling sering
  // tiap 30 detik; perubahan notifikasi (tick) dan pergantian peran tetap langsung.
  const countsAt = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  useEffect(() => {
    if (!userId || !active) return;
    const key = `${userId}|${active.role}|${active.prodi_id ?? ''}|${tick}`;
    if (countsAt.current.key === key && Date.now() - countsAt.current.at < 30_000) return;
    countsAt.current = { key, at: Date.now() };
    let alive = true;
    let done = false;
    (async () => {
      let sesi = 0;
      let judul = 0;
      let review = 0;
      let akun = 0;
      if (active.role === 'admin') {
        const { count } = await supabase.from('account_requests').select('id', { count: 'exact', head: true }).eq('status', 'menunggu');
        akun = count ?? 0;
      }
      if (active.role === 'dosen') {
        const { count } = await supabase.from('guidance_sessions').select('id', { count: 'exact', head: true }).eq('dosen_id', userId).eq('status', 'diajukan');
        sesi = count ?? 0;
        const q = await supabase.rpc('antrean_review');
        review = ((q.data as { perlu_tinjau: boolean }[] | null) ?? []).filter((r) => r.perlu_tinjau).length;
      }
      if (active.role === 'kaprodi' && active.prodi_id) {
        const { count } = await supabase.from('title_submissions').select('id', { count: 'exact', head: true }).eq('prodi_id', active.prodi_id).eq('status', 'diajukan');
        judul = count ?? 0;
      }
      done = true;
      if (alive) setCounts((c) => (c.sesi === sesi && c.judul === judul && c.review === review && c.akun === akun ? c : { sesi, judul, review, akun }));
    })();
    return () => {
      alive = false;
      // Hitungan yang batal di tengah jalan tidak dihitung, agar dimuat ulang pada render berikutnya.
      if (!done) countsAt.current = { key: '', at: 0 };
    };
  }, [userId, active, tick, pathname]);

  useEffect(() => {
    const on = (e: Event) => setThemeState((e as CustomEvent).detail as Theme);
    window.addEventListener('simsa:theme', on);
    return () => window.removeEventListener('simsa:theme', on);
  }, []);

  // Nomor induk yang tampil di profil sidebar: NIM untuk mahasiswa, NIDN untuk dosen.
  const idNo = profile?.nim || profile?.nidn || '';
  const roleLabel = (r: { role: string; prodi_id: string | null }) => {
    const kode = prodiList.find((p) => p.id === r.prodi_id)?.kode;
    return `${ROLE_LABEL[r.role as keyof typeof ROLE_LABEL]}${kode ? ` ${kode}` : ''}`;
  };

  const doSignOut = async () => {
    const ok = await dialog.confirm({ title: 'Keluar dari SIMSA?', message: 'Anda perlu login kembali untuk melanjutkan.', confirmLabel: 'Keluar' });
    if (!ok) return;
    await signOut();
    navigate('/login');
  };

  // Ruang kerja: sidebar menjadi deretan ikon dan melebar sementara saat diarahkan kursor.
  const rail = (collapsed || workspace) && !mobileOpen;
  const isCollapsed = rail && !peek;
  const onSidebarEnter = () => {
    if (!workspace || collapsed) return;
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(true), 180);
  };
  const onSidebarLeave = () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    setPeek(false);
  };
  // Nomor urut untuk animasi masuk menu (sekali saat aplikasi dibuka).
  let order = 0;
  const seq = (): CSSProperties | undefined => (intro ? ({ '--i': order++ } as CSSProperties) : undefined);
  const pre = (to: string) => ({ onMouseEnter: () => preloadPath(to), onFocus: () => preloadPath(to) });
  const thesisContext = entity?.kind === 'thesis' && active?.role !== 'mahasiswa' ? entity : null;
  const back = active?.role === 'dosen' ? { to: '/dosen/mahasiswa', label: 'daftar mahasiswa' } : { to: '/monitoring', label: 'Monitoring' };

  // Remah roti di topbar untuk halaman menu
  const crumb = useMemo(() => {
    for (const s of sections) for (const it of s.items) if (matchLink(it.to, pathname, search, { end: it.end })) return { section: s.label, page: it.label };
    // Submenu yang berada di alamat lain dari menu induknya (mis. Pengguna > Verifikasi akun).
    for (const s of sections) for (const it of s.items) for (const c of it.children ?? []) if (!c.to.includes('?') && matchLink(c.to, pathname, '')) return { section: it.label, page: c.label };
    if (pathname === '/') return { page: 'Beranda' };
    if (pathname.startsWith('/notifikasi')) return { page: 'Notifikasi' };
    if (pathname.startsWith('/profil')) return { page: 'Profil' };
    return null;
  }, [sections, pathname, search]);

  const renderItem = (it: NavItem) => {
    const hasKids = !!it.children?.length;
    const selfActive = matchLink(it.to, pathname, search, { end: it.end, exactQuery: !hasKids && (!!it.isDefault || it.to.includes('?')) });
    if (!hasKids || isCollapsed) {
      return (
        <Link key={it.to + it.label} to={it.to} className={`sb-item ${selfActive ? 'active' : ''}`} style={seq()} {...pre(it.to)} title={isCollapsed ? it.label : undefined} aria-current={selfActive ? 'page' : undefined}>
          <span className="sb-icon">{it.icon}</span>
          <span className="sb-label">{it.label}</span>
          {!!it.count && <span className="sb-count">{it.count}</span>}
        </Link>
      );
    }
    const childActive = it.children!.some((c) => matchLink(c.to, pathname, search, { exactQuery: true }));
    const expanded = openGroups[it.label] ?? (childActive || matchLink(it.to, pathname, search));
    return (
      <div key={it.label} className="sb-group" style={seq()}>
        <button className={`sb-item ${childActive && !expanded ? 'active' : ''}`} aria-expanded={expanded} onClick={() => setOpenGroups({ ...openGroups, [it.label]: !expanded })}>
          <span className="sb-icon">{it.icon}</span>
          <span className="sb-label">{it.label}</span>
          {!!it.count && !expanded && <span className="sb-count">{it.count}</span>}
          <span className="sb-chev">{expanded ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}</span>
        </button>
        {expanded && (
          <div className="sb-sub">
            {it.children!.map((c) => {
              const a = matchLink(c.to, pathname, search, { exactQuery: true });
              return (
                <Link key={c.to} to={c.to} className={`sb-subitem ${a ? 'active' : ''}`} {...pre(c.to)} aria-current={a ? 'page' : undefined}>
                  <span className="sb-label">{c.label}</span>
                  {!!c.count && <span className="sb-count">{c.count}</span>}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const recentBlock = !isCollapsed && recents.length > 0 && (
    <div className="sb-group" style={seq()}>
      <button className="sb-item" aria-expanded={recentsOpen} onClick={() => setRecentsOpen(!recentsOpen)}>
        <span className="sb-icon">
          <IconClock />
        </span>
        <span className="sb-label">Terakhir dibuka</span>
        <span className="sb-chev">{recentsOpen ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}</span>
      </button>
      {recentsOpen && (
        <div className="sb-sub">
          {recents.slice(0, 5).map((r) => (
            <Link key={r.path} to={r.path} className={`sb-subitem two ${pathname + search === r.path ? 'active' : ''}`} {...pre(r.path)}>
              <span className="sb-label">{r.title}</span>
              {r.sub && <span className="sb-subtext">{r.sub}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );

  const favBlock = !isCollapsed && fav.list.length > 0 && (
    <>
      <div className="sb-section" style={seq()}>
        Favorit
      </div>
      {fav.list.map((f) => (
        <Link key={f.path} to={f.path} className={`sb-item ${pathname === f.path.split('?')[0] ? 'active' : ''}`} style={seq()} {...pre(f.path)}>
          <span className="sb-icon">
            <IconStar />
          </span>
          <span className="sb-label">{f.title}</span>
        </Link>
      ))}
    </>
  );

  return (
    <div className={`app ${rail ? 'rail' : ''} ${isCollapsed ? 'collapsed' : ''} ${peek ? 'peek' : ''} ${workspace ? 'ws' : ''} ${focus && workspace ? 'focus' : ''}`}>
      {mobileOpen && <div className="scrim" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`} aria-label="Navigasi utama" onMouseEnter={onSidebarEnter} onMouseLeave={onSidebarLeave}>
        <div className="sb-head">
          <Dropdown
            className="sb-account"
            trigger={(open, toggle) => (
              <button className="sb-account-btn" onClick={toggle} aria-expanded={open} aria-haspopup="menu" title={isCollapsed ? 'Ganti peran' : undefined}>
                <img className="brand-logo" src={BRAND.logo} alt={`Logo ${BRAND.institution}`} />
                <span className="sb-account-text">
                  <span className="sb-account-name">{BRAND.app}</span>
                  <span className="sb-account-role">{active ? roleLabel(active) : ''}</span>
                </span>
                {roles.length > 1 && <IconUpDown size={16} className="sb-account-chev" />}
              </button>
            )}
          >
            {(close) => (
              <>
                <div className="dd-user">
                  <div className="strong">{BRAND.institution}</div>
                  <div className="muted small">{BRAND.appLong}</div>
                </div>
                <div className="dd-sep" />
                <div className="dd-head">Masuk sebagai</div>
                {roles.map((r) => {
                  const on = active && roleKey(r) === roleKey(active);
                  return (
                    <button
                      key={roleKey(r)}
                      className="dd-item"
                      role="menuitemradio"
                      aria-checked={!!on}
                      onClick={() => {
                        close();
                        if (!on) {
                          setActive(r);
                          navigate('/');
                        }
                      }}
                    >
                      <span>{roleLabel(r)}</span>
                      {on && <IconCheck size={16} />}
                    </button>
                  );
                })}
              </>
            )}
          </Dropdown>
          <button className="sb-search" onClick={() => setPalette(true)} title={isCollapsed ? 'Cari cepat (Ctrl K)' : undefined}>
            <IconSearch size={16} />
            <span className="sb-label">Cari cepat…</span>
            <kbd className="sb-kbd">Ctrl K</kbd>
          </button>
        </div>

        <nav className={`sb-nav ${intro ? 'intro' : ''}`}>
          {thesisContext ? (
            <>
              <Link to={back.to} className="sb-item sb-back" style={seq()} {...pre(back.to)} title={isCollapsed ? `Kembali ke ${back.label}` : undefined}>
                <span className="sb-icon">
                  <IconUndo />
                </span>
                <span className="sb-label">Kembali ke {back.label}</span>
              </Link>
              <div className="sb-divider" />
              {thesisNav(thesisContext.basePath).map(renderItem)}
              <div className="sb-divider" />
              {recentBlock}
            </>
          ) : (
            <>
              {renderItem(HOME)}
              {recentBlock}
              {favBlock}
              {sections.map((s, i) => (
                <div key={s.label ?? i}>
                  {s.label && !isCollapsed && (
                    <div className="sb-section" style={seq()}>
                      {s.label}
                    </div>
                  )}
                  {isCollapsed && <div className="sb-divider" />}
                  {s.items.map(renderItem)}
                </div>
              ))}
            </>
          )}
        </nav>

        <div className="sb-foot">
          <Dropdown
            align="up"
            className="sb-me"
            trigger={(open, toggle) => (
              <button
                className="sb-me-btn"
                onClick={toggle}
                aria-expanded={open}
                aria-haspopup="menu"
                aria-label={`Akun: ${profile?.nama ?? ''}${active ? `, ${roleLabel(active)}` : ''}`}
                title={isCollapsed ? `${profile?.nama ?? ''}${idNo ? ` (${idNo})` : ''}, ${active ? roleLabel(active) : ''}` : undefined}
              >
                <span className="sb-me-avatar" aria-hidden>
                  {initials(profile?.nama) || <IconUserCircle size={16} />}
                </span>
                <span className="sb-me-text">
                  <span className="sb-me-name">{profile?.nama}</span>
                  <span className="sb-me-sub">
                    {idNo && <span className="mono-num">{idNo}</span>}
                    {idNo && active && <span aria-hidden> · </span>}
                    {active && roleLabel(active)}
                  </span>
                </span>
              </button>
            )}
          >
            {(close) => (
              <>
                <div className="dd-user">
                  <div className="strong">{profile?.nama}</div>
                  <div className="muted small">
                    {idNo ? `${profile?.nim ? 'NIM' : 'NIDN'} ${idNo} · ` : ''}
                    {profile?.email}
                  </div>
                </div>
                <div className="dd-sep" />
                <button
                  className="dd-item"
                  role="menuitem"
                  onClick={() => {
                    close();
                    navigate('/profil');
                  }}
                >
                  <span>Profil</span>
                </button>
                {roles.length > 1 && (
                  <>
                    <div className="dd-head">Ganti peran</div>
                    {roles.map((r) => {
                      const on = active && roleKey(r) === roleKey(active);
                      return (
                        <button
                          key={roleKey(r)}
                          className="dd-item"
                          role="menuitemradio"
                          aria-checked={!!on}
                          onClick={() => {
                            close();
                            if (!on) {
                              setActive(r);
                              navigate('/');
                            }
                          }}
                        >
                          <span>{roleLabel(r)}</span>
                          {on && <IconCheck size={16} />}
                        </button>
                      );
                    })}
                  </>
                )}
                <div className="dd-sep" />
                <button
                  className="dd-item"
                  role="menuitem"
                  onClick={() => {
                    close();
                    doSignOut();
                  }}
                >
                  <span>Keluar</span>
                  <IconLogout size={16} />
                </button>
              </>
            )}
          </Dropdown>
          <button
            className="icon-btn sb-collapse"
            onClick={() => {
              setPeek(false);
              setCollapsed(!collapsed);
            }}
            aria-label={collapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar'}
            title={workspace && !collapsed ? 'Sidebar otomatis menyempit di halaman naskah; klik untuk selalu menyempitkan' : collapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar'}
          >
            <IconSidebar />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Buka menu" onClick={() => setMobileOpen(true)}>
            <IconMenu />
          </button>
          {thesisContext ? (
            <div className="tb-entity">
              <button
                className={`icon-btn tb-star ${fav.has(thesisContext.basePath) ? 'on' : ''}`}
                aria-label={fav.has(thesisContext.basePath) ? 'Hapus dari favorit' : 'Tambahkan ke favorit'}
                title={fav.has(thesisContext.basePath) ? 'Hapus dari favorit' : 'Tambahkan ke favorit'}
                onClick={() => fav.toggle({ path: thesisContext.basePath, title: thesisContext.title, sub: thesisContext.sub })}
              >
                {fav.has(thesisContext.basePath) ? <IconStarFill size={17} /> : <IconStar size={17} />}
              </button>
              <span className="tb-entity-title">{thesisContext.title}</span>
              {thesisContext.sub && <span className="tb-pill">{thesisContext.sub}</span>}
              <button className="icon-btn" aria-label="Pindah ke mahasiswa lain" title="Pindah ke mahasiswa lain" onClick={() => setPalette(true)}>
                <IconUpDown size={16} />
              </button>
            </div>
          ) : (
            crumb && (
              <div className="tb-crumb">
                {crumb.section && (
                  <>
                    <span className="muted">{crumb.section}</span>
                    <IconChevronRight size={14} className="muted" />
                  </>
                )}
                <span>{crumb.page}</span>
              </div>
            )
          )}
          <div className="spacer" />
          <RefreshButton
            onRefresh={() => {
              countsAt.current = { key: '', at: 0 };
              setTick((t) => t + 1);
            }}
          />
          <Link to="/pedoman" className="tb-link">
            Pedoman
          </Link>
          <button
            className="icon-btn theme-btn"
            onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap'}
            title={theme === 'dark' ? 'Tema terang' : 'Tema gelap'}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
          <button className="icon-btn" aria-label={`Notifikasi, ${unread} belum dibaca`} title="Notifikasi" onClick={() => navigate('/notifikasi')}>
            <IconBell />
            {unread > 0 && <span className="dot">{unread > 99 ? '99+' : unread}</span>}
          </button>
          <Dropdown
            align="right"
            trigger={(open, toggle) => (
              <button className="avatar-btn" onClick={toggle} aria-expanded={open} aria-haspopup="menu" aria-label="Menu akun">
                {initials(profile?.nama) || <IconUserCircle />}
              </button>
            )}
          >
            {(close) => (
              <>
                <div className="dd-user">
                  <div className="strong">{profile?.nama}</div>
                  <div className="muted small">{profile?.email}</div>
                </div>
                <div className="dd-sep" />
                <button
                  className="dd-item"
                  onClick={() => {
                    close();
                    navigate('/profil');
                  }}
                >
                  Profil dan kata sandi
                </button>
                <div className="dd-head">Tema</div>
                {(
                  [
                    ['light', 'Terang'],
                    ['dark', 'Gelap'],
                  ] as [Theme, string][]
                ).map(([t, l]) => (
                  <button key={t} className="dd-item" role="menuitemradio" aria-checked={theme === t} onClick={() => applyTheme(t)}>
                    <span>{l}</span>
                    {theme === t && <IconCheck size={16} />}
                  </button>
                ))}
                <div className="dd-sep" />
                <button
                  className="dd-item"
                  onClick={() => {
                    close();
                    doSignOut();
                  }}
                >
                  <span>Keluar</span>
                  <IconLogout size={16} />
                </button>
              </>
            )}
          </Dropdown>
        </header>
        <main className={`content ${workspace ? 'content-ws' : ''}`}>
          <Suspense fallback={<Skeleton variant={workspace ? 'editor' : 'page'} />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} sections={sections} prodi={prodiList} />
    </div>
  );
}

/** Tombol pembuka pencarian cepat untuk dipakai di halaman (mis. Beranda). */
export function openPalette() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
}

/** Muat ulang data halaman yang sedang dibuka tanpa memuat ulang aplikasi (pengganti F5). */
function RefreshButton({ onRefresh }: { onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    onRefresh();
    window.dispatchEvent(new CustomEvent('simsa:refresh'));
    const t0 = Date.now();
    try {
      await queryClient.invalidateQueries({
        refetchType: 'active',
        // Isi naskah yang sedang disunting tidak dimuat ulang agar suntingan tidak tertimpa.
        predicate: (q) => q.queryKey[3] !== 'naskah-doc',
      });
    } finally {
      window.setTimeout(() => setBusy(false), Math.max(0, 500 - (Date.now() - t0)));
    }
  };
  return (
    <button className={`icon-btn tb-refresh ${busy ? 'busy' : ''}`} onClick={run} aria-label="Muat ulang data halaman ini" title="Muat ulang data" aria-busy={busy}>
      <IconRefresh size={17} />
    </button>
  );
}
