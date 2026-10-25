-- Preserve blocked proposal inspection for positive integer versions beyond the stored work version range.
-- Existing snapshots and original work are unchanged. Guard bounds before row/target joins.
CREATE OR REPLACE FUNCTION eoms.mapping_binding(check_ref uuid,policy_ref uuid,acceptance_ref uuid,locked boolean) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE evidence eoms.reconciliation_evidence_checks;j eoms.reconciliation_jobs;p eoms.mapping_policy_versions;acceptance jsonb;reviewers jsonb;records jsonb;totals jsonb;estate_active boolean;valid boolean;person record;
BEGIN
 SELECT * INTO evidence FROM eoms.reconciliation_evidence_checks WHERE id=check_ref;
 IF NOT FOUND OR NOT coalesce(eoms.can_review_reconciliation(evidence.estate_id),false) THEN RAISE EXCEPTION 'Mapping request scope required' USING ERRCODE='42501'; END IF;
 IF locked THEN PERFORM pg_advisory_xact_lock(hashtextextended(evidence.estate_id::text,622));PERFORM eoms.lock_policy_recording_scope(evidence.estate_id,eoms.actor_id()); END IF;
 SELECT * INTO j FROM eoms.reconciliation_jobs WHERE id=evidence.job_id;
 IF jsonb_typeof(j.manifest->'rows') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Bounded normalized mapping rows required' USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(j.manifest->'rows') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Bounded normalized mapping rows required' USING ERRCODE='23514'; END IF;
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
 SELECT jsonb_agg(jsonb_build_object('sourceRow',r->>'sourceRow','kind',r->>'kind','recordId',r->>'recordId','recordVersion',(r->>'recordVersion')::numeric,'targetId',r->>'targetId','currentVersion',m.version,'currentStatus',m.status,'recordedCompany',m.legal_company_id,'targetName',c.name,'valid',r->>'kind'='work-company' AND m.id IS NOT NULL AND m.version=(r->>'recordVersion')::numeric AND m.legal_company_id IS NULL AND c.id IS NOT NULL) ORDER BY ord) INTO records
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
