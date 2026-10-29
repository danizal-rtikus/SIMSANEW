-- =====================================================================
-- SIMSA — Migrasi 16: dashboard akreditasi
--   * Tahun akademik TS ditetapkan Admin; TS-1, TS-2, dst. mengikuti.
--   * Batas tepat waktu dalam semester (bawaan S1 8, D3 6).
--   * Jumlah mahasiswa diterima per prodi per angkatan (diisi Admin atau
--     Ka. Prodi) untuk persentase keberhasilan studi.
--   * Lembaga akreditasi per prodi (LAM INFOKOM, LAM DEPILAR, ...).
--   * RPC dashboard_akreditasi: Admin dan Pimpinan semua prodi,
--     Ka. Prodi hanya prodinya.
--
-- Definisi yang dipakai:
--   Tanggal lulus   = tanggal milestone Yudisium selesai (bila tidak ada,
--                     milestone terakhir yang selesai pada studi akhir lulus).
--   Semester lulus  = semester ke-n sejak semester Ganjil tahun angkatan,
--                     dihitung dari kalender Tahun Akademik (bila tanggalnya
--                     tidak tercakup: Ganjil Sep–Feb, Genap Mar–Ags).
--   Masa studi      = semester lulus / 2 (tahun).
--   Tepat waktu     = semester lulus <= batas semester jenjang.
-- Aman dijalankan ulang.
-- =====================================================================

alter table public.prodi add column if not exists lembaga_akreditasi text;
update public.prodi
set lembaga_akreditasi = case when nama ilike '%desain%' or kode ilike 'DKV%' then 'LAM DEPILAR' else 'LAM INFOKOM' end
where lembaga_akreditasi is null;

