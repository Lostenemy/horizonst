INSERT INTO users (email, password_hash, password_salt, role, display_name)
VALUES ('admin@horizonst.com.es',
        'bcb767763833ce223243102e8cac1e99f5b0e015630ec6d916000bb136f9f22cbbaa15f738f0db7100964c5365b04918cd298242fc7c0ca5748349193966ead1',
        'f67d1d59d6b821d6f3e9d6333af175db',
        'ADMIN',
        'Administrador inicial')
ON CONFLICT (email) DO NOTHING;
