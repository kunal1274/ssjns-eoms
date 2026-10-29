ALTER TABLE eoms.hierarchy_provision_receipts DROP CONSTRAINT hierarchy_provision_receipts_operation_check;
ALTER TABLE eoms.hierarchy_provision_receipts ADD CONSTRAINT hierarchy_provision_receipts_operation_check CHECK(operation IN ('customer','company','estate','setup-grant'));
CREATE FUNCTION eoms.set_customer_setup(customer uuid,subject uuid,result text,expected boolean,retry uuid,ref text,why text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE actor uuid:=eoms.actor_id();support uuid:=nullif(current_setting('app.request_id',true),'')::uuid;prior eoms.hierarchy_provision_receipts;event eoms.hierarchy_provision_receipts;payload jsonb;present boolean;
BEGIN
 IF NOT coalesce(eoms.can_manage_customer(customer),false) THEN RAISE EXCEPTION 'Current explicit customer setup authority required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,624));PERFORM pg_advisory_xact_lock(hashtextextended(customer::text,625));
 PERFORM a.user_id FROM eoms.organization_admins a JOIN eoms.users u ON u.id=a.user_id WHERE a.customer_id=customer AND a.user_id=actor AND u.active FOR SHARE OF a,u;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active setup administrator required' USING ERRCODE='42501'; END IF;
 IF subject IS NULL OR result IS NULL OR result NOT IN ('granted','revoked') OR expected IS NULL OR retry IS NULL OR support IS NULL OR ref IS NULL OR length(trim(ref)) NOT BETWEEN 3 AND 240 OR why IS NULL OR length(trim(why)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Explicit bounded setup handover required' USING ERRCODE='23514'; END IF;
 IF subject=actor THEN RAISE EXCEPTION 'Ask a separate setup administrator to change your own setup authority' USING ERRCODE='42501'; END IF;
 payload:=jsonb_build_object('customerId',customer,'subjectId',subject,'action',result,'expectedGranted',expected,'reference',ref,'reason',why);
 SELECT * INTO prior FROM eoms.hierarchy_provision_receipts WHERE actor_id=actor AND retry_key=retry;
 IF FOUND THEN
  IF prior.operation<>'setup-grant' OR prior.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Setup handover retry changed' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('receipt',to_jsonb(prior),'replayed',true);
 END IF;
 SELECT EXISTS(SELECT 1 FROM eoms.organization_admins WHERE customer_id=customer AND user_id=subject) INTO present;
 IF present<>expected THEN RAISE EXCEPTION 'Setup assignment changed; refresh' USING ERRCODE='23505'; END IF;
 IF present=(result='granted') THEN RAISE EXCEPTION 'Choose a change to the current setup assignment' USING ERRCODE='23514'; END IF;
 PERFORM id FROM eoms.users WHERE id=subject AND (active OR result='revoked') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Named active recipient required for setup authority' USING ERRCODE='23514'; END IF;
 IF result='revoked' AND NOT EXISTS(SELECT 1 FROM eoms.organization_admins a JOIN eoms.users u ON u.id=a.user_id WHERE a.customer_id=customer AND a.user_id<>subject AND u.active) THEN RAISE EXCEPTION 'Retain another active setup administrator before revocation' USING ERRCODE='23514'; END IF;
 PERFORM set_config('app.change_reason',why,true);
 IF result='granted' THEN INSERT INTO eoms.organization_admins(customer_id,user_id) VALUES(customer,subject); ELSE DELETE FROM eoms.organization_admins WHERE customer_id=customer AND user_id=subject; END IF;
 INSERT INTO eoms.hierarchy_provision_receipts(customer_id,actor_id,retry_key,operation,payload,result,request_id) VALUES(customer,actor,retry,'setup-grant',payload,jsonb_build_object('customerId',customer,'subjectId',subject,'action',result,'workAccessGranted',false),support) RETURNING * INTO event;
 RETURN jsonb_build_object('receipt',to_jsonb(event),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION eoms.set_customer_setup(uuid,uuid,text,boolean,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.set_customer_setup(uuid,uuid,text,boolean,uuid,text,text) TO eoms_app;
CREATE FUNCTION eoms.customer_setup_subject(customer uuid,subject uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
BEGIN
 IF NOT coalesce(eoms.can_manage_customer(customer),false) OR NOT EXISTS(SELECT 1 FROM eoms.users WHERE id=eoms.actor_id() AND active) THEN RAISE EXCEPTION 'Current setup administrator required' USING ERRCODE='42501'; END IF;
 RETURN EXISTS(SELECT 1 FROM eoms.organization_admins WHERE customer_id=customer AND user_id=subject);
END $$;
REVOKE ALL ON FUNCTION eoms.customer_setup_subject(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.customer_setup_subject(uuid,uuid) TO eoms_app;
