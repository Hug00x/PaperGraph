-- Apply after 202609270001_graph_zones.sql. Existing zones may omit notes.
begin;
create or replace function public.valid_graph_zones(value jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare z jsonb; other jsonb; seen text[] := '{}';
begin
  if jsonb_typeof(value) is distinct from 'array' then return false; end if;
  for z in select * from jsonb_array_elements(value) loop
    if jsonb_typeof(z) is distinct from 'object'
      or jsonb_typeof(z->'id') is distinct from 'string' or length(z->>'id') = 0
      or (z->>'id') = any(seen)
      or jsonb_typeof(z->'name') is distinct from 'string' or length(btrim(z->>'name')) not between 1 and 80
      or (z ? 'notes' and (jsonb_typeof(z->'notes') is distinct from 'string' or length(z->>'notes') > 20000))
      or coalesce(z->>'color','') not in ('red','orange','amber','green','teal','blue','violet','pink')
      or jsonb_typeof(z->'x') is distinct from 'number' or jsonb_typeof(z->'y') is distinct from 'number'
      or jsonb_typeof(z->'width') is distinct from 'number' or jsonb_typeof(z->'height') is distinct from 'number'
    then return false; end if;
    if (z->>'x')::numeric < 0 or (z->>'y')::numeric < 0
      or (z->>'width')::numeric < 8 or (z->>'height')::numeric < 6
      or (z->>'x')::numeric + (z->>'width')::numeric > 100
      or (z->>'y')::numeric + (z->>'height')::numeric > 100 then return false; end if;
    for other in select entry from jsonb_array_elements(value) as entries(entry) where (entry->>'id') = any(seen) loop
      if (z->>'x')::numeric < (other->>'x')::numeric + (other->>'width')::numeric
        and (z->>'x')::numeric + (z->>'width')::numeric > (other->>'x')::numeric
        and (z->>'y')::numeric < (other->>'y')::numeric + (other->>'height')::numeric
        and (z->>'y')::numeric + (z->>'height')::numeric > (other->>'y')::numeric then return false; end if;
    end loop;
    seen := array_append(seen, z->>'id');
  end loop;
  return true;
end;
$$;
commit;
