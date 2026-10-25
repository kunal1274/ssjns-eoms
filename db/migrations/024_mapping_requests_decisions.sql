-- Immutable mapping requests and individual decisions; never apply business data.
CREATE TABLE eoms.mapping_decision_authority(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),estate_id uuid NOT NULL REFERENCES eoms.estates(id),subject_id uuid NOT NULL REFERENCES eoms.users(id),actor_id uuid NOT NULL REFERENCES eoms.users(id),retry_key uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),previous_id uuid REFERENCES eoms.mapping_decision_authority(id),scope_revision bigint NOT NULL CHECK(scope_revision>=0),
 policy_id uuid NOT NULL REFERENCES eoms.mapping_policy_versions(id),acceptance_id uuid NOT NULL REFERENCES eoms.mapping_policy_acceptance(id),action text NOT NULL CHECK(action IN ('appointed','revoked')),
 reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 3 AND 240),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(estate_id,subject_id,revision),UNIQUE(estate_id,actor_id,retry_key),CHECK((revision=1)=(previous_id IS NULL)),CHECK(action<>'appointed' OR subject_id<>actor_id)
);
CREATE TABLE eoms.mapping_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),estate_id uuid NOT NULL REFERENCES eoms.estates(id),job_id uuid NOT NULL REFERENCES eoms.reconciliation_jobs(id),check_id uuid NOT NULL REFERENCES eoms.reconciliation_evidence_checks(id),
 created_by uuid NOT NULL REFERENCES eoms.users(id),requester_scope_revision bigint NOT NULL, retry_key uuid NOT NULL,previous_id uuid REFERENCES eoms.mapping_requests(id),policy_id uuid NOT NULL REFERENCES eoms.mapping_policy_versions(id),acceptance_id uuid NOT NULL REFERENCES eoms.mapping_policy_acceptance(id),
 custody_ref text NOT NULL CHECK(length(trim(custody_ref)) BETWEEN 3 AND 240),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),manifest_sha256 text NOT NULL,snapshot jsonb NOT NULL,snapshot_sha256 text NOT NULL CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
 request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(estate_id,created_by,retry_key),UNIQUE(previous_id)
);
CREATE TABLE eoms.mapping_decisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),mapping_request_id uuid NOT NULL REFERENCES eoms.mapping_requests(id),estate_id uuid NOT NULL REFERENCES eoms.estates(id),actor_id uuid NOT NULL REFERENCES eoms.users(id),retry_key uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),previous_id uuid REFERENCES eoms.mapping_decisions(id),appointment_id uuid NOT NULL REFERENCES eoms.mapping_decision_authority(id),outcome text NOT NULL CHECK(outcome IN ('approved','returned','rejected','withdrawn')),
 reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 3 AND 240),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),examined boolean NOT NULL CHECK(examined),request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(mapping_request_id,revision),UNIQUE(mapping_request_id,actor_id,retry_key),CHECK((revision=1)=(previous_id IS NULL))
);
CREATE INDEX mapping_request_page ON eoms.mapping_requests(check_id,id);
CREATE INDEX mapping_decision_page ON eoms.mapping_decisions(mapping_request_id,id);
CREATE INDEX mapping_authority_page ON eoms.mapping_decision_authority(estate_id,id);
ALTER TABLE eoms.mapping_decision_authority ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoms.mapping_decision_authority FORCE ROW LEVEL SECURITY;
ALTER TABLE eoms.mapping_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoms.mapping_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE eoms.mapping_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoms.mapping_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY mapping_authority_read ON eoms.mapping_decision_authority FOR SELECT TO eoms_app USING(eoms.can_review_reconciliation(estate_id));
CREATE POLICY mapping_request_read ON eoms.mapping_requests FOR SELECT TO eoms_app USING(eoms.can_review_reconciliation(estate_id));
CREATE POLICY mapping_decision_read ON eoms.mapping_decisions FOR SELECT TO eoms_app USING(eoms.can_review_reconciliation(estate_id));
CREATE TRIGGER mapping_authority_immutable BEFORE UPDATE OR DELETE ON eoms.mapping_decision_authority FOR EACH ROW EXECUTE FUNCTION eoms.reconciliation_immutable();
CREATE TRIGGER mapping_request_immutable BEFORE UPDATE OR DELETE ON eoms.mapping_requests FOR EACH ROW EXECUTE FUNCTION eoms.reconciliation_immutable();
CREATE TRIGGER mapping_decision_immutable BEFORE UPDATE OR DELETE ON eoms.mapping_decisions FOR EACH ROW EXECUTE FUNCTION eoms.reconciliation_immutable();
GRANT SELECT ON eoms.mapping_decision_authority,eoms.mapping_requests,eoms.mapping_decisions TO eoms_app;
CREATE FUNCTION eoms.mapping_authority_state(estate uuid,subject uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE head eoms.mapping_decision_authority;eligibility jsonb;accepted jsonb;
BEGIN
 eligibility:=eoms.policy_authority_state(estate,subject);
 SELECT * INTO head FROM eoms.mapping_decision_authority WHERE estate_id=estate AND subject_id=subject ORDER BY revision DESC LIMIT 1;
 IF head.id IS NOT NULL THEN accepted:=eoms.policy_acceptance_state(head.policy_id); END IF;
 RETURN jsonb_build_object('head',CASE WHEN head.id IS NULL THEN NULL ELSE to_jsonb(head) END,'effective',coalesce(head.action='appointed' AND (eligibility->>'eligible')::boolean AND head.scope_revision=eoms.policy_scope_revision(estate,subject) AND (accepted->>'current')::boolean AND accepted->'head'->>'id'=head.acceptance_id::text,false),'recordingAllowed',coalesce(head.action='appointed' AND (eligibility->>'eligible')::boolean AND head.scope_revision=eoms.policy_scope_revision(estate,subject),false),'scope','mapping-decision-recording-only');
END $$;
REVOKE ALL ON FUNCTION eoms.mapping_authority_state(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.mapping_authority_state(uuid,uuid) TO eoms_app;
CREATE FUNCTION eoms.appoint_mapping_recorder(estate uuid,subject uuid,policy uuid,acceptance uuid,retry uuid,expected integer,result text,ref text,why text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE actor uuid:=eoms.actor_id();request uuid:=nullif(current_setting('app.request_id',true),'')::uuid;prior eoms.mapping_decision_authority;head eoms.mapping_decision_authority;event eoms.mapping_decision_authority;state jsonb;
BEGIN
 IF NOT coalesce(eoms.can_review_reconciliation(estate),false) THEN RAISE EXCEPTION 'Mapping authority scope required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(estate::text,622));PERFORM eoms.lock_policy_recording_scope(estate,actor);
 IF retry IS NULL OR request IS NULL OR subject IS NULL OR policy IS NULL OR acceptance IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 2147483646 OR result IS NULL OR result NOT IN ('appointed','revoked') OR ref IS NULL OR length(trim(ref)) NOT BETWEEN 3 AND 240 OR why IS NULL OR length(trim(why)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Bounded mapping appointment required' USING ERRCODE='23514'; END IF;
 SELECT * INTO prior FROM eoms.mapping_decision_authority WHERE estate_id=estate AND actor_id=actor AND retry_key=retry;
 IF FOUND THEN
  IF (prior.subject_id,prior.policy_id,prior.acceptance_id,prior.revision-1,prior.action,prior.reference,prior.reason) IS DISTINCT FROM(subject,policy,acceptance,expected,result,ref,why) THEN RAISE EXCEPTION 'Mapping appointment retry changed' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('appointment',to_jsonb(prior),'replayed',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM eoms.mapping_policy_versions WHERE id=policy AND estate_id=estate) THEN RAISE EXCEPTION 'Policy outside estate scope' USING ERRCODE='42501'; END IF;
 SELECT * INTO head FROM eoms.mapping_decision_authority WHERE estate_id=estate AND subject_id=subject ORDER BY revision DESC LIMIT 1;
 IF coalesce(head.revision,0)<>expected THEN RAISE EXCEPTION 'Mapping appointment revision changed' USING ERRCODE='23505'; END IF;
 IF result='appointed' THEN
  IF subject=actor THEN RAISE EXCEPTION 'Self appointment denied' USING ERRCODE='42501'; END IF;
  PERFORM eoms.lock_policy_recording_scope(estate,subject);
  state:=eoms.policy_acceptance_state(policy);
  IF NOT coalesce((state->>'current')::boolean,false) OR state->'head'->>'id'<>acceptance::text THEN RAISE EXCEPTION 'Current exact external policy acceptance required' USING ERRCODE='23514'; END IF;
 ELSE
  IF head.id IS NULL OR head.action<>'appointed' OR head.policy_id<>policy OR head.acceptance_id<>acceptance THEN RAISE EXCEPTION 'Select the exact existing appointment to revoke' USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO eoms.mapping_decision_authority(estate_id,subject_id,actor_id,retry_key,revision,previous_id,scope_revision,policy_id,acceptance_id,action,reference,reason,request_id) VALUES(estate,subject,actor,retry,expected+1,head.id,eoms.policy_scope_revision(estate,subject),policy,acceptance,result,ref,why,request) RETURNING * INTO event;
 RETURN jsonb_build_object('appointment',to_jsonb(event),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION eoms.appoint_mapping_recorder(uuid,uuid,uuid,uuid,uuid,integer,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.appoint_mapping_recorder(uuid,uuid,uuid,uuid,uuid,integer,text,text,text) TO eoms_app;
-- Fresh binding report, with optional transaction locks. Internal only.
CREATE FUNCTION eoms.mapping_binding(check_ref uuid,policy_ref uuid,acceptance_ref uuid,locked boolean) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE evidence eoms.reconciliation_evidence_checks;j eoms.reconciliation_jobs;p eoms.mapping_policy_versions;acceptance jsonb;reviewers jsonb;records jsonb;totals jsonb;estate_active boolean;valid boolean;person record;
BEGIN
 SELECT * INTO evidence FROM eoms.reconciliation_evidence_checks WHERE id=check_ref;
 IF NOT FOUND OR NOT coalesce(eoms.can_review_reconciliation(evidence.estate_id),false) THEN RAISE EXCEPTION 'Mapping request scope required' USING ERRCODE='42501'; END IF;
 IF locked THEN PERFORM pg_advisory_xact_lock(hashtextextended(evidence.estate_id::text,622));PERFORM eoms.lock_policy_recording_scope(evidence.estate_id,eoms.actor_id()); END IF;
 SELECT * INTO j FROM eoms.reconciliation_jobs WHERE id=evidence.job_id;
 SELECT * INTO p FROM eoms.mapping_policy_versions WHERE id=policy_ref AND estate_id=evidence.estate_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Selected policy is unavailable in estate scope' USING ERRCODE='42501'; END IF;
 acceptance:=eoms.policy_acceptance_state(policy_ref);
 IF locked THEN
  IF coalesce((acceptance->>'current')::boolean,false) THEN PERFORM eoms.lock_policy_recording_scope(evidence.estate_id,(acceptance->'head'->>'actor_id')::uuid); END IF;
  acceptance:=eoms.policy_acceptance_state(policy_ref);
  PERFORM id FROM eoms.estates WHERE id=evidence.estate_id FOR SHARE;
  PERFORM m.id FROM eoms.musters m WHERE m.estate_id=evidence.estate_id AND m.id IN(SELECT (r->>'recordId')::uuid FROM jsonb_array_elements(j.manifest->'rows')r WHERE r->>'kind'='work-company') ORDER BY m.id FOR SHARE;
  PERFORM c.id FROM eoms.companies c WHERE c.customer_id=(SELECT customer_id FROM eoms.estates WHERE id=evidence.estate_id) AND c.id IN(SELECT (r->>'targetId')::uuid FROM jsonb_array_elements(j.manifest->'rows')r) ORDER BY c.id FOR SHARE;
 END IF;
 SELECT active INTO estate_active FROM eoms.estates WHERE id=evidence.estate_id;
 SELECT jsonb_agg(jsonb_build_object('sourceRow',r->>'sourceRow','kind',r->>'kind','recordId',r->>'recordId','recordVersion',(r->>'recordVersion')::integer,'targetId',r->>'targetId','currentVersion',m.version,'currentStatus',m.status,'recordedCompany',m.legal_company_id,'targetName',c.name,'valid',r->>'kind'='work-company' AND m.id IS NOT NULL AND m.version=(r->>'recordVersion')::integer AND m.legal_company_id IS NULL AND c.id IS NOT NULL) ORDER BY ord) INTO records
 FROM jsonb_array_elements(j.manifest->'rows') WITH ORDINALITY r(r,ord) LEFT JOIN eoms.musters m ON m.estate_id=evidence.estate_id AND m.id=(r->>'recordId')::uuid LEFT JOIN eoms.companies c ON c.customer_id=(SELECT customer_id FROM eoms.estates WHERE id=evidence.estate_id) AND c.id=(r->>'targetId')::uuid;

 totals:=eoms.source_readiness_observations(check_ref);
 IF locked AND (totals->>'authorizationChanged')::int=0 THEN
  FOR person IN SELECT DISTINCT reviewer_id FROM eoms.source_provenance_reviews WHERE evidence_id=check_ref ORDER BY reviewer_id LOOP PERFORM eoms.lock_policy_recording_scope(evidence.estate_id,person.reviewer_id);END LOOP;
 END IF;
 SELECT jsonb_agg(jsonb_build_object('id',r.id,'reviewerId',r.reviewer_id,'revision',r.revision,'outcome',r.outcome,'scopeRevision',eoms.policy_scope_revision(evidence.estate_id,r.reviewer_id)) ORDER BY r.reviewer_id) INTO reviewers FROM(SELECT DISTINCT ON(reviewer_id) * FROM eoms.source_provenance_reviews WHERE evidence_id=check_ref ORDER BY reviewer_id,revision DESC)r;
 totals:=eoms.source_readiness_observations(check_ref);
 valid:=coalesce(jsonb_array_length(j.manifest->'rows') BETWEEN 1 AND 50 AND estate_active AND evidence.matches_declared AND (acceptance->>'current')::boolean AND acceptance->'head'->>'id'=acceptance_ref::text AND (totals->>'authorizedCorroborated')::int>0 AND (totals->>'authorizationChanged')::int=0 AND (totals->>'concerns')::int=0 AND (totals->>'insufficient')::int=0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(records)r WHERE (r->>'valid')::boolean IS DISTINCT FROM true) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(j.manifest->'rows')r GROUP BY r->>'recordId' HAVING count(*)>1) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(j.manifest->'rows')r GROUP BY r->>'sourceRow' HAVING count(*)>1),false);
 RETURN jsonb_build_object('estateId',evidence.estate_id,'jobId',j.id,'jobCreator',j.created_by,'checkId',evidence.id,'uploaderId',evidence.actor_id,'sourceSha256',evidence.computed_sha256,'manifestSha256',j.manifest_sha256,'policyId',p.id,'policySha256',p.sha256,'acceptanceId',acceptance_ref,'acceptanceCurrent',coalesce((acceptance->>'current')::boolean AND acceptance->'head'->>'id'=acceptance_ref::text,false),'estateActive',estate_active,'sourceMatches',evidence.matches_declared,'records',coalesce(records,'[]'::jsonb),'observations',coalesce(reviewers,'[]'::jsonb),'observationTotals',totals-'items','eligible',valid,'sourceAuthenticityVerified',false,'applicationEnabled',false);
END $$;
REVOKE ALL ON FUNCTION eoms.mapping_binding(uuid,uuid,uuid,boolean) FROM PUBLIC;
CREATE FUNCTION eoms.inspect_mapping_binding(check_ref uuid,policy_ref uuid,acceptance_ref uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$ SELECT eoms.mapping_binding(check_ref,policy_ref,acceptance_ref,false) $$;
REVOKE ALL ON FUNCTION eoms.inspect_mapping_binding(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.inspect_mapping_binding(uuid,uuid,uuid) TO eoms_app;
CREATE FUNCTION eoms.submit_mapping_request(check_ref uuid,policy_ref uuid,acceptance_ref uuid,retry uuid,previous uuid,custody text,why text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE actor uuid:=eoms.actor_id();request uuid:=nullif(current_setting('app.request_id',true),'')::uuid;estate uuid;evidence eoms.reconciliation_evidence_checks;prior eoms.mapping_requests;parent eoms.mapping_requests;event eoms.mapping_requests;decision eoms.mapping_decisions;binding jsonb;
BEGIN
 SELECT * INTO evidence FROM eoms.reconciliation_evidence_checks WHERE id=check_ref;estate:=evidence.estate_id;
 IF NOT FOUND OR NOT coalesce(eoms.can_review_reconciliation(estate),false) THEN RAISE EXCEPTION 'Mapping request scope required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(estate::text,622));PERFORM eoms.lock_policy_recording_scope(estate,actor);
 IF retry IS NULL OR request IS NULL OR policy_ref IS NULL OR acceptance_ref IS NULL OR custody IS NULL OR length(trim(custody)) NOT BETWEEN 3 AND 240 OR why IS NULL OR length(trim(why)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Exact policy and controlled custody reference required' USING ERRCODE='23514'; END IF;
 SELECT * INTO prior FROM eoms.mapping_requests WHERE estate_id=estate AND created_by=actor AND retry_key=retry;
 IF FOUND THEN
  IF (prior.check_id,prior.policy_id,prior.acceptance_id,prior.previous_id,prior.custody_ref,prior.reason) IS DISTINCT FROM(check_ref,policy_ref,acceptance_ref,previous,custody,why) THEN RAISE EXCEPTION 'Mapping request retry changed' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('mappingRequest',to_jsonb(prior),'replayed',true);
 END IF;
 IF previous IS NOT NULL THEN
  SELECT * INTO parent FROM eoms.mapping_requests WHERE id=previous AND estate_id=estate AND created_by=actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Correction parent outside request ownership' USING ERRCODE='42501'; END IF;
  SELECT * INTO decision FROM eoms.mapping_decisions WHERE mapping_request_id=previous ORDER BY revision DESC LIMIT 1;
  IF decision.outcome IS NULL OR decision.outcome NOT IN ('returned','withdrawn') THEN RAISE EXCEPTION 'Only a returned or withdrawn request can have a linked correction' USING ERRCODE='23514'; END IF;
 END IF;
 binding:=eoms.mapping_binding(check_ref,policy_ref,acceptance_ref,true);
 IF NOT coalesce((binding->>'eligible')::boolean,false) THEN RAISE EXCEPTION 'Resolve current policy source mapping and reviewer findings before submission' USING ERRCODE='23514'; END IF;
 INSERT INTO eoms.mapping_requests(estate_id,job_id,check_id,created_by,requester_scope_revision,retry_key,previous_id,policy_id,acceptance_id,custody_ref,reason,manifest_sha256,snapshot,snapshot_sha256,request_id)
 VALUES(estate,evidence.job_id,check_ref,actor,eoms.policy_scope_revision(estate,actor),retry,previous,policy_ref,acceptance_ref,custody,why,binding->>'manifestSha256',binding,encode(public.digest(convert_to(binding::text,'UTF8'),'sha256'),'hex'),request) RETURNING * INTO event;
 RETURN jsonb_build_object('mappingRequest',to_jsonb(event),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION eoms.submit_mapping_request(uuid,uuid,uuid,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.submit_mapping_request(uuid,uuid,uuid,uuid,uuid,text,text) TO eoms_app;
CREATE FUNCTION eoms.mapping_request_state(request_ref uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE r eoms.mapping_requests;head eoms.mapping_decisions;binding jsonb;authority jsonb;author jsonb;independent boolean;
BEGIN
 SELECT * INTO r FROM eoms.mapping_requests WHERE id=request_ref;
 IF NOT FOUND OR NOT coalesce(eoms.can_review_reconciliation(r.estate_id),false) THEN RAISE EXCEPTION 'Mapping request scope required' USING ERRCODE='42501'; END IF;
 binding:=eoms.mapping_binding(r.check_id,r.policy_id,r.acceptance_id,false);
 author:=eoms.policy_authority_state(r.estate_id,r.created_by);
 SELECT * INTO head FROM eoms.mapping_decisions WHERE mapping_request_id=request_ref ORDER BY revision DESC LIMIT 1;
 IF head.id IS NOT NULL THEN authority:=eoms.mapping_authority_state(r.estate_id,head.actor_id); END IF;
 independent:=eoms.actor_id()<>r.created_by AND eoms.actor_id()<>(r.snapshot->>'jobCreator')::uuid AND eoms.actor_id()<>(r.snapshot->>'uploaderId')::uuid AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.snapshot->'observations')o WHERE o->>'reviewerId'=eoms.actor_id()::text);
 RETURN jsonb_build_object('head',CASE WHEN head.id IS NULL THEN NULL ELSE to_jsonb(head) END,'current',binding,'bindingUnchanged',binding=r.snapshot,'requesterScopeCurrent',coalesce((author->>'eligible')::boolean AND r.requester_scope_revision=eoms.policy_scope_revision(r.estate_id,r.created_by),false),'independent',independent,'approvalCurrent',coalesce(head.outcome='approved' AND (authority->>'effective')::boolean AND authority->'head'->>'id'=head.appointment_id::text AND binding=r.snapshot AND (binding->>'eligible')::boolean AND (author->>'eligible')::boolean AND r.requester_scope_revision=eoms.policy_scope_revision(r.estate_id,r.created_by),false),'applicationEnabled',false);
END $$;
REVOKE ALL ON FUNCTION eoms.mapping_request_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.mapping_request_state(uuid) TO eoms_app;
CREATE FUNCTION eoms.record_mapping_decision(request_ref uuid,retry uuid,expected integer,appointment_ref uuid,result text,ref text,why text,examined boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE actor uuid:=eoms.actor_id();request uuid:=nullif(current_setting('app.request_id',true),'')::uuid;r eoms.mapping_requests;prior eoms.mapping_decisions;head eoms.mapping_decisions;event eoms.mapping_decisions;authority jsonb;binding jsonb;
BEGIN
 SELECT * INTO r FROM eoms.mapping_requests WHERE id=request_ref;
 IF NOT FOUND OR NOT coalesce(eoms.can_review_reconciliation(r.estate_id),false) THEN RAISE EXCEPTION 'Mapping decision scope required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.estate_id::text,622));PERFORM eoms.lock_policy_recording_scope(r.estate_id,actor);
 IF retry IS NULL OR request IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 2147483646 OR appointment_ref IS NULL OR result IS NULL OR result NOT IN ('approved','returned','rejected','withdrawn') OR ref IS NULL OR length(trim(ref)) NOT BETWEEN 3 AND 240 OR why IS NULL OR length(trim(why)) NOT BETWEEN 3 AND 500 OR examined IS DISTINCT FROM true THEN RAISE EXCEPTION 'Exact appointment reviewed identities and bounded decision required' USING ERRCODE='23514'; END IF;
 SELECT * INTO prior FROM eoms.mapping_decisions WHERE mapping_request_id=request_ref AND actor_id=actor AND retry_key=retry;
 IF FOUND THEN
  IF (prior.revision-1,prior.appointment_id,prior.outcome,prior.reference,prior.reason,prior.examined) IS DISTINCT FROM(expected,appointment_ref,result,ref,why,examined) THEN RAISE EXCEPTION 'Mapping decision retry changed' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('decision',to_jsonb(prior),'replayed',true);
 END IF;
 IF actor=r.created_by OR actor=(r.snapshot->>'jobCreator')::uuid OR actor=(r.snapshot->>'uploaderId')::uuid OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.snapshot->'observations')o WHERE o->>'reviewerId'=actor::text) THEN RAISE EXCEPTION 'Independent mapping decision recorder required' USING ERRCODE='42501'; END IF;
 authority:=eoms.mapping_authority_state(r.estate_id,actor);
 IF NOT coalesce((authority->>'recordingAllowed')::boolean,false) THEN RAISE EXCEPTION 'Explicit current mapping decision appointment required' USING ERRCODE='42501'; END IF;
 IF authority->'head'->>'id'<>appointment_ref::text OR authority->'head'->>'policy_id'<>r.policy_id::text OR authority->'head'->>'acceptance_id'<>r.acceptance_id::text THEN RAISE EXCEPTION 'Appointment binding changed; refresh' USING ERRCODE='23505'; END IF;
 SELECT * INTO head FROM eoms.mapping_decisions WHERE mapping_request_id=request_ref ORDER BY revision DESC LIMIT 1;
 IF coalesce(head.revision,0)<>expected THEN RAISE EXCEPTION 'Decision revision changed; refresh' USING ERRCODE='23505'; END IF;
 IF head.id IS NOT NULL THEN
  IF result<>'withdrawn' OR head.outcome<>'approved' THEN RAISE EXCEPTION 'Submitted request already has a terminal decision; use a linked correction' USING ERRCODE='23514'; END IF;
 ELSIF result='withdrawn' THEN RAISE EXCEPTION 'Only a recorded approval can be withdrawn' USING ERRCODE='23514'; END IF;
 IF result='approved' THEN
  IF NOT coalesce((authority->>'effective')::boolean,false) THEN RAISE EXCEPTION 'Current exact accepted policy required for approval' USING ERRCODE='23505'; END IF;
  PERFORM eoms.lock_policy_recording_scope(r.estate_id,r.created_by);
  IF r.requester_scope_revision<>eoms.policy_scope_revision(r.estate_id,r.created_by) THEN RAISE EXCEPTION 'Requester scope changed; renew request' USING ERRCODE='23505'; END IF;
  binding:=eoms.mapping_binding(r.check_id,r.policy_id,r.acceptance_id,true);
  IF binding IS DISTINCT FROM r.snapshot OR NOT coalesce((binding->>'eligible')::boolean,false) THEN RAISE EXCEPTION 'Bound records policy or observations changed; return for correction' USING ERRCODE='23505'; END IF;
 END IF;
 INSERT INTO eoms.mapping_decisions(mapping_request_id,estate_id,actor_id,retry_key,revision,previous_id,appointment_id,outcome,reference,reason,examined,request_id) VALUES(request_ref,r.estate_id,actor,retry,expected+1,head.id,appointment_ref,result,ref,why,examined,request) RETURNING * INTO event;
 RETURN jsonb_build_object('decision',to_jsonb(event),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION eoms.record_mapping_decision(uuid,uuid,integer,uuid,text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.record_mapping_decision(uuid,uuid,integer,uuid,text,text,text,boolean) TO eoms_app;

-- Serialize new provenance observations against mapping submission and decision revalidation.
CREATE OR REPLACE FUNCTION eoms.record_source_review(check_id uuid,retry uuid,expected integer,result text,examined boolean,reference text,why text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE evidence eoms.reconciliation_evidence_checks;j eoms.reconciliation_jobs;
 prior eoms.source_provenance_reviews;head eoms.source_provenance_reviews;event eoms.source_provenance_reviews;
 actor uuid:=eoms.actor_id();request uuid:=nullif(current_setting('app.request_id',true),'')::uuid;
BEGIN
 SELECT * INTO evidence FROM eoms.reconciliation_evidence_checks WHERE id=check_id;
 IF NOT FOUND OR NOT eoms.can_review_reconciliation(evidence.estate_id) THEN RAISE EXCEPTION 'Source review access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM eoms.reconciliation_jobs WHERE id=evidence.job_id;
 IF actor=j.created_by OR actor=evidence.actor_id THEN RAISE EXCEPTION 'Independent reviewer required; preparer and uploader cannot review their own evidence' USING ERRCODE='42501'; END IF;
 IF actor IS NULL OR request IS NULL OR retry IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 2147483646 OR result IS NULL OR result NOT IN ('corroborated','concerns','insufficient') OR examined IS NULL OR reference IS NULL OR length(trim(reference)) NOT BETWEEN 3 AND 240 OR why IS NULL OR length(trim(why)) NOT BETWEEN 3 AND 500 THEN
  RAISE EXCEPTION 'Bounded source-review content and provenance required' USING ERRCODE='23514';
 END IF;
 IF result='corroborated' AND (NOT examined OR NOT evidence.matches_declared) THEN RAISE EXCEPTION 'Corroboration requires examined original and matching source bytes' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(evidence.estate_id::text,622));
 PERFORM eoms.lock_policy_recording_scope(evidence.estate_id,actor);
 PERFORM pg_advisory_xact_lock(hashtextextended(check_id::text||actor::text,620));
 SELECT * INTO prior FROM eoms.source_provenance_reviews WHERE evidence_id=check_id AND reviewer_id=actor AND retry_key=retry;
 IF FOUND THEN
  IF (prior.revision-1,prior.outcome,prior.original_examined,prior.source_ref,prior.reason) IS DISTINCT FROM (expected,result,examined,reference,why) THEN RAISE EXCEPTION 'Source review reference already used for different content' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('review',to_jsonb(prior),'replayed',true);
 END IF;
 SELECT * INTO head FROM eoms.source_provenance_reviews WHERE evidence_id=check_id AND reviewer_id=actor ORDER BY revision DESC LIMIT 1;
 IF coalesce(head.revision,0)<>expected THEN RAISE EXCEPTION 'Your review revision changed; refresh before recording a correction' USING ERRCODE='23505'; END IF;
 INSERT INTO eoms.source_provenance_reviews(evidence_id,job_id,estate_id,reviewer_id,retry_key,revision,previous_id,outcome,original_examined,source_ref,reason,request_id,evidence_sha256,manifest_sha256)
 VALUES(check_id,evidence.job_id,evidence.estate_id,actor,retry,expected+1,head.id,result,examined,reference,why,request,evidence.computed_sha256,j.manifest_sha256) RETURNING * INTO event;
 RETURN jsonb_build_object('review',to_jsonb(event),'replayed',false);
END $$;
