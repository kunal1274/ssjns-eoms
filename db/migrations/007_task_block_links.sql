-- Preserve legacy task codes and IDs. Linking is explicit; never infer from matching text.
ALTER TABLE eoms.operating_units ADD CONSTRAINT unit_estate_identity UNIQUE(id,estate_id);
ALTER TABLE eoms.occurrences ADD COLUMN block_unit_id uuid;
ALTER TABLE eoms.occurrences ADD CONSTRAINT occurrence_block_estate FOREIGN KEY(block_unit_id,estate_id) REFERENCES eoms.operating_units(id,estate_id);
CREATE INDEX occurrence_block_unit ON eoms.occurrences(estate_id,block_unit_id);
GRANT UPDATE(block_unit_id) ON eoms.occurrences TO eoms_app;
ALTER TABLE eoms.hierarchy_history DROP CONSTRAINT hierarchy_history_record_type_check;
ALTER TABLE eoms.hierarchy_history ADD CONSTRAINT hierarchy_history_record_type_check CHECK(record_type IN ('group','company','unit','setup-grant','task-link'));
CREATE FUNCTION eoms.validate_task_block_link() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
DECLARE block_kind text; block_code text; role_name text;
BEGIN
 IF TG_OP='UPDATE' THEN
   IF OLD.block_unit_id IS NOT NULL AND (NEW.block_unit_id,NEW.block_code,NEW.estate_id) IS DISTINCT FROM (OLD.block_unit_id,OLD.block_code,OLD.estate_id) THEN RAISE EXCEPTION 'Recorded block reference and code are immutable' USING ERRCODE='23514'; END IF;
   IF NEW.block_unit_id IS NOT DISTINCT FROM OLD.block_unit_id THEN RETURN NEW; END IF;
   IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Block linking requires next task version' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.block_unit_id IS NULL THEN RETURN NEW; END IF;
 IF eoms.actor_id() IS NOT NULL THEN
   SELECT role INTO role_name FROM eoms.memberships WHERE estate_id=NEW.estate_id AND user_id=eoms.actor_id();
   IF role_name IS DISTINCT FROM 'manager' THEN RAISE EXCEPTION 'Estate manager required for task block linking' USING ERRCODE='42501'; END IF;
   IF length(trim(coalesce(current_setting('app.change_reason',true),''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Block link reason required' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT kind,code INTO block_kind,block_code FROM eoms.operating_units WHERE id=NEW.block_unit_id AND estate_id=NEW.estate_id FOR SHARE;
 IF block_kind IS NULL THEN RAISE EXCEPTION 'Block is not available in this estate' USING ERRCODE='23503'; END IF;
 IF block_kind<>'block' OR NEW.block_code<>block_code THEN RAISE EXCEPTION 'Choose a block matching the recorded code' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.validate_task_block_link() FROM PUBLIC;
CREATE TRIGGER validate_task_block_link BEFORE INSERT OR UPDATE ON eoms.occurrences FOR EACH ROW EXECUTE FUNCTION eoms.validate_task_block_link();
CREATE FUNCTION eoms.record_task_block_link() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE before_value jsonb;
BEGIN
 IF NEW.block_unit_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
   IF NEW.block_unit_id IS NOT DISTINCT FROM OLD.block_unit_id THEN RETURN NEW; END IF;
   before_value:=jsonb_build_object('code',OLD.block_code,'name',OLD.task_code,'parentId',OLD.block_unit_id,'version',OLD.version);
 END IF;
 INSERT INTO eoms.hierarchy_history(customer_id,estate_id,record_id,record_type,action,actor_id,reason,request_id,before_state,after_state)
 SELECT customer_id,NEW.estate_id,NEW.id,'task-link',CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'updated' END,eoms.actor_id(),coalesce(nullif(current_setting('app.change_reason',true),''),'System / explicit migration'),nullif(current_setting('app.request_id',true),'')::uuid,before_value,jsonb_build_object('code',NEW.block_code,'name',NEW.task_code,'parentId',NEW.block_unit_id,'version',NEW.version) FROM eoms.estates WHERE id=NEW.estate_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.record_task_block_link() FROM PUBLIC;
CREATE TRIGGER task_block_link_history AFTER INSERT OR UPDATE ON eoms.occurrences FOR EACH ROW EXECUTE FUNCTION eoms.record_task_block_link();
