-- The production profile is named "Wedding Guest", while migration 005 used
-- the confirmed role name "Guest". Point both labels at the approved asset.

BEGIN;

UPDATE public.attire_profiles
   SET image_url = '/images/attire/guest-attire-reference.jpg'
 WHERE LOWER(BTRIM(display_name)) IN ('guest', 'wedding guest')
    OR LOWER(BTRIM(attire_name)) = 'wedding guest attire';

COMMIT;
