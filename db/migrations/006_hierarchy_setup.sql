-- Explicit setup authority is separate from existing operational roles/memberships.
CREATE TABLE eoms.organization_admins(customer_id uuid NOT NULL REFERENCES eoms.customers(id),user_id uuid NOT NULL REFERENCES eoms.users(id),granted_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(customer_id,user_id));
ALTER TABLE eoms.organization_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoms.organization_admins FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_admin_self ON eoms.organization_admins FOR SELECT TO eoms_app USING(user_id=eoms.actor_id());
GRANT SELECT ON eoms.organization_admins TO eoms_app;
CREATE FUNCTION eoms.can_manage_customer(customer uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM eoms.organization_admins WHERE customer_id=customer AND user_id=eoms.actor_id()) $$;
REVOKE ALL ON FUNCTION eoms.can_manage_customer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.can_manage_customer(uuid) TO eoms_app;
CREATE TABLE eoms.customer_groups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES eoms.customers(id),code text NOT NULL CHECK(code ~ '^[A-Z0-9][A-Z0-9_-]{0,29}$'),name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),version integer NOT NULL DEFAULT 1 CHECK(version>0),UNIQUE(customer_id,code),UNIQUE(id,customer_id));
ALTER TABLE eoms.companies ADD COLUMN group_id uuid;
ALTER TABLE eoms.companies ADD COLUMN hierarchy_version integer NOT NULL DEFAULT 1 CHECK(hierarchy_version>0);
ALTER TABLE eoms.companies ADD CONSTRAINT company_group_customer FOREIGN KEY(group_id,customer_id) REFERENCES eoms.customer_groups(id,customer_id);
ALTER TABLE eoms.estates DROP CONSTRAINT estates_code_key;
ALTER TABLE eoms.estates ADD CONSTRAINT estate_customer_code UNIQUE(customer_id,code);
ALTER TABLE eoms.estates ADD CONSTRAINT estate_customer_key UNIQUE(id,customer_id);
CREATE TABLE eoms.operating_units(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES eoms.customers(id),estate_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('division','field','block')),code text NOT NULL CHECK(code ~ '^[A-Z0-9][A-Z0-9_-]{0,29}$'),name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
 parent_id uuid,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(id,customer_id,estate_id),UNIQUE(estate_id,kind,code),
 FOREIGN KEY(estate_id,customer_id) REFERENCES eoms.estates(id,customer_id),
 FOREIGN KEY(parent_id,customer_id,estate_id) REFERENCES eoms.operating_units(id,customer_id,estate_id)
);
CREATE INDEX operating_unit_parent ON eoms.operating_units(estate_id,parent_id);
CREATE FUNCTION eoms.validate_operating_unit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
DECLARE parent_kind text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.estate_id::text,601));
 IF TG_OP='UPDATE' THEN
   IF (NEW.id,NEW.customer_id,NEW.estate_id,NEW.kind) IS DISTINCT FROM (OLD.id,OLD.customer_id,OLD.estate_id,OLD.kind) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Immutable hierarchy scope or invalid version' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.parent_id=NEW.id THEN RAISE EXCEPTION 'Hierarchy cannot parent itself' USING ERRCODE='23514'; END IF;
 IF NEW.kind='division' THEN
   IF NEW.parent_id IS NOT NULL THEN RAISE EXCEPTION 'Division must attach to estate' USING ERRCODE='23514'; END IF;
 ELSE
   SELECT kind INTO parent_kind FROM eoms.operating_units WHERE id=NEW.parent_id AND estate_id=NEW.estate_id AND customer_id=NEW.customer_id;
   IF parent_kind IS NULL THEN RAISE EXCEPTION 'Invalid hierarchy parent' USING ERRCODE='23503'; END IF;
   IF (NEW.kind='field' AND parent_kind<>'division') OR (NEW.kind='block' AND parent_kind NOT IN ('division','field')) THEN RAISE EXCEPTION 'Invalid hierarchy parent type' USING ERRCODE='23514'; END IF;
   IF EXISTS(WITH RECURSIVE ancestors AS (SELECT id,parent_id FROM eoms.operating_units WHERE id=NEW.parent_id UNION SELECT p.id,p.parent_id FROM eoms.operating_units p JOIN ancestors a ON p.id=a.parent_id) SELECT 1 FROM ancestors WHERE id=NEW.id) THEN RAISE EXCEPTION 'Hierarchy cycle rejected' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.validate_operating_unit() FROM PUBLIC;
