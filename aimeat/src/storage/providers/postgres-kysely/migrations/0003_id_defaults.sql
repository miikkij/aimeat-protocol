-- 0003_id_defaults.sql — give every surrogate `id text` column a DB-side uuid default.
-- Prisma generated these ids app-side (@default(cuid())), so the base schema left them defaultless. The
-- Kysely provider would otherwise have to synthesise an id on every insert across 100+ tables; a DB
-- default lets the mappers omit id entirely (and kysely-codegen then types them Generated<string>).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.column_name = 'id' AND c.data_type = 'text' AND c.column_default IS NULL
  ) LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN id SET DEFAULT gen_random_uuid()::text', r.table_name);
  END LOOP;
END $$;
