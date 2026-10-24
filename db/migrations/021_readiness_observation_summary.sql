-- Narrow, read-only summary; no new approval state and no changes to original facts.
CREATE FUNCTION eoms.source_readiness_observations(check_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE evidence eoms.reconciliation_evidence_checks;j eoms.reconciliation_jobs;customer uuid;result jsonb;
BEGIN
 SELECT * INTO evidence FROM eoms.reconciliation_evidence_checks WHERE id=check_id;
 IF NOT FOUND OR NOT eoms.can_review_reconciliation(evidence.estate_id) OR NOT EXISTS(SELECT 1 FROM eoms.users WHERE id=eoms.actor_id() AND active) THEN
  RAISE EXCEPTION 'Readiness scope required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO j FROM eoms.reconciliation_jobs WHERE id=evidence.job_id;
 SELECT customer_id INTO customer FROM eoms.estates WHERE id=evidence.estate_id;
 WITH latest AS (
  SELECT DISTINCT ON(reviewer_id) r.* FROM eoms.source_provenance_reviews r WHERE r.evidence_id=check_id ORDER BY reviewer_id,revision DESC
 ), scoped AS (
  SELECT r.id,r.reviewer_id,coalesce(u.display_name,'Recorded reviewer') AS reviewer,r.revision,r.outcome,r.original_examined,r.source_ref,r.reason,r.request_id,r.created_at,
  (coalesce(u.active,false) AND r.reviewer_id<>j.created_by AND r.reviewer_id<>evidence.actor_id AND EXISTS(SELECT 1 FROM eoms.memberships m WHERE m.user_id=r.reviewer_id AND m.estate_id=evidence.estate_id AND m.role='manager') AND EXISTS(SELECT 1 FROM eoms.organization_admins a WHERE a.user_id=r.reviewer_id AND a.customer_id=customer)) AS currently_authorized
  FROM latest r LEFT JOIN eoms.users u ON u.id=r.reviewer_id
 )
 SELECT jsonb_build_object('total',count(*)::int,'corroborated',count(*) FILTER(WHERE outcome='corroborated')::int,'concerns',count(*) FILTER(WHERE outcome='concerns')::int,'insufficient',count(*) FILTER(WHERE outcome='insufficient')::int,'authorizationChanged',count(*) FILTER(WHERE NOT currently_authorized)::int,'authorizedCorroborated',count(*) FILTER(WHERE currently_authorized AND outcome='corroborated')::int,'items',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.reviewer_id) FROM(SELECT * FROM scoped ORDER BY reviewer_id LIMIT 25)b),'[]'::jsonb),'truncated',count(*)>25) INTO result FROM scoped;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION eoms.source_readiness_observations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.source_readiness_observations(uuid) TO eoms_app;
