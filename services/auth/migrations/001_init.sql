CREATE TABLE auth.users (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          text        NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  email         text        NOT NULL CHECK (email = lower(email)),
  password_hash text        NOT NULL,
  role          text        NOT NULL DEFAULT 'user'   CHECK (role IN ('user', 'admin')),
  status        text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- un correo solo puede registrarse una vez (también protege contra doble clic y peticiones simultáneas)
CREATE UNIQUE INDEX ux_users_email ON auth.users (lower(email));
CREATE INDEX ix_users_role ON auth.users (role);
