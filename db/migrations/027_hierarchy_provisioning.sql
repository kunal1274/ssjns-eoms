-- Narrow provisioning capability; grants never imply tenant operational readership.
ALTER TABLE eoms.companies ADD COLUMN code text CHECK(code IS NULL OR code ~ '^[A-Z0-9][A-Z0-9_-]{0,29}$');
CREATE UNIQUE INDEX company_customer_code ON eoms.companies(customer_id,code) WHERE code IS NOT NULL;
CREATE TABLE eoms.platform_bootstrap_authority(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,subject_id uuid NOT NULL REFERENCES eoms.users(id),action text NOT NULL CHECK(action IN ('granted','revoked')),user_scope_revision bigint NOT NULL,reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 3 AND 240),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX platform_bootstrap_subject ON eoms.platform_bootstrap_authority(subject_id,id DESC);
ALTER TABLE eoms.platform_bootstrap_authority ENABLE ROW LEVEL SECURITY; ALTER TABLE eoms.platform_bootstrap_authority FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_bootstrap_self ON eoms.platform_bootstrap_authority FOR SELECT TO eoms_app USING(subject_id=eoms.actor_id());
CREATE TRIGGER platform_bootstrap_immutable BEFORE UPDATE OR DELETE ON eoms.platform_bootstrap_authority FOR EACH ROW EXECUTE FUNCTION eoms.reconciliation_immutable();
GRANT SELECT ON eoms.platform_bootstrap_authority TO eoms_app;
CREATE FUNCTION eoms.can_bootstrap_customer() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
 SELECT coalesce((SELECT h.action='granted' AND h.user_scope_revision=(SELECT coalesce(max(id),0) FROM eoms.mapping_policy_scope_events WHERE subject_id=eoms.actor_id() AND kind='user-active') AND EXISTS(SELECT 1 FROM eoms.users WHERE id=eoms.actor_id() AND active) FROM eoms.platform_bootstrap_authority h WHERE h.subject_id=eoms.actor_id() ORDER BY h.id DESC LIMIT 1),false)
