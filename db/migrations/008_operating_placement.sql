-- Optional operating areas are separate from legal ownership and access grants.
CREATE TABLE eoms.operating_areas(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES eoms.customers(id),
 kind text NOT NULL CHECK(kind IN ('region','business-unit')),code text NOT NULL CHECK(code ~ '^[A-Z0-9][A-Z0-9_-]{0,29}$'),name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
 parent_id uuid,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(id,customer_id),UNIQUE(customer_id,code),
 FOREIGN KEY(parent_id,customer_id) REFERENCES eoms.operating_areas(id,customer_id)
);
ALTER TABLE eoms.estates ADD COLUMN area_id uuid;
ALTER TABLE eoms.estates ADD COLUMN placement_version integer NOT NULL DEFAULT 1 CHECK(placement_version>0);
ALTER TABLE eoms.estates ADD CONSTRAINT estate_operating_area FOREIGN KEY(area_id,customer_id) REFERENCES eoms.operating_areas(id,customer_id);
CREATE INDEX estate_operating_area ON eoms.estates(customer_id,area_id);
CREATE FUNCTION eoms.can_read_area(target uuid,customer uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
 SELECT EXISTS(SELECT 1 FROM eoms.estates e LEFT JOIN eoms.operating_areas child ON child.id=e.area_id AND child.customer_id=e.customer_id WHERE e.customer_id=customer AND eoms.is_member(e.id) AND (e.area_id=target OR child.parent_id=target))
$$;
REVOKE ALL ON FUNCTION eoms.can_read_area(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.can_read_area(uuid,uuid) TO eoms_app;
ALTER TABLE eoms.operating_areas ENABLE ROW LEVEL SECURITY; ALTER TABLE eoms.operating_areas FORCE ROW LEVEL SECURITY;
CREATE POLICY areas_read ON eoms.operating_areas FOR SELECT TO eoms_app USING(eoms.can_manage_customer(customer_id) OR eoms.can_read_area(id,customer_id));
CREATE POLICY areas_create ON eoms.operating_areas FOR INSERT TO eoms_app WITH CHECK(eoms.can_manage_customer(customer_id));
CREATE POLICY areas_edit ON eoms.operating_areas FOR UPDATE TO eoms_app USING(eoms.can_manage_customer(customer_id)) WITH CHECK(eoms.can_manage_customer(customer_id));
CREATE POLICY estate_place ON eoms.estates FOR UPDATE TO eoms_app USING(eoms.is_member(id) AND eoms.can_manage_customer(customer_id)) WITH CHECK(eoms.is_member(id) AND eoms.can_manage_customer(customer_id));
GRANT SELECT,INSERT ON eoms.operating_areas TO eoms_app;
GRANT UPDATE(code,name,version) ON eoms.operating_areas TO eoms_app;
GRANT UPDATE(area_id,placement_version) ON eoms.estates TO eoms_app;
CREATE FUNCTION eoms.validate_operating_area() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
DECLARE parent_kind text;
BEGIN
 IF TG_OP='UPDATE' AND ((NEW.id,NEW.customer_id,NEW.kind,NEW.parent_id) IS DISTINCT FROM (OLD.id,OLD.customer_id,OLD.kind,OLD.parent_id) OR NEW.version<>OLD.version+1) THEN RAISE EXCEPTION 'Immutable operating area scope or invalid version' USING ERRCODE='23514'; END IF;
 IF NEW.kind='region' AND NEW.parent_id IS NOT NULL THEN RAISE EXCEPTION 'Region must attach to customer' USING ERRCODE='23514'; END IF;
 IF NEW.parent_id IS NOT NULL THEN
   IF NEW.parent_id=NEW.id THEN RAISE EXCEPTION 'Area cannot parent itself' USING ERRCODE='23514'; END IF;
   SELECT kind INTO parent_kind FROM eoms.operating_areas WHERE id=NEW.parent_id AND customer_id=NEW.customer_id FOR SHARE;
   IF parent_kind IS NULL THEN RAISE EXCEPTION 'Invalid area parent' USING ERRCODE='23503'; END IF;
   IF NEW.kind<>'business-unit' OR parent_kind<>'region' THEN RAISE EXCEPTION 'Business unit parent must be a region' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.validate_operating_area() FROM PUBLIC;
CREATE TRIGGER operating_area_rules BEFORE INSERT OR UPDATE ON eoms.operating_areas FOR EACH ROW EXECUTE FUNCTION eoms.validate_operating_area();
CREATE FUNCTION eoms.validate_estate_placement() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
BEGIN
 IF (NEW.area_id,NEW.placement_version) IS NOT DISTINCT FROM (OLD.area_id,OLD.placement_version) THEN RETURN NEW; END IF;
 IF OLD.area_id IS NOT NULL OR NEW.area_id IS NULL OR NEW.placement_version<>OLD.placement_version+1 THEN RAISE EXCEPTION 'Placement is initial only; governed moves are required' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.customer_id,NEW.company_id) IS DISTINCT FROM (OLD.id,OLD.customer_id,OLD.company_id) THEN RAISE EXCEPTION 'Placement cannot change estate or legal ownership' USING ERRCODE='23514'; END IF;
 IF eoms.actor_id() IS NOT NULL AND NOT (eoms.is_member(NEW.id) AND eoms.can_manage_customer(NEW.customer_id)) THEN RAISE EXCEPTION 'Setup grant and estate membership required' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.validate_estate_placement() FROM PUBLIC;
CREATE TRIGGER estate_placement_rules BEFORE UPDATE ON eoms.estates FOR EACH ROW EXECUTE FUNCTION eoms.validate_estate_placement();
ALTER TABLE eoms.hierarchy_history DROP CONSTRAINT hierarchy_history_record_type_check;
ALTER TABLE eoms.hierarchy_history ADD CONSTRAINT hierarchy_history_record_type_check CHECK(record_type IN ('group','company','unit','setup-grant','task-link','area','estate-placement'));
CREATE FUNCTION eoms.record_operating_placement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE before_value jsonb; after_value jsonb; event_type text; event_estate uuid; change_reason text;
BEGIN
 change_reason:=nullif(current_setting('app.change_reason',true),'');
 IF eoms.actor_id() IS NOT NULL AND length(trim(coalesce(change_reason,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Placement change reason required' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='operating_areas' THEN
   event_type:='area';
   after_value:=jsonb_build_object('code',NEW.code,'name',NEW.name,'kind',NEW.kind,'parentId',NEW.parent_id,'version',NEW.version);
   IF TG_OP='UPDATE' THEN before_value:=jsonb_build_object('code',OLD.code,'name',OLD.name,'kind',OLD.kind,'parentId',OLD.parent_id,'version',OLD.version); END IF;
 ELSE
   IF (NEW.area_id,NEW.placement_version) IS NOT DISTINCT FROM (OLD.area_id,OLD.placement_version) THEN RETURN NEW; END IF;
   event_type:='estate-placement';event_estate:=NEW.id;
   after_value:=jsonb_build_object('code',NEW.code,'name',NEW.name,'parentId',NEW.area_id,'version',NEW.placement_version);
   before_value:=jsonb_build_object('code',OLD.code,'name',OLD.name,'parentId',OLD.area_id,'version',OLD.placement_version);
 END IF;
 INSERT INTO eoms.hierarchy_history(customer_id,estate_id,record_id,record_type,action,actor_id,reason,request_id,before_state,after_state)
 VALUES(NEW.customer_id,event_estate,NEW.id,event_type,CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'updated' END,eoms.actor_id(),coalesce(change_reason,'System / explicit migration'),nullif(current_setting('app.request_id',true),'')::uuid,before_value,after_value);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.record_operating_placement() FROM PUBLIC;
CREATE TRIGGER operating_area_history AFTER INSERT OR UPDATE ON eoms.operating_areas FOR EACH ROW EXECUTE FUNCTION eoms.record_operating_placement();
CREATE TRIGGER estate_placement_history AFTER UPDATE OF area_id,placement_version ON eoms.estates FOR EACH ROW EXECUTE FUNCTION eoms.record_operating_placement();
