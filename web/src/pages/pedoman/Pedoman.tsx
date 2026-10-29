import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../../lib/auth';
import { useAsync } from '../../lib/useAsync';
import { must, supabase } from '../../lib/supabase';
import { getMyThesis } from '../../lib/queries';
import { useProdi } from '../../lib/master';
import { openFile } from '../../lib/files';
import { fmtDate } from '../../lib/format';
import { Badge, Button, Empty, ErrorNote, Loading, PageHeader, Panel } from '../../components/ui';
import { IconBookmark, IconBookmarkFill, IconSearch } from '../../components/Icons';
import { useToast } from '../../components/Toast';

export interface Guideline {
  id: string;
  prodi_id: string;
  judul: string;
  versi: string;
  berlaku_mulai: string;
  gaya_sitasi: string;
  file_path: string | null;
  aktif: boolean;
}
export interface Section {
  id: string;
  guideline_id: string;
  parent_id: string | null;
  urutan: number;
  nomor: string | null;
  judul: string;
  isi: string;
  kategori: 'umum' | 'sistematika' | 'aturan' | 'rubrik';
}

export const KATEGORI_LABEL: Record<Section['kategori'], string> = {
  umum: 'Umum',
  sistematika: 'Sistematika',
  aturan: 'Aturan penulisan',
  rubrik: 'Rubrik pemeriksaan',
};

