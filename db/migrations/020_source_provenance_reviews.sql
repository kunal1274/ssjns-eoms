-- Non-authorizing human observations. No machine-authenticated source or mapping approval.
CREATE TABLE eoms.source_provenance_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),evidence_id uuid NOT NULL REFERENCES eoms.reconciliation_evidence_checks(id),
 job_id uuid NOT NULL REFERENCES eoms.reconciliation_jobs(id),estate_id uuid NOT NULL REFERENCES eoms.estates(id),
 reviewer_id uuid NOT NULL REFERENCES eoms.users(id),retry_key uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),
 previous_id uuid REFERENCES eoms.source_provenance_reviews(id),
 outcome text NOT NULL CHECK(outcome IN ('corroborated','concerns','insufficient')),
 original_examined boolean NOT NULL,source_ref text NOT NULL CHECK(length(trim(source_ref)) BETWEEN 3 AND 240),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),request_id uuid NOT NULL,
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(evidence_id,reviewer_id,retry_key),UNIQUE(evidence_id,reviewer_id,revision),
 CHECK(outcome<>'corroborated' OR original_examined),CHECK((revision=1)=(previous_id IS NULL))
);
CREATE INDEX source_review_page ON eoms.source_provenance_reviews(evidence_id,id);
ALTER TABLE eoms.source_provenance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoms.source_provenance_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY source_review_read ON eoms.source_provenance_reviews FOR SELECT TO eoms_app USING(eoms.can_review_reconciliation(estate_id));
CREATE TRIGGER source_review_immutable BEFORE UPDATE OR DELETE ON eoms.source_provenance_reviews FOR EACH ROW EXECUTE FUNCTION eoms.reconciliation_immutable();
GRANT SELECT ON eoms.source_provenance_reviews TO eoms_app;
CREATE FUNCTION eoms.record_source_review(check_id uuid,retry uuid,expected integer,result text,examined boolean,reference text,why text) RETURNS jsonb
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
REVOKE ALL ON FUNCTION eoms.record_source_review(uuid,uuid,integer,text,boolean,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.record_source_review(uuid,uuid,integer,text,boolean,text,text) TO eoms_app;
