-- Baseline legal ownership is preserved; subsequent operational responsibility is dated.
CREATE TABLE eoms.estate_responsibilities(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),estate_id uuid NOT NULL,customer_id uuid NOT NULL,company_id uuid NOT NULL,previous_company_id uuid NOT NULL,
 effective_from date NOT NULL CHECK(effective_from>='2000-01-01'::date AND effective_from<'9999-01-01'::date),revision integer NOT NULL CHECK(revision>0),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),actor_id uuid REFERENCES eoms.users(id),request_id uuid,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(estate_id,effective_from),UNIQUE(estate_id,revision),UNIQUE(id,estate_id,company_id),
 FOREIGN KEY(estate_id,customer_id) REFERENCES eoms.estates(id,customer_id),
 FOREIGN KEY(company_id,customer_id) REFERENCES eoms.companies(id,customer_id),FOREIGN KEY(previous_company_id,customer_id) REFERENCES eoms.companies(id,customer_id)
);
ALTER TABLE eoms.estate_responsibilities ENABLE ROW LEVEL SECURITY; ALTER TABLE eoms.estate_responsibilities FORCE ROW LEVEL SECURITY;
CREATE POLICY responsibility_read ON eoms.estate_responsibilities FOR SELECT TO eoms_app USING(eoms.is_member(estate_id));
CREATE POLICY responsibility_create ON eoms.estate_responsibilities FOR INSERT TO eoms_app WITH CHECK(eoms.is_member(estate_id) AND eoms.can_manage_customer(customer_id));
GRANT SELECT ON eoms.estate_responsibilities TO eoms_app;
GRANT INSERT(estate_id,customer_id,company_id,effective_from,revision,reason) ON eoms.estate_responsibilities TO eoms_app;
CREATE POLICY company_responsibility_label ON eoms.companies FOR SELECT TO eoms_app USING(EXISTS(SELECT 1 FROM eoms.estate_responsibilities r WHERE r.company_id=companies.id AND r.customer_id=companies.customer_id));
ALTER TABLE eoms.musters ADD COLUMN legal_company_id uuid REFERENCES eoms.companies(id);
ALTER TABLE eoms.musters ADD COLUMN legal_company_name text;
ALTER TABLE eoms.musters ADD COLUMN legal_responsibility_id uuid;
ALTER TABLE eoms.musters ADD CONSTRAINT muster_responsibility_identity FOREIGN KEY(legal_responsibility_id,estate_id,legal_company_id) REFERENCES eoms.estate_responsibilities(id,estate_id,company_id);
CREATE FUNCTION eoms.validate_estate_responsibility() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
DECLARE baseline uuid; tenant uuid; prior_company uuid; prior_date date; prior_revision integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.estate_id::text,609));
 SELECT company_id,customer_id INTO baseline,tenant FROM eoms.estates WHERE id=NEW.estate_id;
 IF baseline IS NULL OR tenant<>NEW.customer_id THEN RAISE EXCEPTION 'Invalid estate tenant' USING ERRCODE='23503'; END IF;
 IF eoms.actor_id() IS NOT NULL AND NOT(eoms.is_member(NEW.estate_id) AND eoms.can_manage_customer(tenant)) THEN RAISE EXCEPTION 'Setup grant and estate membership required' USING ERRCODE='42501'; END IF;
 SELECT company_id,effective_from,revision INTO prior_company,prior_date,prior_revision FROM eoms.estate_responsibilities WHERE estate_id=NEW.estate_id ORDER BY effective_from DESC LIMIT 1;
 IF NEW.revision<>coalesce(prior_revision,0)+1 THEN RAISE EXCEPTION 'Responsibility revision changed' USING ERRCODE='23514'; END IF;
 IF NEW.effective_from<CURRENT_DATE OR (prior_date IS NOT NULL AND NEW.effective_from<=prior_date) OR NEW.company_id=coalesce(prior_company,baseline) THEN RAISE EXCEPTION 'Choose a newer current or future date and a different company' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM eoms.musters WHERE estate_id=NEW.estate_id AND business_date>=NEW.effective_from) THEN RAISE EXCEPTION 'Recorded work prevents responsibility change from this date' USING ERRCODE='23514'; END IF;
 NEW.previous_company_id:=coalesce(prior_company,baseline);NEW.actor_id:=eoms.actor_id();NEW.request_id:=nullif(current_setting('app.request_id',true),'')::uuid;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.validate_estate_responsibility() FROM PUBLIC;
CREATE TRIGGER estate_responsibility_rules BEFORE INSERT ON eoms.estate_responsibilities FOR EACH ROW EXECUTE FUNCTION eoms.validate_estate_responsibility();
CREATE FUNCTION eoms.snapshot_muster_responsibility() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
DECLARE baseline uuid;
BEGIN
 IF TG_OP='UPDATE' THEN
   IF (NEW.legal_company_id,NEW.legal_company_name,NEW.legal_responsibility_id,NEW.estate_id,NEW.business_date) IS DISTINCT FROM (OLD.legal_company_id,OLD.legal_company_name,OLD.legal_responsibility_id,OLD.estate_id,OLD.business_date) THEN RAISE EXCEPTION 'Recorded work attribution is immutable' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.estate_id::text,609));
 SELECT company_id INTO baseline FROM eoms.estates WHERE id=NEW.estate_id;
 IF baseline IS NULL THEN RAISE EXCEPTION 'Estate is not available' USING ERRCODE='23503'; END IF;
 SELECT id,company_id INTO NEW.legal_responsibility_id,NEW.legal_company_id FROM eoms.estate_responsibilities WHERE estate_id=NEW.estate_id AND effective_from<=NEW.business_date ORDER BY effective_from DESC LIMIT 1;
 NEW.legal_company_id:=coalesce(NEW.legal_company_id,baseline);
 SELECT name INTO NEW.legal_company_name FROM eoms.companies WHERE id=NEW.legal_company_id;
 IF NEW.legal_company_name IS NULL THEN RAISE EXCEPTION 'Responsible company is not available' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.snapshot_muster_responsibility() FROM PUBLIC;
CREATE TRIGGER muster_responsibility_snapshot BEFORE INSERT OR UPDATE ON eoms.musters FOR EACH ROW EXECUTE FUNCTION eoms.snapshot_muster_responsibility();