function highlight(text: string, q: string): ReactNode {
  const words = q
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 2);
  if (!words.length) return text;
  const re = new RegExp(`(${words.join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>));
}

export function Pedoman() {
  const { userId, profile, active } = useAuth();
  const toast = useToast();
  const prodiList = useProdi();
  const [guidelineId, setGuidelineId] = useState<string>('');
  const [selected, setSelected] = useState<string>('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [onlyMarks, setOnlyMarks] = useState(false);

  const gl = useAsync(async () => {
    const list = (await must(supabase.from('guidelines').select('*').eq('aktif', true).order('berlaku_mulai', { ascending: false }))) as Guideline[];
    let preferred: string | null = null;
    if (active?.role === 'mahasiswa') preferred = (await getMyThesis(userId!))?.guideline_id ?? null;
    const prodi = active?.role === 'kaprodi' ? active.prodi_id : profile?.prodi_id;
    return { list, preferred: preferred ?? list.find((g) => g.prodi_id === prodi)?.id ?? list[0]?.id ?? '' };
  }, [userId, active?.role]);

  useEffect(() => {
    if (gl.data && !guidelineId) setGuidelineId(gl.data.preferred);
  }, [gl.data, guidelineId]);

  const sec = useAsync(async () => {
    if (!guidelineId) return { sections: [] as Section[], marks: new Set<string>() };
    const [sections, marks] = await Promise.all([
      must(supabase.from('guideline_sections').select('*').eq('guideline_id', guidelineId).order('urutan')),
      must(supabase.from('guideline_bookmarks').select('section_id').eq('user_id', userId!)),
    ]);
    return { sections: sections as Section[], marks: new Set((marks as { section_id: string }[]).map((m) => m.section_id)) };
  }, [guidelineId, userId]);

  const search = useAsync(async () => {
    if (!query.trim() || !guidelineId) return null;
    return (await must(
      supabase.from('guideline_sections').select('*').eq('guideline_id', guidelineId).textSearch('pencarian', query, { type: 'websearch', config: 'simple' }).limit(50),
    )) as Section[];
  }, [query, guidelineId]);

  const sections = sec.data?.sections ?? [];
  const marks = sec.data?.marks ?? new Set<string>();
  const top = useMemo(() => sections.filter((s) => !s.parent_id), [sections]);
  const children = (id: string) => sections.filter((s) => s.parent_id === id);

  useEffect(() => {
    if (top.length && !sections.some((s) => s.id === selected)) setSelected(top[0].id);
  }, [top, sections, selected]);

  const toggleMark = async (id: string) => {
    try {
      if (marks.has(id)) await must(supabase.from('guideline_bookmarks').delete().eq('user_id', userId!).eq('section_id', id));
      else await must(supabase.from('guideline_bookmarks').insert({ user_id: userId, section_id: id }));
      sec.reload();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };

  if (gl.loading && !gl.data) return <Loading variant="detail" />;
  if (gl.error) return <ErrorNote error={gl.error} onRetry={gl.reload} />;
  const guidelines = gl.data!.list;
  const g = guidelines.find((x) => x.id === guidelineId);

  if (!guidelines.length)
    return (
      <>
        <PageHeader title="Pedoman" />
        <Panel>
          <Empty title="Belum ada pedoman aktif">Ka. Prodi atau Admin dapat menambahkan pedoman di menu Kelola pedoman.</Empty>
        </Panel>
      </>
    );

  const current = sections.find((s) => s.id === selected);
  const currentTop = current?.parent_id ? sections.find((s) => s.id === current.parent_id) : current;
  const markedList = sections.filter((s) => marks.has(s.id));

  const renderSection = (s: Section, level: number) => (
    <div key={s.id} id={`sec-${s.id}`} className={level > 0 ? 'sub' : undefined}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div>
          {level === 0 ? (
            <h2>
              {s.nomor && <span className="muted">{s.nomor} </span>}
              {s.judul}
            </h2>
          ) : (
            <h3>
              {s.nomor && <span className="muted">{s.nomor} </span>}
              {s.judul}
            </h3>
          )}
          {s.kategori !== 'umum' && (
            <div style={{ marginTop: 6 }}>
              <Badge tone={s.kategori === 'rubrik' ? 'warn' : s.kategori === 'aturan' ? 'info' : 'brand'}>{KATEGORI_LABEL[s.kategori]}</Badge>
            </div>
          )}
        </div>
        <button className="icon-btn" aria-label={marks.has(s.id) ? 'Hapus penanda' : 'Tandai bagian ini'} title={marks.has(s.id) ? 'Hapus penanda' : 'Tandai bagian ini'} onClick={() => toggleMark(s.id)}>
          {marks.has(s.id) ? <IconBookmarkFill /> : <IconBookmark />}
        </button>
      </div>
      {s.isi && <div className="body">{query ? highlight(s.isi, query) : s.isi}</div>}
      {children(s.id).map((c) => renderSection(c, level + 1))}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Pedoman"
        description={g ? `${g.judul}. Versi ${g.versi}, berlaku ${fmtDate(g.berlaku_mulai)}. Gaya sitasi ${g.gaya_sitasi}.` : undefined}
        actions={
          <>
            {guidelines.length > 1 && (
              <select
                style={{ maxWidth: 320 }}
                value={guidelineId}
                onChange={(e) => {
                  setGuidelineId(e.target.value);
                  setQuery('');
                  setQ('');
                }}
                aria-label="Pilih pedoman"
              >
                {guidelines.map((x) => (
                  <option key={x.id} value={x.id}>
                    {prodiList.find((p) => p.id === x.prodi_id)?.kode ?? ''} {x.judul}
                  </option>
                ))}
              </select>
            )}
            {g?.file_path && <Button onClick={() => openFile('guidelines', g.file_path!).catch((e) => toast.show(e.message, 'bad'))}>Buka PDF asli</Button>}
          </>
        }
      />
      <div className="guide">
        <Panel className="guide-toc" flush>
          <form
            style={{ padding: 12, borderBottom: '1px solid var(--line)' }}
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(q.trim());
            }}
          >
            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <input style={{ flex: 1, minWidth: 0 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari di pedoman" aria-label="Cari di pedoman" />
              <button className="btn" type="submit" aria-label="Cari">
                <IconSearch size={16} />
              </button>
            </div>
            <div className="row" style={{ marginTop: 8, gap: 12 }}>
              <label className="check small">
                <input type="checkbox" checked={onlyMarks} onChange={(e) => setOnlyMarks(e.target.checked)} /> Penanda saya ({markedList.length})
              </label>
              {query && (
                <button
                  type="button"
                  className="btn-link small"
                  onClick={() => {
                    setQuery('');
                    setQ('');
                  }}
                >
                  Hapus pencarian
                </button>
              )}
            </div>
          </form>
          <div style={{ padding: 8 }}>
            {query ? (
              search.loading ? (
                <Loading label="Mencari…" />
              ) : (search.data ?? []).length === 0 ? (
                <p className="muted small" style={{ padding: 8 }}>
                  Tidak ada bagian yang memuat "{query}".
                </p>
              ) : (
                <ul>
                  {(search.data ?? []).map((s) => (
                    <li key={s.id}>
                      <button className={selected === s.id ? 'active' : ''} onClick={() => setSelected(s.id)}>
                        <span className="muted">{s.nomor}</span> {s.judul}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : onlyMarks ? (
              <ul>
                {markedList.map((s) => (
                  <li key={s.id}>
                    <button className={selected === s.id ? 'active' : ''} onClick={() => setSelected(s.id)}>
                      <span className="muted">{s.nomor}</span> {s.judul}
                    </button>
                  </li>
                ))}
                {markedList.length === 0 && <li className="muted small" style={{ padding: 8 }}>Belum ada penanda.</li>}
              </ul>
            ) : (
              <ul>
                {top.map((s) => (
                  <li key={s.id}>
                    <button className={selected === s.id ? 'active' : ''} onClick={() => setSelected(s.id)}>
                      <span className="muted">{s.nomor}</span> {s.judul}
                    </button>
                    {children(s.id).length > 0 && (
                      <ul>
                        {children(s.id).map((c) => (
                          <li key={c.id}>
                            <button className={selected === c.id ? 'active' : ''} onClick={() => setSelected(c.id)}>
                              <span className="muted">{c.nomor}</span> {c.judul}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
        <Panel flush>
          {sec.loading && !sec.data ? (
            <Loading variant="block" />
          ) : sec.error ? (
            <ErrorNote error={sec.error} onRetry={sec.reload} />
          ) : !current ? (
            <Empty title="Pedoman ini belum memiliki isi" />
          ) : (
            <article className="guide-doc">{query || current.parent_id ? renderSection(current, 0) : renderSection(currentTop!, 0)}</article>
          )}
        </Panel>
      </div>
    </>
  );
}
