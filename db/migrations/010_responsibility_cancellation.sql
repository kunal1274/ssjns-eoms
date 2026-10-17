-- Narrow two-actor cancellation policy; original responsibility events remain immutable.
ALTER TABLE eoms.estate_responsibilities ADD CONSTRAINT responsibility_estate_identity UNIQUE(id,estate_id);
CREATE TABLE eoms.responsibility_cancel_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),responsibility_id uuid NOT NULL,estate_id uuid NOT NULL,customer_id uuid NOT NULL,
 expected_revision integer NOT NULL CHECK(expected_revision>0),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 requester_id uuid NOT NULL REFERENCES eoms.users(id),request_id uuid,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,estate_id,customer_id),FOREIGN KEY(responsibility_id,estate_id) REFERENCES eoms.estate_responsibilities(id,estate_id),FOREIGN KEY(estate_id,customer_id) REFERENCES eoms.estates(id,customer_id)
);
CREATE TABLE eoms.responsibility_cancel_decisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),cancel_request_id uuid NOT NULL UNIQUE,estate_id uuid NOT NULL,customer_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('approved','rejected')),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 reviewer_id uuid NOT NULL REFERENCES eoms.users(id),request_id uuid,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(cancel_request_id,estate_id,customer_id) REFERENCES eoms.responsibility_cancel_requests(id,estate_id,customer_id)
);
CREATE INDEX cancel_request_scope ON eoms.responsibility_cancel_requests(estate_id,responsibility_id);
DO $$ DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['responsibility_cancel_requests','responsibility_cancel_decisions'] LOOP
 EXECUTE format('ALTER TABLE eoms.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE eoms.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY cancellation_read ON eoms.%I FOR SELECT TO eoms_app USING(eoms.is_member(estate_id))',tab);
 EXECUTE format('CREATE POLICY cancellation_create ON eoms.%I FOR INSERT TO eoms_app WITH CHECK(eoms.is_member(estate_id) AND eoms.can_manage_customer(customer_id))',tab);
END LOOP;END $$;
GRANT SELECT ON eoms.responsibility_cancel_requests,eoms.responsibility_cancel_decisions TO eoms_app;
GRANT INSERT(responsibility_id,estate_id,customer_id,expected_revision,reason) ON eoms.responsibility_cancel_requests TO eoms_app;
GRANT INSERT(cancel_request_id,estate_id,customer_id,decision,reason) ON eoms.responsibility_cancel_decisions TO eoms_app;
CREATE VIEW eoms.active_estate_responsibilities WITH (security_invoker=true) AS SELECT r.* FROM eoms.estate_responsibilities r WHERE NOT EXISTS(SELECT 1 FROM eoms.responsibility_cancel_requests q JOIN eoms.responsibility_cancel_decisions d ON d.cancel_request_id=q.id WHERE q.responsibility_id=r.id AND d.decision='approved');
GRANT SELECT ON eoms.active_estate_responsibilities TO eoms_app;
CREATE FUNCTION eoms.guard_responsibility_cancellation(target uuid,estate uuid,expected integer) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
DECLARE active_id uuid; target_date date; current_revision integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(estate::text,609));
 SELECT coalesce(max(revision),0) INTO current_revision FROM eoms.estate_responsibilities WHERE estate_id=estate;
 SELECT id,effective_from INTO active_id,target_date FROM eoms.active_estate_responsibilities WHERE estate_id=estate ORDER BY effective_from DESC LIMIT 1;
 IF current_revision<>expected OR active_id IS DISTINCT FROM target THEN RAISE EXCEPTION 'Cancellation target or revision changed' USING ERRCODE='23514'; END IF;
 IF target_date<=CURRENT_DATE THEN RAISE EXCEPTION 'Only strictly future responsibility can be cancelled' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM eoms.musters WHERE estate_id=estate AND business_date>=target_date) THEN RAISE EXCEPTION 'Recorded work prevents cancellation' USING ERRCODE='23514'; END IF;