CREATE TRIGGER validate_operating_unit BEFORE INSERT OR UPDATE ON eoms.operating_units FOR EACH ROW EXECUTE FUNCTION eoms.validate_operating_unit();
CREATE TABLE eoms.hierarchy_history(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,customer_id uuid NOT NULL REFERENCES eoms.customers(id),estate_id uuid REFERENCES eoms.estates(id),record_id uuid NOT NULL,
 record_type text NOT NULL CHECK(record_type IN ('group','company','unit','setup-grant')),action text NOT NULL CHECK(action IN ('created','updated')),actor_id uuid REFERENCES eoms.users(id),reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),request_id uuid,before_state jsonb,after_state jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hierarchy_history_scope ON eoms.hierarchy_history(customer_id,id DESC);
CREATE FUNCTION eoms.record_hierarchy_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE before_value jsonb; after_value jsonb; event_estate uuid; event_type text; change_reason text;
BEGIN
 change_reason:=nullif(current_setting('app.change_reason',true),'');
 IF change_reason IS NULL AND eoms.actor_id() IS NOT NULL THEN RAISE EXCEPTION 'Change reason required' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='operating_units' THEN
   event_estate:=NEW.estate_id; event_type:='unit';
   after_value:=jsonb_build_object('code',NEW.code,'name',NEW.name,'kind',NEW.kind,'parentId',NEW.parent_id,'version',NEW.version);
   IF TG_OP='UPDATE' THEN before_value:=jsonb_build_object('code',OLD.code,'name',OLD.name,'kind',OLD.kind,'parentId',OLD.parent_id,'version',OLD.version); END IF;
 ELSIF TG_TABLE_NAME='customer_groups' THEN
   event_type:='group';
   IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.customer_id<>OLD.customer_id OR NEW.version<>OLD.version+1) THEN RAISE EXCEPTION 'Invalid group scope or version' USING ERRCODE='23514'; END IF;
   after_value:=jsonb_build_object('code',NEW.code,'name',NEW.name,'version',NEW.version);
   IF TG_OP='UPDATE' THEN before_value:=jsonb_build_object('code',OLD.code,'name',OLD.name,'version',OLD.version); END IF;
 ELSE
   event_type:='company';
   IF NEW.hierarchy_version<>OLD.hierarchy_version+1 THEN RAISE EXCEPTION 'Invalid company hierarchy version' USING ERRCODE='23514'; END IF;
   after_value:=jsonb_build_object('name',NEW.name,'groupId',NEW.group_id,'version',NEW.hierarchy_version);
   before_value:=jsonb_build_object('name',OLD.name,'groupId',OLD.group_id,'version',OLD.hierarchy_version);
 END IF;
 INSERT INTO eoms.hierarchy_history(customer_id,estate_id,record_id,record_type,action,actor_id,reason,request_id,before_state,after_state)
 VALUES(NEW.customer_id,event_estate,NEW.id,event_type,CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'updated' END,eoms.actor_id(),coalesce(change_reason,'System / migration'),nullif(current_setting('app.request_id',true),'')::uuid,before_value,after_value);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.record_hierarchy_change() FROM PUBLIC;
