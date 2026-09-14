-- Replace the Flower Girl "Baby Pink" attire label with the approved wording.

BEGIN;

UPDATE public.attire_profiles
   SET attire_name = 'Whimsical colour dress',
       attire_description = 'A whimsical colour dress.'
 WHERE LOWER(BTRIM(display_name)) = 'flower girl';

COMMIT;
