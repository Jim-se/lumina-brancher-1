begin;

revoke all on function public.create_conversation_with_root(text, uuid, text) from public;
revoke all on function public.create_conversation_with_root(text, uuid, text) from anon;

create or replace function public.create_conversation_with_root(
    p_title text,
    p_user_id uuid,
    p_hierarchical_id text
)
returns table(conversation_id uuid, node_id uuid)
language plpgsql
security invoker
set search_path = public, auth
as $$
declare
    v_user_id uuid := auth.uid();
    v_conversation_id uuid;
    v_node_id uuid;
    v_title text := coalesce(nullif(trim(p_title), ''), 'New Discussion');
    v_hierarchical_id text := coalesce(nullif(trim(p_hierarchical_id), ''), '1');
begin
    if v_user_id is null then
        raise exception 'Authentication required';
    end if;

    if p_user_id is not null and p_user_id <> v_user_id then
        raise exception 'p_user_id must match the authenticated user';
    end if;

    if not exists (
        select 1
        from public.users
        where id = v_user_id
    ) then
        raise exception 'Missing public.users row for authenticated user';
    end if;

    insert into public.conversations (title, user_id, updated_at)
    values (v_title, v_user_id, timezone('utc', now()))
    returning id into v_conversation_id;

    insert into public.nodes (hierarchical_id, title, conversations_id, is_branch, user_id)
    values (v_hierarchical_id, '...', v_conversation_id, false, v_user_id)
    returning id into v_node_id;

    update public.conversations
    set root_node_id = v_node_id,
        current_node_id = v_node_id,
        updated_at = timezone('utc', now())
    where id = v_conversation_id
      and user_id = v_user_id;

    return query
    select v_conversation_id, v_node_id;
end;
$$;

grant execute on function public.create_conversation_with_root(text, uuid, text) to authenticated;

commit;
