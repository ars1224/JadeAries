-- Keep Guest attire wording consistent across the invitation and admin dashboard.

BEGIN;

UPDATE public.attire_profiles
   SET attire_description = 'Semi-formal attire with the wedding colour theme palette.'
 WHERE LOWER(BTRIM(display_name)) IN ('guest', 'wedding guest')
    OR LOWER(BTRIM(attire_name)) IN ('guest attire', 'wedding guest attire');

COMMIT;
