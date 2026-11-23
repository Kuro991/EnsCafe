-- cafe_id y user_id referencian datos de OTROS servicios: no hay llaves foráneas entre bases/servicios;
-- la integridad se valida por API (reviews-service consulta a catalog-service antes de aceptar una reseña).
CREATE TABLE reviews.reviews (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cafe_id    integer     NOT NULL,
  user_id    integer     NOT NULL,
  user_name  text        NOT NULL,
  rating     smallint    NOT NULL CHECK (rating BETWEEN 0 AND 5),
  comment    text        NOT NULL DEFAULT '' CHECK (char_length(comment) <= 1000),
  status     text        NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cafe_id, user_id) -- una reseña por usuario y cafetería
);
CREATE INDEX ix_reviews_cafe ON reviews.reviews (cafe_id, status, updated_at DESC);
CREATE INDEX ix_reviews_user ON reviews.reviews (user_id, updated_at DESC);

CREATE TABLE reviews.top5 (
  user_id  integer     NOT NULL,
  cafe_id  integer     NOT NULL,
  position smallint    NOT NULL CHECK (position BETWEEN 1 AND 5),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cafe_id), -- sin cafeterías repetidas
  UNIQUE (user_id, position)      -- sin posiciones repetidas
);
