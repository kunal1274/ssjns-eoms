-- Reversible availability; keep IDs, memberships and historical transactions.
ALTER TABLE eoms.estates ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE eoms.estates ADD COLUMN lifecycle_version integer NOT NULL DEFAULT 1 CHECK(lifecycle_version>0);
ALTER TABLE eoms.operating_units ADD COLUMN active boolean NOT NULL DEFAULT true;
GRANT UPDATE(active,lifecycle_version) ON eoms.estates TO eoms_app;
GRANT UPDATE(active) ON eoms.operating_units TO eoms_app;
ALTER TABLE eoms.hierarchy_history DROP CONSTRAINT hierarchy_history_record_type_check;
ALTER TABLE eoms.hierarchy_history ADD CONSTRAINT hierarchy_history_record_type_check CHECK(record_type IN ('group','company','unit','setup-grant','task-link','area','estate-placement','estate-lifecycle','unit-lifecycle'));
CREATE FUNCTION eoms.task_is_available(estate uuid,block uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,eoms AS $$
 SELECT EXISTS(SELECT 1 FROM eoms.estates WHERE id=estate AND active)
 AND (block IS NULL OR (EXISTS(SELECT 1 FROM eoms.operating_units WHERE id=block AND estate_id=estate) AND NOT EXISTS(
 WITH RECURSIVE ancestors AS (SELECT id,parent_id,active FROM eoms.operating_units WHERE id=block AND estate_id=estate UNION SELECT u.id,u.parent_id,u.active FROM eoms.operating_units u JOIN ancestors a ON u.id=a.parent_id WHERE u.estate_id=estate) SELECT 1 FROM ancestors WHERE NOT active)))
$$;
REVOKE ALL ON FUNCTION eoms.task_is_available(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.task_is_available(uuid,uuid) TO eoms_app;
CREATE FUNCTION eoms.guard_estate_unit_lifecycle() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
DECLARE enabled boolean; changed boolean;
BEGIN
 IF TG_TABLE_NAME='estates' THEN
  IF (NEW.active,NEW.lifecycle_version) IS NOT DISTINCT FROM (OLD.active,OLD.lifecycle_version) THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.id::text,601));
  IF (NEW.id,NEW.customer_id,NEW.company_id) IS DISTINCT FROM (OLD.id,OLD.customer_id,OLD.company_id) OR NEW.active=OLD.active OR NEW.lifecycle_version<>OLD.lifecycle_version+1 THEN RAISE EXCEPTION 'Invalid estate lifecycle transition' USING ERRCODE='23514'; END IF;
  IF eoms.actor_id() IS NULL OR NOT(eoms.is_member(NEW.id) AND eoms.can_manage_customer(NEW.customer_id)) THEN RAISE EXCEPTION 'Setup grant and estate membership required' USING ERRCODE='42501'; END IF;
  IF NOT NEW.active AND EXISTS(SELECT 1 FROM eoms.musters WHERE estate_id=NEW.id AND status='draft') THEN RAISE EXCEPTION 'Resolve draft work before estate deactivation' USING ERRCODE='23514'; END IF;
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.estate_id::text,601));
  SELECT active INTO enabled FROM eoms.estates WHERE id=NEW.estate_id;
  IF NEW.active AND (NOT coalesce(enabled,false) OR (NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM eoms.operating_units WHERE id=NEW.parent_id AND estate_id=NEW.estate_id AND active))) THEN RAISE EXCEPTION 'Activate estate and parent before active unit' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.active AND NOT NEW.active THEN
   IF EXISTS(SELECT 1 FROM eoms.operating_units WHERE estate_id=NEW.estate_id AND parent_id=NEW.id AND active) THEN RAISE EXCEPTION 'Deactivate active child units first' USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT 1 FROM eoms.musters m JOIN eoms.occurrences o ON o.id=m.occurrence_id AND o.estate_id=m.estate_id WHERE m.estate_id=NEW.estate_id AND o.block_unit_id=NEW.id AND m.status='draft') THEN RAISE EXCEPTION 'Resolve linked draft work before unit deactivation' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.guard_estate_unit_lifecycle() FROM PUBLIC;