$$;
REVOKE ALL ON FUNCTION eoms.can_bootstrap_customer() FROM PUBLIC; GRANT EXECUTE ON FUNCTION eoms.can_bootstrap_customer() TO eoms_app;
CREATE TABLE eoms.hierarchy_provision_receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES eoms.customers(id),actor_id uuid NOT NULL REFERENCES eoms.users(id),retry_key uuid NOT NULL,operation text NOT NULL CHECK(operation IN ('customer','company','estate')),payload jsonb NOT NULL,result jsonb NOT NULL,request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(actor_id,retry_key));
ALTER TABLE eoms.hierarchy_provision_receipts ENABLE ROW LEVEL SECURITY; ALTER TABLE eoms.hierarchy_provision_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY provision_receipt_read ON eoms.hierarchy_provision_receipts FOR SELECT TO eoms_app USING(actor_id=eoms.actor_id() OR eoms.can_manage_customer(customer_id));
CREATE TRIGGER provision_receipt_immutable BEFORE UPDATE OR DELETE ON eoms.hierarchy_provision_receipts FOR EACH ROW EXECUTE FUNCTION eoms.reconciliation_immutable();
GRANT SELECT ON eoms.hierarchy_provision_receipts TO eoms_app;
CREATE POLICY company_setup_metadata_read ON eoms.companies FOR SELECT TO eoms_app USING(eoms.can_manage_customer(customer_id));
CREATE FUNCTION eoms.provision_hierarchy(operation_ref text,input jsonb,retry uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE actor uuid:=eoms.actor_id();support uuid:=nullif(current_setting('app.request_id',true),'')::uuid;tenant uuid;company uuid;estate uuid;initial_admin uuid;receipt eoms.hierarchy_provision_receipts;prior eoms.hierarchy_provision_receipts;result jsonb;allowed text[];key text;who uuid;
BEGIN
 IF actor IS NULL OR retry IS NULL OR support IS NULL OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR operation_ref IS NULL OR operation_ref NOT IN ('customer','company','estate') THEN RAISE EXCEPTION 'Explicit bounded provisioning request required' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,624));
 PERFORM id FROM eoms.users WHERE id=actor AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active provisioning actor required' USING ERRCODE='42501'; END IF;
 IF operation_ref='customer' THEN
  IF NOT eoms.can_bootstrap_customer() THEN RAISE EXCEPTION 'Explicit platform bootstrap authority required' USING ERRCODE='42501'; END IF;
  allowed:=ARRAY['customerCode','customerName','companyCode','companyName','estateCode','estateName','initialAdminId','reference','reason'];
 ELSE
  tenant:=(input->>'customerId')::uuid;
  PERFORM u.id FROM eoms.organization_admins a JOIN eoms.users u ON u.id=a.user_id WHERE a.customer_id=tenant AND a.user_id=actor AND u.active FOR SHARE OF a,u;
  IF NOT FOUND THEN RAISE EXCEPTION 'Explicit customer setup authority required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text,625));
  allowed:=CASE WHEN operation_ref='company' THEN ARRAY['customerId','companyCode','companyName','reference','reason'] ELSE ARRAY['customerId','companyId','estateCode','estateName','initialManagerId','reference','reason'] END;
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(input)k WHERE NOT k=ANY(allowed)) OR NOT input ?& allowed THEN RAISE EXCEPTION 'Exact provisioning fields required' USING ERRCODE='23514'; END IF;
 FOREACH key IN ARRAY allowed LOOP
  IF jsonb_typeof(input->key) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Provisioning fields must be explicit strings' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF length(trim(input->>'reference')) NOT BETWEEN 3 AND 240 OR length(trim(input->>'reason')) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Bounded authority reference and reason required' USING ERRCODE='23514'; END IF;
 FOREACH key IN ARRAY ARRAY['customerCode','companyCode','estateCode'] LOOP
  IF input ? key AND (input->>key !~ '^[A-Z0-9][A-Z0-9_-]{0,29}$') THEN RAISE EXCEPTION 'Canonical bounded business code required' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOREACH key IN ARRAY ARRAY['customerName','companyName','estateName'] LOOP
  IF input ? key AND length(trim(input->>key)) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Bounded display name required' USING ERRCODE='23514'; END IF;
 END LOOP;
 SELECT * INTO prior FROM eoms.hierarchy_provision_receipts WHERE actor_id=actor AND retry_key=retry;
 IF FOUND THEN
  IF (prior.operation,prior.payload) IS DISTINCT FROM(operation_ref,input) THEN RAISE EXCEPTION 'Provisioning retry content changed' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('receipt',to_jsonb(prior),'replayed',true);
 END IF;
 PERFORM set_config('app.change_reason',input->>'reason',true);
 IF operation_ref='customer' THEN
  initial_admin:=(input->>'initialAdminId')::uuid;
  PERFORM id FROM eoms.users WHERE id=initial_admin AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Named active initial administrator required' USING ERRCODE='23514'; END IF;
  INSERT INTO eoms.customers(code,name) VALUES(input->>'customerCode',input->>'customerName') RETURNING id INTO tenant;
  INSERT INTO eoms.companies(customer_id,code,name) VALUES(tenant,input->>'companyCode',input->>'companyName') RETURNING id INTO company;
  INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES(tenant,company,input->>'estateCode',input->>'estateName') RETURNING id INTO estate;
  INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES(tenant,initial_admin);
  INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES(initial_admin,estate,'manager');
  result:=jsonb_build_object('customerId',tenant,'companyId',company,'estateId',estate,'initialAdminId',initial_admin,'bootstrapperGrantedAccess',initial_admin=actor,'inheritance','none');
 ELSIF operation_ref='company' THEN
  INSERT INTO eoms.companies(customer_id,code,name) VALUES(tenant,input->>'companyCode',input->>'companyName') RETURNING id INTO company;
  result:=jsonb_build_object('customerId',tenant,'companyId',company,'inheritance','none');
 ELSE
  company:=(input->>'companyId')::uuid;initial_admin:=(input->>'initialManagerId')::uuid;
  PERFORM id FROM eoms.companies WHERE id=company AND customer_id=tenant FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Company outside customer scope' USING ERRCODE='42501'; END IF;
  PERFORM u.id FROM eoms.organization_admins a JOIN eoms.users u ON u.id=a.user_id WHERE a.customer_id=tenant AND u.id=initial_admin AND a.user_id=u.id AND u.active FOR SHARE OF a,u;
  IF NOT FOUND THEN RAISE EXCEPTION 'Named active customer setup manager required' USING ERRCODE='23514'; END IF;
  INSERT INTO eoms.estates(customer_id,company_id,code,name) VALUES(tenant,company,input->>'estateCode',input->>'estateName') RETURNING id INTO estate;
  INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES(initial_admin,estate,'manager');
  result:=jsonb_build_object('customerId',tenant,'companyId',company,'estateId',estate,'initialManagerId',initial_admin,'creatorGrantedAccess',initial_admin=actor,'inheritance','none');
 END IF;
 INSERT INTO eoms.hierarchy_provision_receipts(customer_id,actor_id,retry_key,operation,payload,result,request_id) VALUES(tenant,actor,retry,operation_ref,input,result,support) RETURNING * INTO receipt;
 RETURN jsonb_build_object('receipt',to_jsonb(receipt),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION eoms.provision_hierarchy(text,jsonb,uuid) FROM PUBLIC; GRANT EXECUTE ON FUNCTION eoms.provision_hierarchy(text,jsonb,uuid) TO eoms_app;
