-- SCHEMA --
CREATE TABLE IF NOT EXISTS "game_players" (
    "id" bigint NOT NULL,
    "game_id" bigint,
    "name" text NOT NULL,
    "start_chips" integer NOT NULL,
    "final_chips" integer NOT NULL,
    "diff_rub" double precision NOT NULL
);

CREATE TABLE IF NOT EXISTS "games" (
    "id" bigint NOT NULL,
    "name" text NOT NULL,
    "date_str" text,
    "chips_per_rub" double precision NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "is_closed" boolean DEFAULT false,
    "mode" text DEFAULT 'cash'::text,
    "buy_in" numeric DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "payments" (
    "id" bigint NOT NULL,
    "from_name" text NOT NULL,
    "to_name" text NOT NULL,
    "amount" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "game_ids" text DEFAULT ''::text
);

ALTER TABLE "game_players" ADD CONSTRAINT "game_players_pkey" PRIMARY KEY ("id");
ALTER TABLE "games" ADD CONSTRAINT "games_pkey" PRIMARY KEY ("id");
ALTER TABLE "payments" ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- USER --
CREATE ROLE web_anon NOLOGIN;
GRANT USAGE ON SCHEMA public TO web_anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO web_anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO web_anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO web_anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT USAGE, SELECT ON SEQUENCES TO web_anon;
