INSERT INTO users (name, email, signup_date, country_code, subscription_tier, lifetime_value)
SELECT
    'User_' || s,
    'user_' || s || '@example.com',
    NOW() - (random() * INTERVAL '1000 days'),
    (ARRAY['US','GB','CA','AU','DE','FR','IN','JP','BR','MX','IT','ES','KR','NL','SE','NO','DK','FI','PL','SG'])[floor(random() * 20 + 1)::INT],
    (ARRAY['free','basic','premium','enterprise'])[floor(random() * 4 + 1)::INT],
    ROUND((random() * 10000)::NUMERIC, 2)
FROM generate_series(1, 10000000) AS s
ON CONFLICT (email) DO NOTHING;





