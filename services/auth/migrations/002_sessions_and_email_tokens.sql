-- Verificación de correo, recuperación de contraseña y sesiones con refresh token rotativo
ALTER TABLE auth.users ADD COLUMN email_verified_at timestamptz;
-- las cuentas que ya existían se consideran verificadas (no se bloquea a nadie al actualizar)
UPDATE auth.users SET email_verified_at = created_at;

-- Tokens de un solo uso enviados por correo. Solo se guarda el HASH (si se filtra la BD, los enlaces no sirven).
CREATE TABLE auth.email_tokens (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    integer     NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose    text        NOT NULL CHECK (purpose IN ('verify', 'reset')),
  token_hash text        NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_email_tokens_user ON auth.email_tokens (user_id, purpose);

-- Sesiones: el refresh token (opaco, hasheado) rota en cada uso. family_id agrupa la cadena de rotaciones
-- para poder revocarla completa si se detecta que un refresh token ya usado se vuelve a presentar (robo).
CREATE TABLE auth.sessions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             integer     NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  family_id           uuid        NOT NULL,
  token_hash          text        NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  rotated_at          timestamptz,
  revoked_at          timestamptz,
  user_agent          text
);
CREATE INDEX ix_sessions_user ON auth.sessions (user_id);
CREATE INDEX ix_sessions_family ON auth.sessions (family_id);