create table if not exists public.akreditasi_pengaturan (
  id int primary key default 1 check (id = 1),
  ts_tahun int not null check (ts_tahun between 2000 and 2100),
  batas_semester_s1 int not null default 8 check (batas_semester_s1 between 6 and 14),
  batas_semester_d3 int not null default 6 check (batas_semester_d3 between 4 and 10),
  diubah_oleh uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.akreditasi_pengaturan (id, ts_tahun)
values (1, extract(year from current_date)::int - case when extract(month from current_date) < 9 then 1 else 0 end)
on conflict (id) do nothing;

create table if not exists public.akreditasi_mahasiswa_baru (
  prodi_id uuid not null references public.prodi (id) on delete cascade,
  angkatan int not null check (angkatan between 1990 and 2100),
  jumlah int not null check (jumlah >= 0),
  diubah_oleh uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (prodi_id, angkatan)
);

alter table public.akreditasi_pengaturan enable row level security;
alter table public.akreditasi_mahasiswa_baru enable row level security;
drop policy if exists akreditasi_pengaturan_select on public.akreditasi_pengaturan;
create policy akreditasi_pengaturan_select on public.akreditasi_pengaturan for select to authenticated using ((select priv.is_staff()));
drop policy if exists akreditasi_mahasiswa_baru_select on public.akreditasi_mahasiswa_baru;
create policy akreditasi_mahasiswa_baru_select on public.akreditasi_mahasiswa_baru for select to authenticated using ((select priv.is_staff()));
revoke all on public.akreditasi_pengaturan, public.akreditasi_mahasiswa_baru from anon;
grant select on public.akreditasi_pengaturan, public.akreditasi_mahasiswa_baru to authenticated;

-- ---------------------------------------------------------------------
-- Kalender akademik
-- ---------------------------------------------------------------------

/** Tahun akademik (tahun awal) dan semester dari sebuah tanggal. */
create or replace function priv.semester_ta(p_tgl date, out tahun int, out genap boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_nama text;
begin
  select nama into v_nama from public.academic_years
  where p_tgl between mulai and selesai and nama ~ '^\d{4}'
  order by mulai desc limit 1;
  if v_nama is not null then
    tahun := substring(v_nama from '^(\d{4})')::int;
    genap := v_nama ilike '%genap%';
    return;
  end if;
  if extract(month from p_tgl) >= 9 then
    tahun := extract(year from p_tgl)::int; genap := false;
  elsif extract(month from p_tgl) <= 2 then
    tahun := extract(year from p_tgl)::int - 1; genap := false;
  else
    tahun := extract(year from p_tgl)::int - 1; genap := true;
  end if;
end;
$$;

/** Rentang tanggal satu semester (p_genap) atau satu tahun akademik (p_genap null). */
create or replace function priv.rentang_ta(p_tahun int, p_genap boolean, out mulai date, out selesai date)
language plpgsql stable security definer set search_path = public as $$
begin
  select min(a.mulai), max(a.selesai) into mulai, selesai
  from public.academic_years a
  where a.nama like p_tahun || '/%'
    and (p_genap is null or (a.nama ilike '%genap%') = p_genap);
  if mulai is null then
    mulai := case when p_genap is true then make_date(p_tahun + 1, 3, 1) else make_date(p_tahun, 9, 1) end;
    selesai := case when p_genap is false then (make_date(p_tahun + 1, 3, 1) - 1) else make_date(p_tahun + 1, 8, 31) end;
  end if;
end;
$$;

create or replace function priv.semester_ke(p_angkatan int, p_tgl date)
returns int language sql stable security definer set search_path = public as $$
  select case when p_angkatan is null or p_tgl is null then null
    else (s.tahun - p_angkatan) * 2 + case when s.genap then 2 else 1 end end
  from priv.semester_ta(p_tgl) s;
$$;

-- ---------------------------------------------------------------------
-- Data per studi akhir untuk akreditasi
-- ---------------------------------------------------------------------
create or replace function priv.akr_tesis(p_prodi uuid[])
returns table (
  thesis_id uuid, prodi_id uuid, jenjang public.jenjang, mahasiswa_id uuid, nama text, nim text, angkatan int,
  status text, bidang text, mulai date,
  tgl_pembimbing date, tgl_sempro date, tgl_semhas date, tgl_ujian_akhir date, tgl_lulus date,
  lulus_tahun int, semester_lulus int, batas int, tahap text
)
language sql stable security definer set search_path = public as $$
  with cfg as (select batas_semester_s1, batas_semester_d3 from public.akreditasi_pengaturan where id = 1),
  m as (
    select tm.thesis_id,
      max(tm.selesai_at) filter (where tm.jenis = 'pembimbing' and tm.status = 'selesai')::date as tgl_pembimbing,
      max(tm.selesai_at) filter (where tm.ujian_jenis = 'sempro' and tm.jenis = 'ujian' and tm.status = 'selesai')::date as tgl_sempro,
      max(tm.selesai_at) filter (where tm.ujian_jenis = 'semhas' and tm.jenis = 'ujian' and tm.status = 'selesai')::date as tgl_semhas,
      max(tm.selesai_at) filter (where tm.ujian_jenis in ('pendadaran', 'd3') and tm.jenis = 'ujian' and tm.status = 'selesai')::date as tgl_ujian_akhir,
      max(tm.selesai_at) filter (where tm.jenis = 'yudisium' and tm.status = 'selesai')::date as tgl_yudisium,
      max(tm.selesai_at) filter (where tm.status = 'selesai')::date as tgl_terakhir,
      (array_agg(tm.nama order by tm.urutan) filter (where tm.status <> 'selesai'))[1] as tahap
    from public.thesis_milestones tm
    group by tm.thesis_id
  ),
  b as (
    select t.id as thesis_id, t.prodi_id, t.jenjang, t.mahasiswa_id, p.nama, p.nim,
      coalesce(p.angkatan, priv.angkatan_dari_nim(p.nim)) as angkatan,
      t.status, nullif(trim(t.bidang_kajian), '') as bidang, t.mulai,
      m.tgl_pembimbing, m.tgl_sempro, m.tgl_semhas, m.tgl_ujian_akhir,
      case when m.tgl_yudisium is not null then m.tgl_yudisium when t.status = 'lulus' then m.tgl_terakhir end as tgl_lulus,
      case when t.jenjang = 'D3' then (select batas_semester_d3 from cfg) else (select batas_semester_s1 from cfg) end as batas,
      m.tahap
    from public.thesis t
    join public.profiles p on p.id = t.mahasiswa_id
    left join m on m.thesis_id = t.id
    where p_prodi is null or t.prodi_id = any (p_prodi)
  )
  select b.thesis_id, b.prodi_id, b.jenjang, b.mahasiswa_id, b.nama, b.nim, b.angkatan, b.status, b.bidang, b.mulai,
    b.tgl_pembimbing, b.tgl_sempro, b.tgl_semhas, b.tgl_ujian_akhir, b.tgl_lulus,
    (select s.tahun from priv.semester_ta(b.tgl_lulus) s where b.tgl_lulus is not null),
    priv.semester_ke(b.angkatan, b.tgl_lulus),
    b.batas, b.tahap
  from b;
$$;

-- ---------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------
create or replace function public.dashboard_akreditasi(p_ts int default null, p_prodi uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := priv.require_user();
  v_semua boolean := priv.is_admin() or priv.has_role('pimpinan');
  v_scope uuid[];
  v_cfg public.akreditasi_pengaturan;
  v_ts int;
  r_ts record; r_g record; r_e record; r_3 record;
  v_out jsonb;
begin
  if p_prodi is not null then
    if not (v_semua or priv.is_kaprodi_of(p_prodi)) then raise exception 'Anda tidak berhak melihat data prodi ini'; end if;
    v_scope := array[p_prodi];
  elsif v_semua then
    select array_agg(id) into v_scope from public.prodi;
  else
    select array_agg(distinct ur.prodi_id) into v_scope
    from public.user_roles ur where ur.user_id = v_uid and ur.role = 'kaprodi' and ur.prodi_id is not null;
    if v_scope is null then raise exception 'Dashboard akreditasi hanya untuk Admin, Pimpinan, dan Ka. Prodi'; end if;
  end if;

  select * into v_cfg from public.akreditasi_pengaturan where id = 1;
  v_ts := coalesce(p_ts, v_cfg.ts_tahun);
  select * into r_ts from priv.rentang_ta(v_ts, null);
  select * into r_g from priv.rentang_ta(v_ts, false);
  select * into r_e from priv.rentang_ta(v_ts, true);
  select * into r_3 from priv.rentang_ta(v_ts - 2, null);

  with
  _akr as materialized (select * from priv.akr_tesis(v_scope)),
  pr as (select p.* from public.prodi p where p.id = any (v_scope)),
  lul as (select * from _akr where tgl_lulus is not null and lulus_tahun between v_ts - 2 and v_ts),
  -- Pembimbing yang aktif pada tiap semester TS
  sem as (select 'ganjil'::text as s, r_g.mulai as mulai, r_g.selesai as selesai union all select 'genap', r_e.mulai, r_e.selesai),
  sup as (
    select sem.s, s.dosen_id, s.peran, a.thesis_id, a.prodi_id
    from sem
    join public.thesis_supervisors s on s.ditetapkan_at::date <= sem.selesai and coalesce(s.diganti_at::date, 'infinity'::date) >= sem.mulai
    join _akr a on a.thesis_id = s.thesis_id
    where (a.tgl_lulus is null or a.tgl_lulus >= sem.mulai) and a.mulai <= sem.selesai and a.status <> 'berhenti'
  ),
  aktif_sem as (select s, prodi_id, count(distinct thesis_id) as n from sup group by s, prodi_id),
  sesi as (
    select g.dosen_id, a.prodi_id, case when coalesce(g.tanggal_jadwal, g.tanggal_usulan)::date <= r_g.selesai then 'ganjil' else 'genap' end as s
    from public.guidance_sessions g join _akr a on a.thesis_id = g.thesis_id
    where g.status = 'selesai' and coalesce(g.tanggal_jadwal, g.tanggal_usulan)::date between r_ts.mulai and r_ts.selesai
  ),
  rev as (
    select r.dosen_id, a.prodi_id, extract(epoch from (r.created_at - cs.created_at)) / 86400.0 as hari
    from public.chapter_reviews r
    join public.chapter_submissions cs on cs.id = r.submission_id
    join _akr a on a.thesis_id = r.thesis_id
    where r.created_at::date between r_ts.mulai and r_ts.selesai
  ),
  uji as (
    select e.*, a.prodi_id from public.exams e join _akr a on a.thesis_id = e.thesis_id
    where e.status = 'selesai' and e.hasil is not null and coalesce(e.diputuskan_at, e.tanggal)::date between r_ts.mulai and r_ts.selesai
  ),
  peng as (
    select ep.dosen_id, count(*) as n from public.exam_panel ep join uji on uji.id = ep.exam_id
    where ep.peran ilike 'penguji%' group by ep.dosen_id
  ),
  dsn_ids as (select dosen_id from sup union select dosen_id from sesi union select dosen_id from rev union select dosen_id from peng),
  dsn as (
    select d.id, d.nama, hp.kode as homebase,
      coalesce(d.kuota_bimbingan, hp.kuota_bimbingan_default) as kuota,
      (select count(distinct thesis_id) from sup where sup.dosen_id = d.id and peran = 'P1' and s = 'ganjil') as p1_ganjil,
      (select count(distinct thesis_id) from sup where sup.dosen_id = d.id and peran = 'P1' and s = 'genap') as p1_genap,
      (select count(distinct thesis_id) from sup where sup.dosen_id = d.id and peran = 'P2' and s = 'ganjil') as p2_ganjil,
      (select count(distinct thesis_id) from sup where sup.dosen_id = d.id and peran = 'P2' and s = 'genap') as p2_genap,
      (select count(*) from sesi where sesi.dosen_id = d.id) as sesi,
      (select count(*) from rev where rev.dosen_id = d.id) as n_review,
      (select round(avg(hari)::numeric, 1) from rev where rev.dosen_id = d.id) as hari_review,
      coalesce((select n from peng where peng.dosen_id = d.id), 0) as penguji
    from public.profiles d
    join dsn_ids on dsn_ids.dosen_id = d.id
    left join public.prodi hp on hp.id = d.prodi_id
  )
  select jsonb_build_object(
    'ts', v_ts,
    'ts_ditetapkan', v_cfg.ts_tahun,
    'batas', jsonb_build_object('S1', v_cfg.batas_semester_s1, 'D3', v_cfg.batas_semester_d3),
    'rentang', jsonb_build_object('mulai', r_ts.mulai, 'selesai', r_ts.selesai, 'ganjil', jsonb_build_array(r_g.mulai, r_g.selesai), 'genap', jsonb_build_array(r_e.mulai, r_e.selesai), 'tiga_ts_mulai', r_3.mulai),
    'bisa_atur', priv.is_admin(),
    'prodi', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kode', kode, 'nama', nama, 'jenjang', jenjang, 'lembaga', coalesce(lembaga_akreditasi, case when nama ilike '%desain%' then 'LAM DEPILAR' else 'LAM INFOKOM' end),
                         'bisa_isi', priv.is_admin() or priv.is_kaprodi_of(id)) order by jenjang desc, nama) from pr), '[]'),

    -- Ringkasan per prodi
    'ringkas', coalesce((select jsonb_agg(jsonb_build_object(
        'prodi_id', pr.id,
        'lulusan', jsonb_build_array(
           (select count(*) from _akr a where a.prodi_id = pr.id and a.lulus_tahun = v_ts),
           (select count(*) from _akr a where a.prodi_id = pr.id and a.lulus_tahun = v_ts - 1),
           (select count(*) from _akr a where a.prodi_id = pr.id and a.lulus_tahun = v_ts - 2)),
        'n_masa_studi', (select count(*) from lul where lul.prodi_id = pr.id and lul.semester_lulus is not null),
        'rata_masa_studi', (select round(avg(semester_lulus / 2.0)::numeric, 2) from lul where lul.prodi_id = pr.id and lul.semester_lulus is not null),
        'tepat', (select count(*) from lul where lul.prodi_id = pr.id and lul.semester_lulus <= lul.batas),
        'tanpa_angkatan', (select count(*) from lul where lul.prodi_id = pr.id and lul.semester_lulus is null),
        'rata_lama_ta_bulan', (select round(avg((tgl_ujian_akhir - tgl_pembimbing) / 30.44)::numeric, 1) from lul where lul.prodi_id = pr.id and tgl_ujian_akhir is not null and tgl_pembimbing is not null),
        'ujian_n', (select count(*) from uji where uji.prodi_id = pr.id),
        'ujian_lulus_pertama', (select count(*) from uji where uji.prodi_id = pr.id and uji.percobaan = 1 and uji.hasil <> 'mengulang'),
        'ujian_pertama_n', (select count(*) from uji where uji.prodi_id = pr.id and uji.percobaan = 1),
        'mhs_aktif', jsonb_build_object('ganjil', coalesce((select n from aktif_sem where aktif_sem.prodi_id = pr.id and s = 'ganjil'), 0),
                                        'genap', coalesce((select n from aktif_sem where aktif_sem.prodi_id = pr.id and s = 'genap'), 0)),
        'sesi', jsonb_build_object('ganjil', (select count(*) from sesi where sesi.prodi_id = pr.id and s = 'ganjil'),
                                   'genap', (select count(*) from sesi where sesi.prodi_id = pr.id and s = 'genap')),
        'p1', jsonb_build_object(
          'ganjil', (select round(avg(c)::numeric, 2) from (select count(distinct thesis_id) as c from sup where sup.prodi_id = pr.id and peran = 'P1' and s = 'ganjil' group by dosen_id) x),
          'genap', (select round(avg(c)::numeric, 2) from (select count(distinct thesis_id) as c from sup where sup.prodi_id = pr.id and peran = 'P1' and s = 'genap' group by dosen_id) x)),
        'hari_review', (select round(avg(hari)::numeric, 1) from rev where rev.prodi_id = pr.id),
        'berisiko', (select count(*) from _akr a where a.prodi_id = pr.id and a.status in ('aktif', 'cuti') and priv.semester_ke(a.angkatan, current_date) >= a.batas - 1)
      )) from pr), '[]'),

    -- Tabel masa studi per angkatan (S1: TS-6..TS, D3: TS-4..TS)
    'masa_studi', coalesce((select jsonb_agg(jsonb_build_object(
        'prodi_id', pr.id, 'angkatan', ang, 'k', v_ts - ang,
        'diterima', (select jumlah from public.akreditasi_mahasiswa_baru mb where mb.prodi_id = pr.id and mb.angkatan = ang),
        'lulus_per_ts', (select jsonb_agg((select count(*) from _akr a where a.prodi_id = pr.id and a.angkatan = ang and a.lulus_tahun = v_ts - j) order by j desc)
                         from generate_series(0, case when pr.jenjang = 'D3' then 4 else 6 end) j),
        'lulus', (select count(*) from _akr a where a.prodi_id = pr.id and a.angkatan = ang and a.lulus_tahun <= v_ts),
        'tepat', (select count(*) from _akr a where a.prodi_id = pr.id and a.angkatan = ang and a.lulus_tahun <= v_ts and a.semester_lulus <= a.batas),
        'rata_masa_studi', (select round(avg(semester_lulus / 2.0)::numeric, 2) from _akr a where a.prodi_id = pr.id and a.angkatan = ang and a.lulus_tahun <= v_ts),
        'masih_aktif', (select count(*) from _akr a where a.prodi_id = pr.id and a.angkatan = ang and a.status in ('aktif', 'cuti'))
      ) order by pr.jenjang desc, pr.nama, ang)
      from pr, generate_series(v_ts - case when pr.jenjang = 'D3' then 4 else 6 end, v_ts) ang), '[]'),

    -- Lama per tahap (hari), lulusan 3 TS terakhir
    'tahap', coalesce((select jsonb_agg(jsonb_build_object(
        'prodi_id', pr.id,
        'pembimbing_sempro', (select round(avg(tgl_sempro - tgl_pembimbing)) from lul where lul.prodi_id = pr.id and tgl_sempro is not null and tgl_pembimbing is not null),
        'sempro_semhas', (select round(avg(tgl_semhas - tgl_sempro)) from lul where lul.prodi_id = pr.id and tgl_semhas is not null and tgl_sempro is not null),
        'semhas_akhir', (select round(avg(tgl_ujian_akhir - tgl_semhas)) from lul where lul.prodi_id = pr.id and tgl_ujian_akhir is not null and tgl_semhas is not null),
        'pembimbing_akhir', (select round(avg(tgl_ujian_akhir - tgl_pembimbing)) from lul where lul.prodi_id = pr.id and tgl_ujian_akhir is not null and tgl_pembimbing is not null),
        'akhir_lulus', (select round(avg(tgl_lulus - tgl_ujian_akhir)) from lul where lul.prodi_id = pr.id and tgl_ujian_akhir is not null)
      )) from pr), '[]'),

    -- Ujian pada TS
    'ujian', coalesce((select jsonb_agg(jsonb_build_object('prodi_id', prodi_id, 'jenis', jenis, 'n', n, 'pertama_n', pn, 'lulus_pertama', lp, 'mengulang', mg))
      from (select prodi_id, jenis, count(*) n, count(*) filter (where percobaan = 1) pn,
                   count(*) filter (where percobaan = 1 and hasil <> 'mengulang') lp, count(*) filter (where hasil = 'mengulang') mg
            from uji group by prodi_id, jenis) u), '[]'),

    -- Dosen pada TS
    'dosen', coalesce((select jsonb_agg(to_jsonb(dsn) order by greatest(p1_ganjil, p1_genap) desc, nama) from dsn), '[]'),

    -- Mahasiswa berisiko terlambat (per hari ini)
    'berisiko', coalesce((select jsonb_agg(x order by (x->>'semester')::int desc, x->>'nama') from (
        select jsonb_build_object('thesis_id', a.thesis_id, 'nama', a.nama, 'nim', a.nim, 'prodi_id', a.prodi_id, 'angkatan', a.angkatan,
          'semester', priv.semester_ke(a.angkatan, current_date), 'batas', a.batas, 'tahap', a.tahap, 'status', a.status) as x
        from _akr a
        where a.status in ('aktif', 'cuti') and priv.semester_ke(a.angkatan, current_date) >= a.batas - 1
        limit 300) q), '[]'),
    'tanpa_angkatan_aktif', (select count(*) from _akr a where a.status in ('aktif', 'cuti') and a.angkatan is null),

    -- Bidang kajian studi akhir yang dimulai pada TS-2..TS
    'topik', coalesce((select jsonb_agg(jsonb_build_object('prodi_id', prodi_id, 'bidang', bidang, 'n', n) order by n desc)
      from (select prodi_id, coalesce(bidang, 'Belum diisi') as bidang, count(*) n from _akr
            where mulai between r_3.mulai and r_ts.selesai group by 1, 2) t), '[]')
  ) into v_out;

  return v_out;
