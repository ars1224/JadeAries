BEGIN;

INSERT INTO menu_items (slug, category, name, description, dietary_codes, price_nzd, sort_order)
VALUES (
    'chicken_thigh_white_wine_parmesan',
    'main',
    'Chicken thigh baked in white wine & parmesan cream – 180g',
    'Potato gratin, broccolini, candied onion',
    ARRAY['G'],
    50.00,
    50
)
ON CONFLICT (slug) DO UPDATE
SET category = EXCLUDED.category,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    dietary_codes = EXCLUDED.dietary_codes,
    price_nzd = EXCLUDED.price_nzd,
    sort_order = EXCLUDED.sort_order,
    active = TRUE,
    updated_at = NOW();

UPDATE menu_items
SET sort_order = CASE slug
    WHEN 'classic_tiramisu' THEN 60
    WHEN 'white_chocolate_cheesecake' THEN 70
    WHEN 'vanilla_bean_panna_cotta' THEN 80
    WHEN 'poached_orange_almond_torte' THEN 90
    ELSE sort_order
END,
updated_at = NOW()
WHERE slug IN (
    'classic_tiramisu',
    'white_chocolate_cheesecake',
    'vanilla_bean_panna_cotta',
    'poached_orange_almond_torte'
);

COMMIT;