END $$;
REVOKE ALL ON FUNCTION eoms.guard_responsibility_cancellation(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.guard_responsibility_cancellation(uuid,uuid,integer) TO eoms_app;
CREATE FUNCTION eoms.validate_responsibility_cancellation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
DECLARE request_row eoms.responsibility_cancel_requests%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.estate_id::text,609));
 IF eoms.actor_id() IS NULL OR NOT(eoms.is_member(NEW.estate_id) AND eoms.can_manage_customer(NEW.customer_id)) THEN RAISE EXCEPTION 'Explicit setup actor and estate membership required' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='responsibility_cancel_requests' THEN
   PERFORM eoms.guard_responsibility_cancellation(NEW.responsibility_id,NEW.estate_id,NEW.expected_revision);
   IF EXISTS(SELECT 1 FROM eoms.responsibility_cancel_requests q WHERE q.responsibility_id=NEW.responsibility_id AND NOT EXISTS(SELECT 1 FROM eoms.responsibility_cancel_decisions d WHERE d.cancel_request_id=q.id)) THEN RAISE EXCEPTION 'Pending cancellation already exists' USING ERRCODE='23514'; END IF;
   NEW.requester_id:=eoms.actor_id();
 ELSE
   SELECT * INTO request_row FROM eoms.responsibility_cancel_requests WHERE id=NEW.cancel_request_id AND estate_id=NEW.estate_id AND customer_id=NEW.customer_id;
   IF request_row.id IS NULL THEN RAISE EXCEPTION 'Cancellation request not available' USING ERRCODE='23503'; END IF;
   IF request_row.requester_id=eoms.actor_id() THEN RAISE EXCEPTION 'Independent reviewer required' USING ERRCODE='42501'; END IF;
   IF NEW.decision='approved' THEN PERFORM eoms.guard_responsibility_cancellation(request_row.responsibility_id,NEW.estate_id,request_row.expected_revision); END IF;
   NEW.reviewer_id:=eoms.actor_id();
 END IF;
 NEW.request_id:=nullif(current_setting('app.request_id',true),'')::uuid;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.validate_responsibility_cancellation() FROM PUBLIC;