CREATE TRIGGER estate_lifecycle_rules BEFORE UPDATE OF active,lifecycle_version ON eoms.estates FOR EACH ROW EXECUTE FUNCTION eoms.guard_estate_unit_lifecycle();
CREATE TRIGGER unit_lifecycle_rules BEFORE INSERT OR UPDATE ON eoms.operating_units FOR EACH ROW EXECUTE FUNCTION eoms.guard_estate_unit_lifecycle();
CREATE FUNCTION eoms.record_estate_unit_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE why text; scope_estate uuid; event_type text; before_version integer; after_version integer;
BEGIN
 IF NEW.active=OLD.active THEN RETURN NEW; END IF;
 why:=nullif(current_setting('app.change_reason',true),'');
 IF eoms.actor_id() IS NULL OR length(trim(coalesce(why,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Authenticated lifecycle reason required' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='estates' THEN scope_estate:=NEW.id;event_type:='estate-lifecycle';before_version:=OLD.lifecycle_version;after_version:=NEW.lifecycle_version;
 ELSE scope_estate:=NEW.estate_id;event_type:='unit-lifecycle';before_version:=OLD.version;after_version:=NEW.version; END IF;
 INSERT INTO eoms.hierarchy_history(customer_id,estate_id,record_id,record_type,action,actor_id,reason,request_id,before_state,after_state)
 VALUES(NEW.customer_id,scope_estate,NEW.id,event_type,'updated',eoms.actor_id(),why,nullif(current_setting('app.request_id',true),'')::uuid,jsonb_build_object('name',OLD.name,'code',OLD.code,'active',OLD.active,'version',before_version),jsonb_build_object('name',NEW.name,'code',NEW.code,'active',NEW.active,'version',after_version));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.record_estate_unit_lifecycle() FROM PUBLIC;
CREATE TRIGGER estate_lifecycle_history AFTER UPDATE OF active ON eoms.estates FOR EACH ROW EXECUTE FUNCTION eoms.record_estate_unit_lifecycle();
CREATE TRIGGER unit_lifecycle_history AFTER UPDATE OF active ON eoms.operating_units FOR EACH ROW EXECUTE FUNCTION eoms.record_estate_unit_lifecycle();
CREATE FUNCTION eoms.guard_work_availability() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
DECLARE block uuid;
BEGIN
 IF TG_TABLE_NAME='musters' THEN
  IF TG_OP='UPDATE' THEN
   IF (NEW.estate_id,NEW.occurrence_id) IS DISTINCT FROM (OLD.estate_id,OLD.occurrence_id) THEN RAISE EXCEPTION 'Recorded work scope is immutable' USING ERRCODE='23514'; END IF;
   IF NOT(OLD.status='draft' AND NEW.status='confirmed') THEN RETURN NEW; END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.estate_id::text,601));
  SELECT block_unit_id INTO block FROM eoms.occurrences WHERE id=NEW.occurrence_id AND estate_id=NEW.estate_id;
 ELSE
  IF TG_OP='UPDATE' THEN
   IF (NEW.capacity_ha,NEW.block_unit_id,NEW.block_code,NEW.task_code,NEW.activity,NEW.round_code) IS NOT DISTINCT FROM (OLD.capacity_ha,OLD.block_unit_id,OLD.block_code,OLD.task_code,OLD.activity,OLD.round_code) THEN RETURN NEW; END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.estate_id::text,601));
  block:=NEW.block_unit_id;
 END IF;
 IF NOT eoms.task_is_available(NEW.estate_id,block) THEN RAISE EXCEPTION 'Estate or configured block is inactive; reactivate through hierarchy setup' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.guard_work_availability() FROM PUBLIC;
CREATE TRIGGER aa_task_availability BEFORE INSERT OR UPDATE ON eoms.occurrences FOR EACH ROW EXECUTE FUNCTION eoms.guard_work_availability();
CREATE TRIGGER aa_work_availability BEFORE INSERT OR UPDATE ON eoms.musters FOR EACH ROW EXECUTE FUNCTION eoms.guard_work_availability();
