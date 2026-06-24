-- Postgres trigger: create public.users profile whenever a Supabase auth user
-- is inserted into auth.users. Reads given_name and family_name from the
-- raw_user_meta_data JSON that signUp() passes as `options.data`.
-- SECURITY DEFINER so it can write to public.users from the auth schema.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (
    id,
    given_name,
    family_name,
    primary_email,
    status,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'given_name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'family_name', ''),
    NEW.email::citext,
    'active',
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