CREATE TRIGGER responsibility_cancel_request_rules BEFORE INSERT ON eoms.responsibility_cancel_requests FOR EACH ROW EXECUTE FUNCTION eoms.validate_responsibility_cancellation();
CREATE TRIGGER responsibility_cancel_review_rules BEFORE INSERT ON eoms.responsibility_cancel_decisions FOR EACH ROW EXECUTE FUNCTION eoms.validate_responsibility_cancellation();
ALTER TABLE eoms.estate_responsibilities ADD COLUMN replaces_responsibility_id uuid;
ALTER TABLE eoms.estate_responsibilities ADD CONSTRAINT responsibility_replacement_estate FOREIGN KEY(replaces_responsibility_id,estate_id) REFERENCES eoms.estate_responsibilities(id,estate_id);
ALTER TABLE eoms.estate_responsibilities ADD CONSTRAINT responsibility_replacement_once UNIQUE(replaces_responsibility_id);
ALTER TABLE eoms.estate_responsibilities DROP CONSTRAINT estate_responsibilities_estate_id_effective_from_key;
CREATE INDEX responsibility_date_scope ON eoms.estate_responsibilities(estate_id,effective_from DESC);
GRANT INSERT(replaces_responsibility_id) ON eoms.estate_responsibilities TO eoms_app;
-- Recreate the security-invoker view to include the new lineage column.
CREATE OR REPLACE VIEW eoms.active_estate_responsibilities WITH (security_invoker=true) AS SELECT r.* FROM eoms.estate_responsibilities r WHERE NOT EXISTS(SELECT 1 FROM eoms.responsibility_cancel_requests q JOIN eoms.responsibility_cancel_decisions d ON d.cancel_request_id=q.id WHERE q.responsibility_id=r.id AND d.decision='approved');
CREATE OR REPLACE FUNCTION eoms.validate_estate_responsibility() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
DECLARE baseline uuid;tenant uuid;prior_company uuid;prior_date date;prior_revision integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.estate_id::text,609));
 SELECT company_id,customer_id INTO baseline,tenant FROM eoms.estates WHERE id=NEW.estate_id;
 IF baseline IS NULL OR tenant<>NEW.customer_id THEN RAISE EXCEPTION 'Invalid estate tenant' USING ERRCODE='23503'; END IF;
 IF eoms.actor_id() IS NOT NULL AND NOT(eoms.is_member(NEW.estate_id) AND eoms.can_manage_customer(tenant)) THEN RAISE EXCEPTION 'Setup grant and estate membership required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(revision),0) INTO prior_revision FROM eoms.estate_responsibilities WHERE estate_id=NEW.estate_id;
 SELECT company_id,effective_from INTO prior_company,prior_date FROM eoms.active_estate_responsibilities WHERE estate_id=NEW.estate_id ORDER BY effective_from DESC LIMIT 1;
 IF NEW.revision<>prior_revision+1 THEN RAISE EXCEPTION 'Responsibility revision changed' USING ERRCODE='23514'; END IF;
 IF NEW.effective_from<CURRENT_DATE OR (prior_date IS NOT NULL AND NEW.effective_from<=prior_date) OR NEW.company_id=coalesce(prior_company,baseline) THEN RAISE EXCEPTION 'Choose a newer current or future date and a different company' USING ERRCODE='23514'; END IF;
 IF NEW.replaces_responsibility_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM eoms.responsibility_cancel_requests q JOIN eoms.responsibility_cancel_decisions d ON d.cancel_request_id=q.id WHERE q.responsibility_id=NEW.replaces_responsibility_id AND q.estate_id=NEW.estate_id AND d.decision='approved') THEN RAISE EXCEPTION 'Replacement requires approved cancellation in this estate' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM eoms.estate_responsibilities r WHERE r.estate_id=NEW.estate_id AND r.effective_from=NEW.effective_from) AND NOT EXISTS(SELECT 1 FROM eoms.estate_responsibilities r WHERE r.id=NEW.replaces_responsibility_id AND r.estate_id=NEW.estate_id AND r.effective_from=NEW.effective_from) THEN RAISE EXCEPTION 'Same-date correction requires matching replacement lineage' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM eoms.musters WHERE estate_id=NEW.estate_id AND business_date>=NEW.effective_from) THEN RAISE EXCEPTION 'Recorded work prevents responsibility change from this date' USING ERRCODE='23514'; END IF;
 NEW.previous_company_id:=coalesce(prior_company,baseline);NEW.actor_id:=eoms.actor_id();NEW.request_id:=nullif(current_setting('app.request_id',true),'')::uuid;RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION eoms.snapshot_muster_responsibility() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
DECLARE baseline uuid;
BEGIN
 IF TG_OP='UPDATE' THEN
   IF (NEW.legal_company_id,NEW.legal_company_name,NEW.legal_responsibility_id,NEW.estate_id,NEW.business_date) IS DISTINCT FROM (OLD.legal_company_id,OLD.legal_company_name,OLD.legal_responsibility_id,OLD.estate_id,OLD.business_date) THEN RAISE EXCEPTION 'Recorded work attribution is immutable' USING ERRCODE='23514'; END IF;RETURN NEW;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.estate_id::text,609));SELECT company_id INTO baseline FROM eoms.estates WHERE id=NEW.estate_id;
 IF baseline IS NULL THEN RAISE EXCEPTION 'Estate is not available' USING ERRCODE='23503'; END IF;
 SELECT id,company_id INTO NEW.legal_responsibility_id,NEW.legal_company_id FROM eoms.active_estate_responsibilities WHERE estate_id=NEW.estate_id AND effective_from<=NEW.business_date ORDER BY effective_from DESC LIMIT 1;
 NEW.legal_company_id:=coalesce(NEW.legal_company_id,baseline);SELECT name INTO NEW.legal_company_name FROM eoms.companies WHERE id=NEW.legal_company_id;
 IF NEW.legal_company_name IS NULL THEN RAISE EXCEPTION 'Responsible company is not available' USING ERRCODE='23503'; END IF;RETURN NEW;
END $$;
