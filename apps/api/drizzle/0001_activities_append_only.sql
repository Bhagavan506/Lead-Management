-- Rule 6: activity records are append-only. Block UPDATE, DELETE and TRUNCATE at the database level.
CREATE FUNCTION activities_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'activities is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER activities_no_update_delete
  BEFORE UPDATE OR DELETE ON activities
  FOR EACH ROW EXECUTE FUNCTION activities_block_mutation();
--> statement-breakpoint
CREATE TRIGGER activities_no_truncate
  BEFORE TRUNCATE ON activities
  FOR EACH STATEMENT EXECUTE FUNCTION activities_block_mutation();