CREATE TRIGGER group_history AFTER INSERT OR UPDATE ON eoms.customer_groups FOR EACH ROW EXECUTE FUNCTION eoms.record_hierarchy_change();
CREATE TRIGGER unit_history AFTER INSERT OR UPDATE ON eoms.operating_units FOR EACH ROW EXECUTE FUNCTION eoms.record_hierarchy_change();
CREATE TRIGGER company_group_history AFTER UPDATE OF group_id,hierarchy_version ON eoms.companies FOR EACH ROW EXECUTE FUNCTION eoms.record_hierarchy_change();
ALTER TABLE eoms.customer_groups ENABLE ROW LEVEL SECURITY; ALTER TABLE eoms.customer_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY groups_read ON eoms.customer_groups FOR SELECT TO eoms_app USING(eoms.can_manage_customer(customer_id) OR EXISTS(SELECT 1 FROM eoms.companies c WHERE c.group_id=customer_groups.id));
CREATE POLICY groups_insert ON eoms.customer_groups FOR INSERT TO eoms_app WITH CHECK(eoms.can_manage_customer(customer_id));
CREATE POLICY groups_update ON eoms.customer_groups FOR UPDATE TO eoms_app USING(eoms.can_manage_customer(customer_id)) WITH CHECK(eoms.can_manage_customer(customer_id));
CREATE POLICY company_group_update ON eoms.companies FOR UPDATE TO eoms_app USING(eoms.can_manage_customer(customer_id)) WITH CHECK(eoms.can_manage_customer(customer_id));
ALTER TABLE eoms.operating_units ENABLE ROW LEVEL SECURITY; ALTER TABLE eoms.operating_units FORCE ROW LEVEL SECURITY;
CREATE POLICY units_read ON eoms.operating_units FOR SELECT TO eoms_app USING(eoms.is_member(estate_id));
CREATE POLICY units_insert ON eoms.operating_units FOR INSERT TO eoms_app WITH CHECK(eoms.is_member(estate_id) AND eoms.can_manage_customer(customer_id));
CREATE POLICY units_update ON eoms.operating_units FOR UPDATE TO eoms_app USING(eoms.is_member(estate_id) AND eoms.can_manage_customer(customer_id)) WITH CHECK(eoms.is_member(estate_id) AND eoms.can_manage_customer(customer_id));
ALTER TABLE eoms.hierarchy_history ENABLE ROW LEVEL SECURITY; ALTER TABLE eoms.hierarchy_history FORCE ROW LEVEL SECURITY;
CREATE POLICY hierarchy_history_read ON eoms.hierarchy_history FOR SELECT TO eoms_app USING((estate_id IS NOT NULL AND eoms.is_member(estate_id)) OR (estate_id IS NULL AND eoms.can_manage_customer(customer_id)));
GRANT SELECT,INSERT ON eoms.customer_groups,eoms.operating_units TO eoms_app;
GRANT UPDATE(code,name,version) ON eoms.customer_groups TO eoms_app;
GRANT UPDATE(code,name,parent_id,version) ON eoms.operating_units TO eoms_app;
GRANT UPDATE(group_id,hierarchy_version) ON eoms.companies TO eoms_app;
GRANT SELECT ON eoms.hierarchy_history TO eoms_app;

CREATE FUNCTION eoms.record_setup_grant() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE customer uuid; target uuid;
BEGIN
 IF TG_OP='INSERT' THEN customer:=NEW.customer_id;target:=NEW.user_id;ELSE customer:=OLD.customer_id;target:=OLD.user_id;END IF;
 INSERT INTO eoms.hierarchy_history(customer_id,record_id,record_type,action,actor_id,reason,request_id,before_state,after_state)
 VALUES(customer,target,'setup-grant',CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'updated' END,eoms.actor_id(),coalesce(nullif(current_setting('app.change_reason',true),''),'System / explicit bootstrap'),nullif(current_setting('app.request_id',true),'')::uuid,
 CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('name','Hierarchy setup grant','version',1) ELSE NULL END,
 jsonb_build_object('name',CASE WHEN TG_OP='INSERT' THEN 'Hierarchy setup grant' ELSE 'Hierarchy setup revoked' END,'version',CASE WHEN TG_OP='INSERT' THEN 1 ELSE 2 END));
 IF TG_OP='INSERT' THEN RETURN NEW;ELSE RETURN OLD;END IF;
END $$;
REVOKE ALL ON FUNCTION eoms.record_setup_grant() FROM PUBLIC;
CREATE TRIGGER setup_grant_history AFTER INSERT OR DELETE ON eoms.organization_admins FOR EACH ROW EXECUTE FUNCTION eoms.record_setup_grant();
