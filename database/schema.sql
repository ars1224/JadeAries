BEGIN;

CREATE TABLE IF NOT EXISTS menu_items (
    slug VARCHAR(64) PRIMARY KEY,
    category VARCHAR(12) NOT NULL CHECK (category IN ('main', 'dessert')),
    name VARCHAR(160) NOT NULL,
    description VARCHAR(500) NOT NULL DEFAULT '',
    dietary_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    price_nzd NUMERIC(8, 2) NOT NULL CHECK (price_nzd >= 0),
    sort_order SMALLINT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO menu_items (slug, category, name, description, dietary_codes, price_nzd, sort_order)
VALUES
    ('mediterranean_vegetable_charlotte', 'main', 'Mediterranean vegetable charlotte', 'Roquette, olive tapenade, cherry tomatoes, harissa oil', ARRAY['G', 'VG'], 45.00, 10),
    ('confit_pork_belly', 'main', 'Confit pork belly – 200g', 'Rosemary crushed potatoes, crushed beets, garlic spinach, jus', ARRAY['G'], 52.00, 20),
    ('lemon_baked_salmon', 'main', 'Lemon baked salmon – 170g', 'Potato gratin, spiced edamame cassoulet, miso dressing', ARRAY['G', 'D'], 59.00, 30),
    ('roasted_beef_fillet', 'main', 'Roasted beef fillet – 180g', 'Rosemary crushed potatoes, charred broccolini, candied onion, jus', ARRAY['D', 'DO'], 62.00, 40),
    ('chicken_thigh_white_wine_parmesan', 'main', 'Chicken thigh baked in white wine & parmesan cream – 180g', 'Potato gratin, broccolini, candied onion', ARRAY['G'], 50.00, 50),
    ('classic_tiramisu', 'dessert', 'Classic tiramisu', 'Espresso cream, lady fingers, cocoa', ARRAY[]::TEXT[], 22.00, 60),
    ('white_chocolate_cheesecake', 'dessert', 'White chocolate cheesecake', 'Berry coulis, freeze-dried raspberry', ARRAY[]::TEXT[], 22.00, 70),
    ('vanilla_bean_panna_cotta', 'dessert', 'Vanilla bean panna cotta', 'White chocolate cream, seasonal berries', ARRAY['G'], 22.00, 80),
    ('poached_orange_almond_torte', 'dessert', 'Poached orange & almond torte', 'Whipped coconut cream, praline', ARRAY['G', 'D', 'VG'], 24.00, 90)
ON CONFLICT (slug) DO UPDATE
SET category = EXCLUDED.category,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    dietary_codes = EXCLUDED.dietary_codes,
    price_nzd = EXCLUDED.price_nzd,
    sort_order = EXCLUDED.sort_order,
    active = TRUE,
    updated_at = NOW();

CREATE TABLE IF NOT EXISTS guests (
    id BIGSERIAL PRIMARY KEY,
    invitation_code VARCHAR(40) NOT NULL,
    full_name VARCHAR(120) NOT NULL,
    role VARCHAR(80) NOT NULL DEFAULT 'Guest',
    attire_title VARCHAR(120) NOT NULL DEFAULT 'Guest attire',
    attire_description VARCHAR(500) NOT NULL DEFAULT 'Semi-formal attire in a whimsical pastel shade.',
    palette TEXT[] NOT NULL DEFAULT ARRAY['#c7a6ed', '#ffc28e', '#ffe688', '#a9cfea']::TEXT[],
    rsvp_status VARCHAR(12) NOT NULL DEFAULT 'pending'
        CHECK (rsvp_status IN ('pending', 'attending', 'declined')),
    meal_choice VARCHAR(64) REFERENCES menu_items(slug),
    dessert_choice VARCHAR(64) REFERENCES menu_items(slug),
    dietary_requirements VARCHAR(500) NOT NULL DEFAULT '',
    responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (rsvp_status = 'attending' OR (meal_choice IS NULL AND dessert_choice IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS guests_full_name_unique_ci
    ON guests (LOWER(full_name));

CREATE INDEX IF NOT EXISTS guests_invitation_code_idx
    ON guests (invitation_code);

CREATE INDEX IF NOT EXISTS guests_rsvp_status_idx
    ON guests (rsvp_status);

COMMIT;
