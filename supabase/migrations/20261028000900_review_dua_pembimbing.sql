-- =====================================================================
-- SIMSA — Migrasi 9: perbaikan alur review bab dengan dua pembimbing
--   * Revisi dari satu pembimbing tidak lagi menutup pengajuan; pembimbing
--     lain tetap dapat berkomentar dan memberi keputusan pada pengajuan itu.
--   * Pengajuan tertutup setelah semua pembimbing merespons, atau saat
--     mahasiswa mengajukan versi perbaikan (draf komentar yang tertinggal
--     ikut terkirim agar tidak hilang).
--   * Dosen dapat mengirim komentar tanpa keputusan (kirim_komentar).
--   * Komentar penguji (bukan pembimbing) langsung terkirim.
-- =====================================================================

create or replace function public.komentar_naskah(
  p_submission uuid, p_isi text, p_kutipan text, p_prefix text, p_suffix text, p_posisi jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_s public.chapter_submissions; v_id uuid;
begin
  perform priv.require_user();
  select * into v_s from public.chapter_submissions where id = p_submission;
  if not found then raise exception 'Pengajuan tidak ditemukan'; end if;
  if not (priv.is_supervisor_of(v_s.thesis_id) or priv.is_examiner_of(v_s.thesis_id)) then
    raise exception 'Hanya pembimbing atau penguji yang dapat memberi komentar';
  end if;
  if v_s.status = 'ditarik' then raise exception 'Pengajuan sudah ditarik'; end if;
  if length(trim(coalesce(p_isi, ''))) = 0 then raise exception 'Isi komentar wajib diisi'; end if;
  if length(trim(coalesce(p_kutipan, ''))) = 0 then raise exception 'Pilih teks yang dikomentari'; end if;
  insert into public.review_comments (thesis_id, submission_id, bab, penulis_id, isi, kutipan, prefix, suffix, posisi, terkirim)
  values (v_s.thesis_id, p_submission, v_s.bab, auth.uid(), trim(p_isi), left(p_kutipan, 2000), left(p_prefix, 200), left(p_suffix, 200), p_posisi,
          v_s.status <> 'diajukan' or priv.sudah_acc_bab(v_s.thesis_id, v_s.bab, auth.uid())
          or exists (select 1 from public.chapter_reviews r where r.submission_id = p_submission and r.dosen_id = auth.uid())
          or not priv.is_supervisor_of(v_s.thesis_id))
  returning id into v_id;
  return v_id;
end;
$$;


create or replace function public.ajukan_bab(p_thesis uuid, p_bab int, p_catatan text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_th public.thesis;
  v_ms public.thesis_manuscripts;
  v_slice jsonb;
  v_judul text;
  v_nomor int;
  v_ver uuid;
  v_ver_no int;
  v_mil public.thesis_milestones;
  v_id uuid;
  v_last public.chapter_submissions;
begin
  perform priv.require_user();
  select * into v_th from public.thesis where id = p_thesis;
  if not found then raise exception 'Tugas akhir tidak ditemukan'; end if;
  if v_th.mahasiswa_id <> auth.uid() then raise exception 'Hanya mahasiswa pemilik yang dapat mengajukan bab'; end if;
  if v_th.status <> 'aktif' then raise exception 'Studi akhir tidak aktif'; end if;
  if not exists (select 1 from public.thesis_supervisors where thesis_id = p_thesis and aktif) then
    raise exception 'Pembimbing belum ditetapkan';
  end if;

  select * into v_ms from public.thesis_manuscripts where thesis_id = p_thesis;
  if not found then raise exception 'Naskah masih kosong'; end if;
  v_slice := priv.slice_bab(v_ms.konten, p_bab);
  if v_slice is null then raise exception 'Bab % tidak ditemukan di naskah', p_bab; end if;
  if length(trim(priv.node_text(jsonb_build_object('content', (v_slice->'content') - 0)))) < 20 then
    raise exception 'Isi Bab % masih kosong', p_bab;
  end if;
  v_judul := trim(priv.node_text(v_slice->'content'->0));

  -- Pengajuan yang masih terbuka: boleh digantikan bila sudah ada permintaan revisi.
  select * into v_last from public.chapter_submissions where thesis_id = p_thesis and bab = p_bab and status = 'diajukan';
  if found then
    if not exists (select 1 from public.chapter_reviews where submission_id = v_last.id and hasil = 'revisi') then
      raise exception 'Bab % masih menunggu review. Tarik pengajuan bila ingin mengganti isinya.', p_bab;
    end if;
    -- Kirim draf komentar yang tertinggal agar tidak hilang, lalu tutup pengajuan lama.
    update public.review_comments set terkirim = true, updated_at = now() where submission_id = v_last.id and not terkirim;
    update public.chapter_submissions set status = 'revisi', ditutup_at = now() where id = v_last.id;
  end if;
  select * into v_last from public.chapter_submissions where thesis_id = p_thesis and bab = p_bab and status <> 'ditarik'
   order by nomor desc limit 1;
  if found and v_last.status = 'acc' then raise exception 'Bab % sudah di-ACC', p_bab; end if;
  if exists (select 1 from public.thesis_milestones where thesis_id = p_thesis and kode = 'BAB' || p_bab and status = 'selesai') then
    raise exception 'Bab % sudah di-ACC Pembimbing 1 dan 2', p_bab;
  end if;
  if found and v_last.konten = v_slice then raise exception 'Isi Bab % belum berubah sejak pengajuan ke-%', p_bab, v_last.nomor; end if;

  select coalesce(max(nomor), 0) + 1 into v_nomor from public.chapter_submissions where thesis_id = p_thesis and bab = p_bab;

  -- Potret seluruh naskah sebagai versi
  select coalesce(max(nomor), 0) + 1 into v_ver_no from public.manuscript_versions where thesis_id = p_thesis;
  insert into public.manuscript_versions (thesis_id, nomor, konten, jumlah_kata, catatan, dibuat_oleh)
  values (p_thesis, v_ver_no, v_ms.konten, v_ms.jumlah_kata, format('Pengajuan Bab %s (ke-%s)', p_bab, v_nomor), auth.uid())
  returning id into v_ver;

  select * into v_mil from public.thesis_milestones where thesis_id = p_thesis and kode = 'BAB' || p_bab;

  insert into public.chapter_submissions (thesis_id, bab, nomor, judul, konten, version_id, milestone_id, catatan, diajukan_oleh)
  values (p_thesis, p_bab, v_nomor, coalesce(nullif(v_judul, ''), 'Bab ' || p_bab), v_slice, v_ver, v_mil.id,
          nullif(trim(coalesce(p_catatan, '')), ''), auth.uid())
  returning id into v_id;

  if v_mil.id is not null and v_mil.status not in ('selesai') then
    perform priv.set_milestone_status(v_mil.id, 'menunggu_review', format('Bab %s diajukan untuk review (ke-%s)', p_bab, v_nomor));
  end if;

  perform priv.notify(s.dosen_id, 'pengajuan_bab', format('Pengajuan Bab %s: %s', p_bab, initcap(lower(v_judul))),
                      (select nama from public.profiles where id = auth.uid()) || format(' mengajukan Bab %s (pengajuan ke-%s).', p_bab, v_nomor),
                      '/naskah/' || p_thesis || '/ajuan/' || v_id)
  from public.thesis_supervisors s where s.thesis_id = p_thesis and s.aktif;
  return v_id;
end;
$$;


create or replace function public.tinjau_bab(p_submission uuid, p_hasil text, p_catatan text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_s public.chapter_submissions;
  v_peran public.supervisor_role;
  v_mhs uuid;
  v_need int;
  v_acc int;
  v_res text := 'tercatat';
  v_draf int;
  v_respon int;
begin
  perform priv.require_user();
  select * into v_s from public.chapter_submissions where id = p_submission for update;
  if not found then raise exception 'Pengajuan tidak ditemukan'; end if;
  select peran into v_peran from public.thesis_supervisors where thesis_id = v_s.thesis_id and dosen_id = auth.uid() and aktif;
  if v_peran is null then raise exception 'Hanya Pembimbing 1 atau 2 yang dapat memberi keputusan review'; end if;
  if p_hasil not in ('revisi', 'acc') then raise exception 'Keputusan harus Revisi atau ACC'; end if;
  if exists (select 1 from public.chapter_submissions where thesis_id = v_s.thesis_id and bab = v_s.bab and nomor > v_s.nomor and status <> 'ditarik') then
    raise exception 'Sudah ada pengajuan yang lebih baru untuk bab ini';
  end if;
  if v_s.status <> 'diajukan' then raise exception 'Pengajuan sudah ditutup'; end if;
  if exists (select 1 from public.chapter_reviews where submission_id = p_submission and dosen_id = auth.uid()) then
    raise exception 'Anda sudah memberi keputusan untuk pengajuan ini';
  end if;
  if priv.sudah_acc_bab(v_s.thesis_id, v_s.bab, auth.uid()) then
    raise exception 'Anda sudah memberi ACC untuk Bab %; menunggu pembimbing lainnya', v_s.bab;
  end if;
  if p_hasil = 'revisi' and length(trim(coalesce(p_catatan, ''))) = 0
     and not exists (select 1 from public.review_comments where submission_id = p_submission and penulis_id = auth.uid() and parent_id is null) then
    raise exception 'Beri komentar pada naskah atau catatan revisi';
  end if;

  select mahasiswa_id into v_mhs from public.thesis where id = v_s.thesis_id;

  if p_hasil = 'acc' then
    if v_s.milestone_id is not null then
      v_res := priv.acc_milestone(v_s.milestone_id, coalesce(nullif(trim(coalesce(p_catatan,'')), ''), format('ACC lewat review Bab %s (pengajuan ke-%s)', v_s.bab, v_s.nomor)), null);
    end if;
  end if;

  update public.review_comments set terkirim = true, updated_at = now()
   where submission_id = p_submission and penulis_id = auth.uid() and not terkirim;
  get diagnostics v_draf = row_count;

  insert into public.chapter_reviews (submission_id, thesis_id, dosen_id, peran, hasil, catatan)
  values (p_submission, v_s.thesis_id, auth.uid(), v_peran, p_hasil, nullif(trim(coalesce(p_catatan, '')), ''));

  select count(*) into v_need from public.thesis_supervisors where thesis_id = v_s.thesis_id and aktif;
  select count(*) into v_acc from public.thesis_supervisors s
   where s.thesis_id = v_s.thesis_id and s.aktif and priv.sudah_acc_bab(v_s.thesis_id, v_s.bab, s.dosen_id);
  -- Pembimbing yang sudah merespons pengajuan ini (atau sudah ACC bab ini sebelumnya)
  select count(*) into v_respon from public.thesis_supervisors s
   where s.thesis_id = v_s.thesis_id and s.aktif
     and (exists (select 1 from public.chapter_reviews r where r.submission_id = p_submission and r.dosen_id = s.dosen_id)
          or priv.sudah_acc_bab(v_s.thesis_id, v_s.bab, s.dosen_id));

  if p_hasil = 'revisi' then
    -- Pengajuan tetap terbuka untuk pembimbing lain sampai semua merespons
    -- (atau mahasiswa mengajukan versi perbaikan lebih dulu).
    if v_respon >= v_need then
      update public.chapter_submissions set status = 'revisi', ditutup_at = coalesce(ditutup_at, now()) where id = p_submission;
    end if;
    if v_s.milestone_id is not null then
      update public.thesis_milestones set status = 'revisi' where id = v_s.milestone_id and status <> 'selesai';
    end if;
    perform priv.notify(v_mhs, 'review_bab', format('Revisi Bab %s dari %s', v_s.bab, v_peran),
                        format('%s komentar baru. %s', v_draf, coalesce(nullif(trim(coalesce(p_catatan,'')), ''), 'Lihat catatan di naskah.')), '/naskah');
  elsif v_acc >= v_need and v_need >= 1 then
    update public.chapter_submissions set status = 'acc', ditutup_at = now() where id = p_submission;
    perform priv.notify(v_mhs, 'review_bab', format('Bab %s di-ACC', v_s.bab), 'Pembimbing 1 dan 2 sudah memberi ACC.', '/naskah');
  else
    if v_respon >= v_need then
      update public.chapter_submissions set status = 'revisi', ditutup_at = coalesce(ditutup_at, now()) where id = p_submission;
    end if;
    perform priv.notify(v_mhs, 'review_bab', format('ACC %s untuk Bab %s', v_peran, v_s.bab),
                        case when v_draf > 0 then format('%s komentar ditambahkan. ', v_draf) else '' end || 'Menunggu pembimbing lainnya.', '/naskah');
  end if;
  return coalesce(v_res, 'tercatat');
end;
$$;


-- Kirim draf komentar sekarang tanpa memberi keputusan.
create or replace function public.kirim_komentar(p_submission uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_s public.chapter_submissions; v_n int; v_mhs uuid;
begin
  perform priv.require_user();
  select * into v_s from public.chapter_submissions where id = p_submission;
  if not found then raise exception 'Pengajuan tidak ditemukan'; end if;
  update public.review_comments set terkirim = true, updated_at = now()
   where submission_id = p_submission and penulis_id = auth.uid() and not terkirim and parent_id is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Tidak ada komentar draf untuk dikirim'; end if;
  select mahasiswa_id into v_mhs from public.thesis where id = v_s.thesis_id;
  perform priv.notify(v_mhs, 'review_bab', format('%s komentar baru pada Bab %s', v_n, v_s.bab),
                      (select nama from public.profiles where id = auth.uid()) || ' menambahkan komentar. Keputusan review menyusul.', '/naskah');
  return v_n;
end;
$$;

revoke execute on function public.kirim_komentar(uuid) from public, anon;
grant execute on function public.kirim_komentar(uuid) to authenticated;

-- Perbaiki data yang sudah terlanjur: pengajuan berstatus revisi yang belum
-- direspons semua pembimbing dan belum digantikan, dibuka kembali.
update public.chapter_submissions s set status = 'diajukan', ditutup_at = null
 where s.status = 'revisi'
   and not exists (select 1 from public.chapter_submissions n where n.thesis_id = s.thesis_id and n.bab = s.bab and n.nomor > s.nomor and n.status <> 'ditarik')
   and (select count(*) from public.chapter_reviews r where r.submission_id = s.id)
       < (select count(*) from public.thesis_supervisors p where p.thesis_id = s.thesis_id and p.aktif)
   and not exists (select 1 from public.chapter_submissions o where o.thesis_id = s.thesis_id and o.bab = s.bab and o.status = 'diajukan');

-- Draf komentar yang tertinggal di pengajuan lama (sudah digantikan) dikirim.
update public.review_comments c set terkirim = true, updated_at = now()
 where not c.terkirim
   and exists (select 1 from public.chapter_submissions s join public.chapter_submissions n
                 on n.thesis_id = s.thesis_id and n.bab = s.bab and n.nomor > s.nomor and n.status <> 'ditarik'
                where s.id = c.submission_id);
