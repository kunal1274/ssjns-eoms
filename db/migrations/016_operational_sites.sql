-- Typed facilities are distinct from agronomic operating units. No inferred legacy rows.
CREATE TABLE eoms.operational_sites(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES eoms.customers(id),company_id uuid NOT NULL,estate_id uuid,
 kind text NOT NULL CHECK(kind IN ('mill','nursery','warehouse','workshop','other')),
 code text NOT NULL CHECK(code ~ '^[A-Z0-9][A-Z0-9_-]{0,29}$'),name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
 active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(customer_id,code),UNIQUE(id,customer_id),
 FOREIGN KEY(company_id,customer_id) REFERENCES eoms.companies(id,customer_id),
 FOREIGN KEY(estate_id,customer_id) REFERENCES eoms.estates(id,customer_id)
);
CREATE INDEX site_customer_page ON eoms.operational_sites(customer_id,id);
CREATE INDEX site_company_read ON eoms.operational_sites(company_id,id);
CREATE INDEX site_estate_read ON eoms.operational_sites(estate_id,id);
ALTER TABLE eoms.operational_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoms.operational_sites FORCE ROW LEVEL SECURITY;
CREATE POLICY sites_read ON eoms.operational_sites FOR SELECT TO eoms_app USING(
 (estate_id IS NOT NULL AND eoms.is_member(estate_id)) OR (estate_id IS NULL AND eoms.can_manage_customer(customer_id))
);
CREATE POLICY sites_create ON eoms.operational_sites FOR INSERT TO eoms_app WITH CHECK(
 eoms.can_manage_customer(customer_id) AND (estate_id IS NULL OR eoms.is_member(estate_id))
);
CREATE POLICY sites_edit ON eoms.operational_sites FOR UPDATE TO eoms_app USING(
 eoms.can_manage_customer(customer_id) AND (estate_id IS NULL OR eoms.is_member(estate_id))
) WITH CHECK(eoms.can_manage_customer(customer_id) AND (estate_id IS NULL OR eoms.is_member(estate_id)));
-- Setup metadata authority does not confer estate/work access. Site references allow labels only.
CREATE POLICY customer_setup_metadata ON eoms.customers FOR SELECT TO eoms_app USING(eoms.can_manage_customer(id));
CREATE POLICY company_setup_metadata ON eoms.companies FOR SELECT TO eoms_app USING(eoms.can_manage_customer(customer_id));
CREATE POLICY company_site_label ON eoms.companies FOR SELECT TO eoms_app USING(
 EXISTS(SELECT 1 FROM eoms.operational_sites s WHERE s.company_id=companies.id AND s.customer_id=companies.customer_id)
);
CREATE TABLE eoms.site_history(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,site_id uuid NOT NULL,customer_id uuid NOT NULL,
 actor_id uuid REFERENCES eoms.users(id),action text NOT NULL CHECK(action IN ('created','updated')),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 request_id uuid,before_state jsonb,after_state jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(site_id,customer_id) REFERENCES eoms.operational_sites(id,customer_id)
);
CREATE INDEX site_history_page ON eoms.site_history(site_id,id DESC);
ALTER TABLE eoms.site_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoms.site_history FORCE ROW LEVEL SECURITY;
CREATE POLICY site_history_read ON eoms.site_history FOR SELECT TO eoms_app USING(
 EXISTS(SELECT 1 FROM eoms.operational_sites s WHERE s.id=site_id AND s.customer_id=site_history.customer_id)
);
CREATE FUNCTION eoms.validate_site_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
BEGIN
 IF nullif(current_setting('app.change_reason',true),'') IS NULL OR length(trim(current_setting('app.change_reason',true))) NOT BETWEEN 3 AND 500 THEN
  RAISE EXCEPTION 'Site change reason required' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' AND NEW.version<>1 THEN RAISE EXCEPTION 'Initial site version must be one' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.customer_id,NEW.company_id,NEW.estate_id,NEW.kind,NEW.code) IS DISTINCT FROM (OLD.id,OLD.customer_id,OLD.company_id,OLD.estate_id,OLD.kind,OLD.code) OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'Immutable site identity or invalid version' USING ERRCODE='23514';
  END IF;
  IF (NEW.name,NEW.active) IS NOT DISTINCT FROM (OLD.name,OLD.active) THEN RAISE EXCEPTION 'No site change to save' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.estate_id IS NOT NULL AND (TG_OP='INSERT' OR (NEW.active AND NOT OLD.active)) THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.estate_id::text,601));
  IF NOT EXISTS(SELECT 1 FROM eoms.estates WHERE id=NEW.estate_id AND customer_id=NEW.customer_id AND active) THEN
   RAISE EXCEPTION 'Linked estate must be active and available' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.validate_site_change() FROM PUBLIC;
CREATE TRIGGER validate_site BEFORE INSERT OR UPDATE ON eoms.operational_sites FOR EACH ROW EXECUTE FUNCTION eoms.validate_site_change();
CREATE FUNCTION eoms.record_site_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
BEGIN
 INSERT INTO eoms.site_history(site_id,customer_id,actor_id,action,reason,request_id,before_state,after_state)
 VALUES(NEW.id,NEW.customer_id,eoms.actor_id(),CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'updated' END,current_setting('app.change_reason',true),nullif(current_setting('app.request_id',true),'')::uuid,
 CASE WHEN TG_OP='UPDATE' THEN jsonb_build_object('name',OLD.name,'active',OLD.active,'version',OLD.version) ELSE NULL END,
 jsonb_build_object('name',NEW.name,'active',NEW.active,'version',NEW.version,'code',NEW.code,'kind',NEW.kind,'companyId',NEW.company_id,'estateId',NEW.estate_id));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.record_site_change() FROM PUBLIC;
CREATE TRIGGER site_change_history AFTER INSERT OR UPDATE ON eoms.operational_sites FOR EACH ROW EXECUTE FUNCTION eoms.record_site_change();
GRANT SELECT,INSERT ON eoms.operational_sites TO eoms_app;
GRANT UPDATE(name,active,version) ON eoms.operational_sites TO eoms_app;
GRANT SELECT ON eoms.site_history TO eoms_app;
