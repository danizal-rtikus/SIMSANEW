import { useEffect, useRef, useState, type ReactNode } from 'react';
import { rpc } from '../../lib/queries';
import { fmtDateTime } from '../../lib/format';
import type { CommentThread } from '../../lib/naskah/review';
import type { CommentStatus } from '../../lib/types';
import { Button } from '../../components/ui';
import { useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import { IconChevronDown, IconMore } from '../../components/Icons';

const STATUS_LABEL: Record<CommentStatus, string> = {
  terbuka: 'Terbuka',
  diperbaiki: 'Diperbaiki',
  selesai: 'Selesai',
};

type Filter = 'aktif' | 'selesai' | 'semua';

/**
 * Panel komentar review: kepala (judul + filter), daftar yang dapat digulir,
 * dan kaki opsional (mis. keputusan review) yang selalu terlihat.
 * mode "mahasiswa": balas, tandai sudah diperbaiki.
 * mode "dosen"    : balas, selesaikan / buka lagi, ubah atau hapus draf sendiri.
 * mode "baca"     : hanya membaca.
 */
export function CommentPanel({
  list,
  mode,
  userId,
  peran,
  activeId,
  orphans,
  nomorPengajuan,
  onActivate,
  onChanged,
  title = 'Catatan dosen',
  empty = 'Belum ada komentar.',
  composer,
  footer,
}: {
  list: CommentThread[];
  mode: 'mahasiswa' | 'dosen' | 'baca';
  userId: string | null;
  peran: Map<string, 'P1' | 'P2'>;
  activeId: string | null;
  orphans: Set<string>;
  nomorPengajuan: Map<string, number>;
  onActivate: (id: string) => void;
  onChanged: () => void;
  title?: string;
  empty?: string;
  composer?: ReactNode;
  footer?: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>('aktif');
  const [draftOpen, setDraftOpen] = useState(true);
  const match = (t: CommentThread) => (filter === 'semua' ? true : filter === 'selesai' ? t.root.status === 'selesai' : t.root.status !== 'selesai');
  const drafts = list.filter((t) => !t.root.terkirim && t.root.penulis_id === userId);
  const sent = list.filter((t) => !(!t.root.terkirim && t.root.penulis_id === userId) && match(t));
  const aktif = list.filter((t) => t.root.status !== 'selesai').length;

  // Buka bagian draf bila komentar aktif berada di sana.
  useEffect(() => {
    if (activeId && drafts.some((t) => t.root.id === activeId)) setDraftOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const card = (t: CommentThread) => (
    <Thread
      key={t.root.id}
      t={t}
      mode={mode}
      userId={userId}
      peran={peran}
      active={activeId === t.root.id}
      orphan={orphans.has(t.root.id)}
      nomor={nomorPengajuan.get(t.root.submission_id)}
      onActivate={onActivate}
      onChanged={onChanged}
    />
  );

  return (
    <aside className={`nk-comments ${footer ? 'has-footer' : ''}`} aria-label={title}>
      <div className="nk-comments-head">
        <span className="strong">{title}</span>
        <div className="nk-seg" role="tablist">
          {(
            [
              ['aktif', `Aktif (${aktif})`],
              ['selesai', 'Selesai'],
              ['semua', 'Semua'],
            ] as [Filter, string][]
          ).map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={filter === v} className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="nk-comments-body">
        {composer}
        {drafts.length > 0 && (
          <section className="nk-cgroup">
            <button type="button" className="nk-cgroup-head" aria-expanded={draftOpen} onClick={() => setDraftOpen(!draftOpen)}>
              <IconChevronDown size={14} style={{ transform: draftOpen ? undefined : 'rotate(-90deg)' }} />
              <span>Draf saya ({drafts.length})</span>
              <span className="muted small">belum terlihat mahasiswa</span>
            </button>
            {draftOpen && <ul className="nk-thread-list">{drafts.map(card)}</ul>}
          </section>
        )}
        {(drafts.length > 0 || sent.length > 0) && drafts.length > 0 && (
          <div className="nk-cgroup-head static">
            <span>Terkirim ({sent.length})</span>
          </div>
        )}
        {sent.length === 0 && drafts.length === 0 ? (
          <p className="muted small nk-comments-empty">{list.length ? 'Tidak ada komentar pada filter ini.' : empty}</p>
        ) : sent.length === 0 ? (
          <p className="muted small nk-comments-empty">Belum ada komentar terkirim pada filter ini.</p>
        ) : (
          <ul className="nk-thread-list">{sent.map(card)}</ul>
        )}
      </div>

      {footer && <div className="nk-comments-foot">{footer}</div>}
    </aside>
  );
}

function Thread({
  t,
  mode,
  userId,
  peran,
  active,
  orphan,
  nomor,
  onActivate,
  onChanged,
}: {
  t: CommentThread;
  mode: 'mahasiswa' | 'dosen' | 'baca';
  userId: string | null;
  peran: Map<string, 'P1' | 'P2'>;
  active: boolean;
  orphan: boolean;
  nomor?: number;
  onActivate: (id: string) => void;
  onChanged: () => void;
}) {
  const dialog = useDialog();
  const toast = useToast();
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const c = t.root;
  const mine = c.penulis_id === userId;
  const draft = !c.terkirim;
  const who = peran.get(c.penulis_id);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.show(ok, 'ok');
      onChanged();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const edit = async () => {
    setMenu(false);
    const isi = await dialog.prompt({ title: 'Ubah komentar', label: 'Komentar', multiline: true, required: true, initial: c.isi, confirmLabel: 'Simpan' });
    if (isi) run(() => rpc('ubah_komentar', { p_id: c.id, p_isi: isi }));
  };
  const remove = async () => {
    setMenu(false);
    const ok = await dialog.confirm({ title: 'Hapus komentar draf?', message: c.kutipan ? `Pada: "${c.kutipan.slice(0, 120)}${c.kutipan.length > 120 ? '…' : ''}"` : undefined, confirmLabel: 'Hapus', danger: true });
    if (ok) run(() => rpc('hapus_komentar', { p_id: c.id }));
  };
  const sendReply = () => {
    if (!reply?.trim()) return;
    run(async () => {
      await rpc('balas_komentar', { p_parent: c.id, p_isi: reply.trim() });
      setReply(null);
    });
  };
  const setStatus = (status: CommentStatus, ok: string) => run(() => rpc('tandai_komentar', { p_id: c.id, p_status: status }), ok);

  const canMenu = draft && mine && mode !== 'baca';

  return (
    <li
      id={`cmt-${c.id}`}
      className={`nk-thread ${active ? 'active' : ''} ${c.status} ${who ? who.toLowerCase() : ''} ${draft ? 'draf' : ''}`}
      onClick={() => onActivate(c.id)}
    >
      <div className="nk-thread-top">
        <span className={`nk-who ${who ? who.toLowerCase() : ''}`}>{who ?? 'Dosen'}</span>
        <span className="nk-thread-name">{c.penulis?.nama ?? ''}</span>
        {draft ? <span className="nk-tag draf">Draf</span> : <span className={`nk-tag ${c.status}`}>{STATUS_LABEL[c.status]}</span>}
        {canMenu && (
          <div className="nk-menu" ref={menuRef} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="nk-menu-btn" aria-label="Pilihan komentar" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              <IconMore size={16} />
            </button>
            {menu && (
              <div className="nk-menu-pop" role="menu">
                <button type="button" role="menuitem" onClick={edit}>
                  Ubah
                </button>
                <button type="button" role="menuitem" className="danger" onClick={remove}>
                  Hapus
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="nk-thread-sub muted small">
        {fmtDateTime(c.created_at)}
        {nomor ? ` · pengajuan ke-${nomor}` : ''}
        {!active && t.replies.length > 0 ? ` · ${t.replies.length} balasan` : ''}
      </div>
      {orphan && <div className="nk-tag warn nk-orphan">Teks yang dikomentari sudah berubah</div>}
      {c.kutipan && <blockquote className={`nk-quote ${active ? '' : 'clamp'}`}>{c.kutipan}</blockquote>}
      <p className={`nk-thread-body ${active ? '' : 'clamp'}`}>{c.isi}</p>

      {active &&
        t.replies.map((r) => (
          <div key={r.id} className="nk-reply">
            <div className="nk-thread-sub small">
              <span className="strong">{r.penulis?.nama ?? ''}</span>
              {peran.get(r.penulis_id) && <span className="muted"> {peran.get(r.penulis_id)}</span>}
              <span className="muted"> · {fmtDateTime(r.created_at)}</span>
            </div>
            <p className="nk-thread-body">{r.isi}</p>
          </div>
        ))}

      {active && reply !== null && (
        <div className="nk-reply-box" onClick={(e) => e.stopPropagation()}>
          <textarea autoFocus value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Tulis balasan" />
          <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" onClick={() => setReply(null)}>
              Batal
            </Button>
            <Button size="sm" variant="primary" loading={busy} disabled={!reply.trim()} onClick={sendReply}>
              Kirim balasan
            </Button>
          </div>
        </div>
      )}

      {active && mode !== 'baca' && reply === null && !draft && (
        <div className="nk-thread-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="link-btn" onClick={() => setReply('')}>
            Balas
          </button>
          {mode === 'mahasiswa' && c.status === 'terbuka' && (
            <button type="button" className="link-btn" disabled={busy} onClick={() => setStatus('diperbaiki', 'Ditandai sudah diperbaiki')}>
              Tandai sudah diperbaiki
            </button>
          )}
          {mode === 'mahasiswa' && c.status === 'diperbaiki' && (
            <button type="button" className="link-btn" disabled={busy} onClick={() => setStatus('terbuka', 'Tanda diperbaiki dibatalkan')}>
              Batalkan tanda
            </button>
          )}
          {mode === 'dosen' && c.status !== 'selesai' && (
            <button type="button" className="link-btn" disabled={busy} onClick={() => setStatus('selesai', 'Komentar diselesaikan')}>
              Selesaikan
            </button>
          )}
          {mode === 'dosen' && c.status === 'selesai' && (
            <button type="button" className="link-btn" disabled={busy} onClick={() => setStatus('terbuka', 'Komentar dibuka lagi')}>
              Buka lagi
            </button>
          )}
        </div>
      )}
    </li>
  );
}
