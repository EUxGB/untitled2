-- Отзывы игроков (2026-10-16: «сделай отправку ответов в supabase и возможность отправки чего не хватает»).
-- Применено к проекту fqbowvmvhqkeqoldzcuv миграцией simit_feedback. Читать отзывы — только владелец (SQL в панели Supabase):
--   select created_at, week, answer, note, build from simit_feedback order by created_at desc;
-- Прямого доступа к таблице нет (RLS без политик); запись — только функцией simit_feedback с проверками и пределом 20 в день на устройство.
create table if not exists public.simit_feedback (
  id bigint generated always as identity primary key,
  device uuid not null,
  week int,                                   -- неделя кампании (ответ из итога недели) или null
  answer text check (answer in ('да', 'так себе', 'нет')),
  note text check (char_length(note) <= 1000),
  build text check (char_length(build) <= 40),
  created_at timestamptz not null default now()
);
alter table public.simit_feedback enable row level security;
create index if not exists simit_feedback_device_day on public.simit_feedback (device, created_at);

create or replace function public.simit_feedback(p_id uuid, p_week int, p_answer text, p_note text, p_build text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_id is null or (p_answer is null and n is null) then return false; end if;
  if p_answer is not null and p_answer not in ('да', 'так себе', 'нет') then return false; end if;
  if p_week is not null and (p_week < 0 or p_week > 1000) then return false; end if;
  if (select count(*) from public.simit_feedback where device = p_id and created_at > now() - interval '1 day') >= 20 then return false; end if;
  insert into public.simit_feedback (device, week, answer, note, build)
  values (p_id, p_week, p_answer, left(n, 1000), left(p_build, 40));
  return true;
end;
$$;
revoke all on function public.simit_feedback(uuid, int, text, text, text) from public;
grant execute on function public.simit_feedback(uuid, int, text, text, text) to anon, authenticated;
