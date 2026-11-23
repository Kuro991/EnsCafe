CREATE TABLE catalog.cafes (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         text             NOT NULL,
  address      text             NOT NULL,
  description  text             NOT NULL DEFAULT '',
  schedule     text             NOT NULL DEFAULT '',
  phone        text             NOT NULL DEFAULT '',
  lat          double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng          double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  zone         text             NOT NULL,
  status       text             NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'closed', 'retired')),
  rating_avg   double precision NOT NULL DEFAULT 0 CHECK (rating_avg BETWEEN 0 AND 5),
  rating_count integer          NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  created_at   timestamptz      NOT NULL DEFAULT now(),
  updated_at   timestamptz      NOT NULL DEFAULT now()
);
-- evita cafeterías duplicadas (mismo nombre y dirección, sin distinguir mayúsculas)
CREATE UNIQUE INDEX ux_cafes_name_address ON catalog.cafes (lower(name), lower(address));
CREATE INDEX ix_cafes_status_zone ON catalog.cafes (status, zone);
CREATE INDEX ix_cafes_ranking ON catalog.cafes (rating_avg DESC, rating_count DESC) WHERE status = 'active';
