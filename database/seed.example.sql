-- Example only. The live guest list is database/guests.tsv.
-- Import it with: npm run import:guests -- database/guests.tsv

INSERT INTO guests (
    invitation_code,
    full_name,
    role,
    attire_title,
    attire_description,
    rsvp_status
) VALUES (
    'DEC19-010',
    'Mary ann Gimutao',
    'Bridesmaid',
    'Bridesmaid attire',
    'A floor-length gown in a whimsical pastel shade.',
    'pending'
)
ON CONFLICT ((LOWER(full_name))) DO NOTHING;
