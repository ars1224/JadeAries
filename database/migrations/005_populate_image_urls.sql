-- Populate the approved, repository-backed attire and food images.
-- Paths are root-relative so Netlify serves them from the site's publish root.

BEGIN;

WITH attire_image_map (display_name, image_url) AS (
    VALUES
        ('Groom', '/images/attire/groom-suit-reference.jpg'),
        ('Bride', '/images/attire/bride-dress-reference.jpg'),
        ('Best Man', '/images/attire/best-man-suit-reference.jpg'),
        ('Groomsman', '/images/attire/groomsmen-suit-reference.jpg'),
        ('Bridesmaid', '/images/attire/bridesmaids-dress-reference.jpg'),
        ('Maid of Honour', '/images/attire/maid-of-honour-dress-reference.jpg'),
        ('Ninong', '/images/attire/ninong-suit-reference.jpg'),
        ('Ninang', '/images/attire/ninang-dress-reference.jpg'),
        ('Father of the Bride', '/images/attire/parents-father-suit-reference.jpg'),
        ('Mother of the Bride', '/images/attire/parents-mother-dress-reference.jpg'),
        ('Father of the Groom', '/images/attire/parents-father-suit-reference.jpg'),
        ('Mother of the Groom', '/images/attire/parents-mother-dress-reference.jpg'),
        ('Flower Girl', '/images/attire/flower-girls-dress-reference.png'),
        ('Ring Bearer', '/images/attire/bearers-suit-reference.jpg'),
        ('Coin Bearer', '/images/attire/bearers-suit-reference.jpg'),
        ('Bible Bearer', '/images/attire/bearers-suit-reference.jpg'),
        ('Guest', '/images/attire/guest-attire-reference.jpg'),
        ('Officiant', '/images/attire/officiant-attire-reference.png')
)
UPDATE public.attire_profiles AS profile
   SET image_url = image_map.image_url
  FROM attire_image_map AS image_map
 WHERE LOWER(BTRIM(profile.display_name)) = LOWER(image_map.display_name);

WITH food_image_map (course, name, image_url) AS (
    VALUES
        ('main', 'Mediterranean Vegetable Charlotte', '/images/food/mediterranean-vegetable-charlotte.jpg'),
        ('main', 'Confit Pork Belly – 200g', '/images/food/confit-pork-belly.jpg'),
        ('main', 'Lemon Baked Salmon – 170g', '/images/food/lemon-baked-salmon.jpg'),
        ('main', 'Roasted Beef Fillet – 180g', '/images/food/roasted-beef-fillet.jpg'),
        ('main', 'Chicken Thigh Baked in White Wine & Parmesan Cream – 180g', '/images/food/chicken-thigh-white-wine-parmesan.jpg'),
        ('dessert', 'Classic Tiramisu', '/images/food/classic-tiramisu.jpg'),
        ('dessert', 'White Chocolate Cheesecake', '/images/food/white-chocolate-cheesecake.jpg'),
        ('dessert', 'Vanilla Bean Panna Cotta', '/images/food/vanilla-bean-panna-cotta.jpg'),
        ('dessert', 'Poached Orange & Almond Torte', '/images/food/poached-orange-almond-torte.jpg')
)
UPDATE public.food_options AS food
   SET image_url = image_map.image_url
  FROM food_image_map AS image_map
 WHERE food.course = image_map.course
   AND LOWER(BTRIM(food.name)) = LOWER(image_map.name);

COMMIT;
