-- Additive attribution overlays: original muster facts and work audit never change.
CREATE TABLE eoms.mapping_execution_authority(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),estate_id uuid NOT NULL REFERENCES eoms.estates(id),mapping_request_id uuid NOT NULL REFERENCES eoms.mapping_requests(id),decision_id uuid NOT NULL REFERENCES eoms.mapping_decisions(id),subject_id uuid NOT NULL REFERENCES eoms.users(id),actor_id uuid NOT NULL REFERENCES eoms.users(id),retry_key uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('apply','compensate')),action text NOT NULL CHECK(action IN ('appointed','revoked')),revision integer NOT NULL CHECK(revision>0),previous_id uuid REFERENCES eoms.mapping_execution_authority(id),scope_revision bigint NOT NULL,
 reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 3 AND 240),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(mapping_request_id,subject_id,purpose,revision),UNIQUE(estate_id,actor_id,retry_key),CHECK(actor_id<>subject_id OR action='revoked'),CHECK((revision=1)=(previous_id IS NULL))
);
CREATE TABLE eoms.mapping_overlay_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),estate_id uuid NOT NULL REFERENCES eoms.estates(id),mapping_request_id uuid NOT NULL REFERENCES eoms.mapping_requests(id),decision_id uuid NOT NULL REFERENCES eoms.mapping_decisions(id),authority_id uuid NOT NULL REFERENCES eoms.mapping_execution_authority(id),actor_id uuid NOT NULL REFERENCES eoms.users(id),retry_key uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('applied','compensated')),previous_id uuid UNIQUE REFERENCES eoms.mapping_overlay_receipts(id),reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 3 AND 240),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),examined boolean NOT NULL CHECK(examined),snapshot_sha256 text NOT NULL,rows_sha256 text NOT NULL,row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 50),quantity_ha numeric NOT NULL CHECK(quantity_ha>=0),request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(estate_id,actor_id,retry_key),CHECK((kind='applied')=(previous_id IS NULL))
);
CREATE UNIQUE INDEX mapping_overlay_one_application ON eoms.mapping_overlay_receipts(mapping_request_id) WHERE kind='applied';
CREATE TABLE eoms.mapping_overlay_rows(
 receipt_id uuid NOT NULL REFERENCES eoms.mapping_overlay_receipts(id),estate_id uuid NOT NULL REFERENCES eoms.estates(id),record_id uuid NOT NULL REFERENCES eoms.musters(id),record_version integer NOT NULL,source_row text NOT NULL,original_company_id uuid REFERENCES eoms.companies(id),adjusted_company_id uuid NOT NULL REFERENCES eoms.companies(id),adjusted_company_name text NOT NULL,quantity_ha numeric NOT NULL,PRIMARY KEY(receipt_id,record_id)
);
CREATE INDEX mapping_execution_page ON eoms.mapping_execution_authority(mapping_request_id,id);
CREATE INDEX mapping_overlay_record ON eoms.mapping_overlay_rows(estate_id,record_id);
ALTER TABLE eoms.mapping_execution_authority ENABLE ROW LEVEL SECURITY; ALTER TABLE eoms.mapping_execution_authority FORCE ROW LEVEL SECURITY;
ALTER TABLE eoms.mapping_overlay_receipts ENABLE ROW LEVEL SECURITY; ALTER TABLE eoms.mapping_overlay_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE eoms.mapping_overlay_rows ENABLE ROW LEVEL SECURITY; ALTER TABLE eoms.mapping_overlay_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY mapping_execution_read ON eoms.mapping_execution_authority FOR SELECT TO eoms_app USING(eoms.can_review_reconciliation(estate_id));
CREATE POLICY mapping_overlay_receipt_read ON eoms.mapping_overlay_receipts FOR SELECT TO eoms_app USING(eoms.can_review_reconciliation(estate_id));
CREATE POLICY mapping_overlay_row_read ON eoms.mapping_overlay_rows FOR SELECT TO eoms_app USING(eoms.can_review_reconciliation(estate_id));
CREATE TRIGGER mapping_execution_immutable BEFORE UPDATE OR DELETE ON eoms.mapping_execution_authority FOR EACH ROW EXECUTE FUNCTION eoms.reconciliation_immutable();
CREATE TRIGGER mapping_overlay_receipt_immutable BEFORE UPDATE OR DELETE ON eoms.mapping_overlay_receipts FOR EACH ROW EXECUTE FUNCTION eoms.reconciliation_immutable();
CREATE TRIGGER mapping_overlay_row_immutable BEFORE UPDATE OR DELETE ON eoms.mapping_overlay_rows FOR EACH ROW EXECUTE FUNCTION eoms.reconciliation_immutable();
GRANT SELECT ON eoms.mapping_execution_authority,eoms.mapping_overlay_receipts,eoms.mapping_overlay_rows TO eoms_app;
CREATE FUNCTION eoms.mapping_execution_state(request_ref uuid,subject uuid,purpose_ref text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE r eoms.mapping_requests;h eoms.mapping_execution_authority;eligible jsonb;
BEGIN
 SELECT * INTO r FROM eoms.mapping_requests WHERE id=request_ref;
 IF NOT FOUND OR NOT coalesce(eoms.can_review_reconciliation(r.estate_id),false) THEN RAISE EXCEPTION 'Overlay scope required' USING ERRCODE='42501'; END IF;
 eligible:=eoms.policy_authority_state(r.estate_id,subject);
 SELECT * INTO h FROM eoms.mapping_execution_authority WHERE mapping_request_id=request_ref AND subject_id=subject AND purpose=purpose_ref ORDER BY revision DESC LIMIT 1;
 RETURN jsonb_build_object('head',CASE WHEN h.id IS NULL THEN NULL ELSE to_jsonb(h) END,'eligible',(eligible->>'eligible')::boolean,'effective',coalesce(h.action='appointed' AND (eligible->>'eligible')::boolean AND h.scope_revision=eoms.policy_scope_revision(r.estate_id,subject),false));
END $$;
REVOKE ALL ON FUNCTION eoms.mapping_execution_state(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.mapping_execution_state(uuid,uuid,text) TO eoms_app;
CREATE FUNCTION eoms.appoint_mapping_executor(request_ref uuid,subject uuid,purpose_ref text,retry uuid,expected integer,result text,ref text,why text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE r eoms.mapping_requests;d eoms.mapping_decisions;h eoms.mapping_execution_authority;prior eoms.mapping_execution_authority;event eoms.mapping_execution_authority;applied eoms.mapping_overlay_receipts;state jsonb;actor uuid:=eoms.actor_id();support uuid:=nullif(current_setting('app.request_id',true),'')::uuid;
BEGIN
 SELECT * INTO r FROM eoms.mapping_requests WHERE id=request_ref;
 IF NOT FOUND OR NOT coalesce(eoms.can_review_reconciliation(r.estate_id),false) THEN RAISE EXCEPTION 'Overlay scope required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.estate_id::text,622)); PERFORM eoms.lock_policy_recording_scope(r.estate_id,actor);
 IF subject IS NULL OR purpose_ref IS NULL OR purpose_ref NOT IN ('apply','compensate') OR retry IS NULL OR support IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 2147483646 OR result IS NULL OR result NOT IN ('appointed','revoked') OR ref IS NULL OR length(trim(ref)) NOT BETWEEN 3 AND 240 OR why IS NULL OR length(trim(why)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Explicit bounded execution authorization required' USING ERRCODE='23514'; END IF;
 SELECT * INTO prior FROM eoms.mapping_execution_authority WHERE estate_id=r.estate_id AND actor_id=actor AND retry_key=retry;
 IF FOUND THEN
  IF (prior.mapping_request_id,prior.subject_id,prior.purpose,prior.revision-1,prior.action,prior.reference,prior.reason) IS DISTINCT FROM (request_ref,subject,purpose_ref,expected,result,ref,why) THEN RAISE EXCEPTION 'Execution authorization retry changed' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('authority',to_jsonb(prior),'replayed',true);
 END IF;
 SELECT * INTO h FROM eoms.mapping_execution_authority WHERE mapping_request_id=request_ref AND subject_id=subject AND purpose=purpose_ref ORDER BY revision DESC LIMIT 1;
 IF coalesce(h.revision,0)<>expected THEN RAISE EXCEPTION 'Execution authorization changed; refresh' USING ERRCODE='23505'; END IF;
 IF result='appointed' THEN
  IF subject=actor THEN RAISE EXCEPTION 'Self authorization denied' USING ERRCODE='42501'; END IF;
  PERFORM eoms.lock_policy_recording_scope(r.estate_id,subject);
  IF purpose_ref='apply' THEN
   state:=eoms.mapping_request_state(request_ref);
   IF NOT coalesce((state->>'approvalCurrent')::boolean,false) THEN RAISE EXCEPTION 'Current bound independent approval required' USING ERRCODE='23505'; END IF;
   SELECT * INTO d FROM eoms.mapping_decisions WHERE id=(state->'head'->>'id')::uuid;
   IF subject=d.actor_id THEN RAISE EXCEPTION 'Decision recorder cannot execute own approval' USING ERRCODE='42501'; END IF;
   IF EXISTS(SELECT 1 FROM eoms.mapping_overlay_receipts WHERE mapping_request_id=request_ref AND kind='applied') THEN RAISE EXCEPTION 'Request already applied; use compensation and a linked correction' USING ERRCODE='23505'; END IF;
  ELSE
   SELECT * INTO applied FROM eoms.mapping_overlay_receipts WHERE mapping_request_id=request_ref AND kind='applied';
   IF applied.id IS NULL OR EXISTS(SELECT 1 FROM eoms.mapping_overlay_receipts WHERE previous_id=applied.id) THEN RAISE EXCEPTION 'Current application required for compensation authorization' USING ERRCODE='23505'; END IF;
   IF subject=applied.actor_id THEN RAISE EXCEPTION 'Separate compensating actor required' USING ERRCODE='42501'; END IF;
   SELECT * INTO d FROM eoms.mapping_decisions WHERE id=applied.decision_id;
  END IF;
 ELSE
  IF h.id IS NULL OR h.action<>'appointed' THEN RAISE EXCEPTION 'Select an existing execution authorization to revoke' USING ERRCODE='23514'; END IF;
  SELECT * INTO d FROM eoms.mapping_decisions WHERE id=h.decision_id;
 END IF;
 INSERT INTO eoms.mapping_execution_authority(estate_id,mapping_request_id,decision_id,subject_id,actor_id,retry_key,purpose,action,revision,previous_id,scope_revision,reference,reason,request_id) VALUES(r.estate_id,r.id,d.id,subject,actor,retry,purpose_ref,result,expected+1,h.id,eoms.policy_scope_revision(r.estate_id,subject),ref,why,support) RETURNING * INTO event;
 RETURN jsonb_build_object('authority',to_jsonb(event),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION eoms.appoint_mapping_executor(uuid,uuid,text,uuid,integer,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.appoint_mapping_executor(uuid,uuid,text,uuid,integer,text,text,text) TO eoms_app;
CREATE FUNCTION eoms.execute_mapping_overlay(request_ref uuid,authority_ref uuid,retry uuid,operation text,previous uuid,ref text,why text,examined_ref boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE r eoms.mapping_requests;a eoms.mapping_execution_authority;h eoms.mapping_execution_authority;prior eoms.mapping_overlay_receipts;event eoms.mapping_overlay_receipts;applied eoms.mapping_overlay_receipts;d eoms.mapping_decisions;state jsonb;binding jsonb;rows jsonb;total numeric;n integer;actor uuid:=eoms.actor_id();support uuid:=nullif(current_setting('app.request_id',true),'')::uuid;
BEGIN
 SELECT * INTO r FROM eoms.mapping_requests WHERE id=request_ref;
 IF NOT FOUND OR NOT coalesce(eoms.can_review_reconciliation(r.estate_id),false) THEN RAISE EXCEPTION 'Overlay scope required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.estate_id::text,622)); PERFORM eoms.lock_policy_recording_scope(r.estate_id,actor);
 IF authority_ref IS NULL OR retry IS NULL OR support IS NULL OR operation IS NULL OR operation NOT IN ('apply','compensate') OR ref IS NULL OR length(trim(ref)) NOT BETWEEN 3 AND 240 OR why IS NULL OR length(trim(why)) NOT BETWEEN 3 AND 500 OR examined_ref IS DISTINCT FROM true THEN RAISE EXCEPTION 'Exact authorization attestation and bounded reference required' USING ERRCODE='23514'; END IF;
 SELECT * INTO prior FROM eoms.mapping_overlay_receipts WHERE estate_id=r.estate_id AND actor_id=actor AND retry_key=retry;
 IF FOUND THEN
  IF (prior.mapping_request_id,prior.authority_id,prior.kind,prior.previous_id,prior.reference,prior.reason,prior.examined) IS DISTINCT FROM (request_ref,authority_ref,CASE WHEN operation='apply' THEN 'applied' ELSE 'compensated' END,previous,ref,why,examined_ref) THEN RAISE EXCEPTION 'Overlay retry content changed' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('receipt',to_jsonb(prior),'replayed',true);
 END IF;
 SELECT * INTO a FROM eoms.mapping_execution_authority WHERE id=authority_ref AND mapping_request_id=request_ref AND subject_id=actor AND purpose=operation;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Explicit matching execution authorization required' USING ERRCODE='42501'; END IF;
 SELECT * INTO h FROM eoms.mapping_execution_authority WHERE mapping_request_id=request_ref AND subject_id=actor AND purpose=operation ORDER BY revision DESC LIMIT 1;
 IF h.id<>a.id OR a.action<>'appointed' OR a.scope_revision<>eoms.policy_scope_revision(r.estate_id,actor) THEN RAISE EXCEPTION 'Execution authorization no longer current' USING ERRCODE='23505'; END IF;
 IF operation='apply' THEN
  IF previous IS NOT NULL THEN RAISE EXCEPTION 'Application has no prior receipt' USING ERRCODE='23514'; END IF;
  PERFORM eoms.lock_policy_recording_scope(r.estate_id,r.created_by);
  binding:=eoms.mapping_binding(r.check_id,r.policy_id,r.acceptance_id,true);
  SELECT * INTO d FROM eoms.mapping_decisions WHERE mapping_request_id=request_ref ORDER BY revision DESC LIMIT 1;
  IF d.id IS NOT NULL THEN PERFORM eoms.lock_policy_recording_scope(r.estate_id,d.actor_id); END IF;
  state:=eoms.mapping_request_state(request_ref);
  IF NOT coalesce((state->>'approvalCurrent')::boolean,false) OR binding IS DISTINCT FROM r.snapshot OR d.id<>a.decision_id THEN RAISE EXCEPTION 'Bound approval evidence or records changed; renew review' USING ERRCODE='23505'; END IF;
  IF actor=d.actor_id THEN RAISE EXCEPTION 'Separate execution actor required' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM eoms.mapping_overlay_receipts WHERE mapping_request_id=request_ref AND kind='applied') THEN RAISE EXCEPTION 'Request already applied' USING ERRCODE='23505'; END IF;
  IF EXISTS(SELECT 1 FROM eoms.mapping_overlay_rows o JOIN eoms.mapping_overlay_receipts p ON p.id=o.receipt_id WHERE o.estate_id=r.estate_id AND o.record_id IN(SELECT (v->>'recordId')::uuid FROM jsonb_array_elements(r.snapshot->'records')v) AND NOT EXISTS(SELECT 1 FROM eoms.mapping_overlay_receipts c WHERE c.previous_id=p.id)) THEN RAISE EXCEPTION 'Record already has an active overlay; compensate first' USING ERRCODE='23505'; END IF;
  SELECT jsonb_agg(jsonb_build_object('recordId',m.id,'recordVersion',m.version,'sourceRow',v->>'sourceRow','originalCompanyId',m.legal_company_id,'adjustedCompanyId',c.id,'adjustedCompanyName',c.name,'quantityHa',m.quantity_ha) ORDER BY m.id),sum(m.quantity_ha),count(*) INTO rows,total,n FROM jsonb_array_elements(r.snapshot->'records')v JOIN eoms.musters m ON m.id=(v->>'recordId')::uuid AND m.estate_id=r.estate_id JOIN eoms.companies c ON c.id=(v->>'targetId')::uuid AND c.customer_id=(SELECT customer_id FROM eoms.estates WHERE id=r.estate_id);
  IF n<>jsonb_array_length(r.snapshot->'records') OR n NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Exact bounded overlay row set required' USING ERRCODE='23505'; END IF;
 ELSE
  SELECT * INTO applied FROM eoms.mapping_overlay_receipts WHERE id=previous AND mapping_request_id=request_ref AND kind='applied';
  IF applied.id IS NULL OR applied.decision_id<>a.decision_id OR EXISTS(SELECT 1 FROM eoms.mapping_overlay_receipts WHERE previous_id=applied.id) THEN RAISE EXCEPTION 'Exact uncompensated receipt required' USING ERRCODE='23505'; END IF;
  IF actor=applied.actor_id THEN RAISE EXCEPTION 'Separate compensating actor required' USING ERRCODE='42501'; END IF;
  SELECT * INTO d FROM eoms.mapping_decisions WHERE id=applied.decision_id;
  n:=applied.row_count;total:=applied.quantity_ha;
 END IF;
 INSERT INTO eoms.mapping_overlay_receipts(estate_id,mapping_request_id,decision_id,authority_id,actor_id,retry_key,kind,previous_id,reference,reason,examined,snapshot_sha256,rows_sha256,row_count,quantity_ha,request_id) VALUES(r.estate_id,r.id,d.id,a.id,actor,retry,CASE WHEN operation='apply' THEN 'applied' ELSE 'compensated' END,previous,ref,why,examined_ref,r.snapshot_sha256,CASE WHEN operation='apply' THEN encode(sha256(convert_to(rows::text,'UTF8')),'hex') ELSE applied.rows_sha256 END,n,total,support) RETURNING * INTO event;
 IF operation='apply' THEN
  INSERT INTO eoms.mapping_overlay_rows(receipt_id,estate_id,record_id,record_version,source_row,original_company_id,adjusted_company_id,adjusted_company_name,quantity_ha) SELECT event.id,r.estate_id,(v->>'recordId')::uuid,(v->>'recordVersion')::int,v->>'sourceRow',(v->>'originalCompanyId')::uuid,(v->>'adjustedCompanyId')::uuid,v->>'adjustedCompanyName',(v->>'quantityHa')::numeric FROM jsonb_array_elements(rows)v;
 END IF;
 RETURN jsonb_build_object('receipt',to_jsonb(event),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION eoms.execute_mapping_overlay(uuid,uuid,uuid,text,uuid,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.execute_mapping_overlay(uuid,uuid,uuid,text,uuid,text,text,boolean) TO eoms_app;