end;
$$;
grant execute on function public.dashboard_akreditasi(int, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Pengaturan
-- ---------------------------------------------------------------------
create or replace function public.atur_akreditasi(p_ts int, p_batas_s1 int, p_batas_d3 int)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := priv.require_user();
begin
  if not priv.is_admin() then raise exception 'Hanya Admin yang dapat menetapkan TS'; end if;
  if p_ts is null or p_ts not between 2000 and 2100 then raise exception 'Tahun akademik TS tidak valid'; end if;
  update public.akreditasi_pengaturan
  set ts_tahun = p_ts, batas_semester_s1 = coalesce(p_batas_s1, batas_semester_s1), batas_semester_d3 = coalesce(p_batas_d3, batas_semester_d3),
      diubah_oleh = v_uid, updated_at = now()
  where id = 1;
end;
$$;

create or replace function public.atur_lembaga_prodi(p_prodi uuid, p_lembaga text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform priv.require_user();
  if not priv.is_admin() then raise exception 'Hanya Admin yang dapat mengubah lembaga akreditasi'; end if;
  update public.prodi set lembaga_akreditasi = nullif(trim(p_lembaga), '') where id = p_prodi;
end;
$$;

create or replace function public.simpan_mahasiswa_baru(p_prodi uuid, p_angkatan int, p_jumlah int)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := priv.require_user();
begin
  if not (priv.is_admin() or priv.is_kaprodi_of(p_prodi)) then raise exception 'Hanya Admin atau Ka. Prodi yang dapat mengisi jumlah mahasiswa diterima'; end if;
  if p_angkatan is null or p_angkatan not between 1990 and 2100 then raise exception 'Angkatan tidak valid'; end if;
  if p_jumlah is null then
    delete from public.akreditasi_mahasiswa_baru where prodi_id = p_prodi and angkatan = p_angkatan;
    return;
  end if;
  if p_jumlah < 0 then raise exception 'Jumlah tidak boleh negatif'; end if;
  insert into public.akreditasi_mahasiswa_baru (prodi_id, angkatan, jumlah, diubah_oleh)
  values (p_prodi, p_angkatan, p_jumlah, v_uid)
  on conflict (prodi_id, angkatan) do update set jumlah = excluded.jumlah, diubah_oleh = v_uid, updated_at = now();
end;
$$;

revoke execute on function public.dashboard_akreditasi(int, uuid), public.atur_akreditasi(int, int, int), public.atur_lembaga_prodi(uuid, text), public.simpan_mahasiswa_baru(uuid, int, int) from anon;
