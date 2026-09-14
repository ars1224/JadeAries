-- Restore service-role access after the kids-menu migration.
-- Postgres 42501 means the admin RPCs or table writes are running without
-- UPDATE/DELETE rights. Create already uses SECURITY DEFINER; update and
-- delete now match that so the private dashboard can save and remove guests.

BEGIN;

GRANT USAGE ON SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.guests TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.guest_food_choices TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.food_options TO service_role;
GRANT SELECT ON TABLE public.attire_profiles TO service_role;

DO $$
DECLARE
    fn RECORD;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure AS signature
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
               'admin_delete_guest',
               'admin_update_guest',
               'admin_update_guest_rsvp'
           )
    LOOP
        EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER', fn.signature);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
    END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
