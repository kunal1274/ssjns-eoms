-- Design review only. These records never activate a business policy or mapping.
CREATE TABLE eoms.mapping_policy_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), estate_id uuid NOT NULL REFERENCES eoms.estates(id),
 actor_id uuid NOT NULL REFERENCES eoms.users(id), retry_key uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),previous_id uuid REFERENCES eoms.mapping_policy_versions(id),
 content jsonb NOT NULL CHECK(content->>'scope'='design-review-only' AND content->>'basis'='mapping-policy-r0'),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 approval_enabled boolean NOT NULL DEFAULT false CHECK(NOT approval_enabled),application_enabled boolean NOT NULL DEFAULT false CHECK(NOT application_enabled),
 UNIQUE(estate_id,revision),UNIQUE(estate_id,actor_id,retry_key),CHECK((revision=1)=(previous_id IS NULL))
);
CREATE TABLE eoms.mapping_policy_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),policy_id uuid NOT NULL REFERENCES eoms.mapping_policy_versions(id),
 estate_id uuid NOT NULL REFERENCES eoms.estates(id),actor_id uuid NOT NULL REFERENCES eoms.users(id),retry_key uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),previous_id uuid REFERENCES eoms.mapping_policy_reviews(id),
 policy_sha256 text NOT NULL CHECK(policy_sha256 ~ '^[a-f0-9]{64}$'),
 outcome text NOT NULL CHECK(outcome IN ('support-for-design','changes-requested','not-supported')),
 reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 3 AND 240),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(policy_id,actor_id,retry_key),UNIQUE(policy_id,actor_id,revision),CHECK((revision=1)=(previous_id IS NULL))
);
ALTER TABLE eoms.mapping_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoms.mapping_policy_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE eoms.mapping_policy_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoms.mapping_policy_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY mapping_policy_read ON eoms.mapping_policy_versions FOR SELECT TO eoms_app USING(eoms.can_review_reconciliation(estate_id));
CREATE POLICY mapping_policy_review_read ON eoms.mapping_policy_reviews FOR SELECT TO eoms_app USING(eoms.can_review_reconciliation(estate_id));
CREATE TRIGGER mapping_policy_immutable BEFORE UPDATE OR DELETE ON eoms.mapping_policy_versions FOR EACH ROW EXECUTE FUNCTION eoms.reconciliation_immutable();
CREATE TRIGGER mapping_policy_review_immutable BEFORE UPDATE OR DELETE ON eoms.mapping_policy_reviews FOR EACH ROW EXECUTE FUNCTION eoms.reconciliation_immutable();
GRANT SELECT ON eoms.mapping_policy_versions,eoms.mapping_policy_reviews TO eoms_app;
CREATE FUNCTION eoms.propose_mapping_policy(estate uuid,retry uuid,expected integer,document jsonb,why text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE actor uuid:=eoms.actor_id();request uuid:=nullif(current_setting('app.request_id',true),'')::uuid;
 digest text;prior eoms.mapping_policy_versions;head eoms.mapping_policy_versions;event eoms.mapping_policy_versions;
BEGIN
 IF NOT coalesce(eoms.can_review_reconciliation(estate),false) OR NOT EXISTS(SELECT 1 FROM eoms.users WHERE id=actor AND active) THEN RAISE EXCEPTION 'Policy review scope required' USING ERRCODE='42501'; END IF;
 IF retry IS NULL OR request IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 2147483646 OR document IS NULL OR jsonb_typeof(document)<>'object' OR document->>'scope' IS DISTINCT FROM 'design-review-only' OR document->>'basis' IS DISTINCT FROM 'mapping-policy-r0' OR document->>'version' IS DISTINCT FROM '1' OR document IS DISTINCT FROM jsonb_build_object('version',1,'basis','mapping-policy-r0','scope','design-review-only','custodyCriteria',document->>'custodyCriteria','approverCriteria',document->>'approverCriteria','evidenceCriteria',document->>'evidenceCriteria','guardrails','["R0-01: Preserve original historical facts; separately classified attribution overlays only; no implied payroll or finance posting.", "R0-02: Task links remain in the existing exact-code, versioned, reasoned workflow; no bulk unlink or overwrite.", "R0-03: Future decisions must bind exact manifest, check, custody, observation and policy identities.", "R0-04: A separately scoped mapping approver must be distinct from preparer, uploader and relied-on provenance reviewers.", "R0-05: Concerns, insufficient evidence, changed authority and disputed custody pause decisions; positive statements do not cancel concerns.", "R0-06: Revalidate all scopes, lifecycle, versions and evidence transactionally before application.", "R0-07: Bounded atomic batches, immutable receipts and exact-payload retry; no partial application or live downstream dispatch.", "R0-08: Corrections require append-only authorized compensation preserving prior decisions and history."]'::jsonb) THEN
  RAISE EXCEPTION 'Bounded design proposal required' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['custodyCriteria','approverCriteria','evidenceCriteria']) k WHERE jsonb_typeof(document->k) IS DISTINCT FROM 'string' OR length(trim(document->>k)) NOT BETWEEN 10 AND 2000) OR why IS NULL OR length(trim(why)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Policy provenance required' USING ERRCODE='23514'; END IF;
 digest:=encode(public.digest(convert_to(document::text,'UTF8'),'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(estate::text,622));
 SELECT * INTO prior FROM eoms.mapping_policy_versions WHERE estate_id=estate AND actor_id=actor AND retry_key=retry;
 IF FOUND THEN
  IF (prior.revision-1,prior.content,prior.sha256,prior.reason) IS DISTINCT FROM (expected,document,digest,why) THEN RAISE EXCEPTION 'Policy retry content changed' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('policy',to_jsonb(prior),'replayed',true);
 END IF;
 SELECT * INTO head FROM eoms.mapping_policy_versions WHERE estate_id=estate ORDER BY revision DESC LIMIT 1;
 IF coalesce(head.revision,0)<>expected THEN RAISE EXCEPTION 'Policy revision changed; refresh' USING ERRCODE='23505'; END IF;
 INSERT INTO eoms.mapping_policy_versions(estate_id,actor_id,retry_key,revision,previous_id,content,sha256,reason,request_id)
 VALUES(estate,actor,retry,expected+1,head.id,document,digest,why,request) RETURNING * INTO event;
 RETURN jsonb_build_object('policy',to_jsonb(event),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION eoms.propose_mapping_policy(uuid,uuid,integer,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.propose_mapping_policy(uuid,uuid,integer,jsonb,text) TO eoms_app;
CREATE FUNCTION eoms.review_mapping_policy(proposal uuid,retry uuid,expected integer,digest text,result text,ref text,why text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE actor uuid:=eoms.actor_id();request uuid:=nullif(current_setting('app.request_id',true),'')::uuid;
 p eoms.mapping_policy_versions;prior eoms.mapping_policy_reviews;head eoms.mapping_policy_reviews;event eoms.mapping_policy_reviews;
BEGIN
 SELECT * INTO p FROM eoms.mapping_policy_versions WHERE id=proposal;
 IF NOT FOUND OR NOT coalesce(eoms.can_review_reconciliation(p.estate_id),false) OR NOT EXISTS(SELECT 1 FROM eoms.users WHERE id=actor AND active) THEN RAISE EXCEPTION 'Policy review scope required' USING ERRCODE='42501'; END IF;
 IF actor=p.actor_id THEN RAISE EXCEPTION 'A separate policy reviewer is required' USING ERRCODE='42501'; END IF;
 IF retry IS NULL OR request IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 2147483646 OR digest IS DISTINCT FROM p.sha256 OR result IS NULL OR result NOT IN ('support-for-design','changes-requested','not-supported') OR ref IS NULL OR length(trim(ref)) NOT BETWEEN 3 AND 240 OR why IS NULL OR length(trim(why)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Exact policy identity and bounded review required' USING ERRCODE='23514'; END IF;
 -- Match proposal lock order: serialize a new version against a review of the old head.
 PERFORM pg_advisory_xact_lock(hashtextextended(p.estate_id::text,622));
 PERFORM pg_advisory_xact_lock(hashtextextended(proposal::text||actor::text,623));
 SELECT * INTO prior FROM eoms.mapping_policy_reviews WHERE policy_id=proposal AND actor_id=actor AND retry_key=retry;
 IF FOUND THEN
  IF (prior.revision-1,prior.policy_sha256,prior.outcome,prior.reference,prior.reason) IS DISTINCT FROM (expected,digest,result,ref,why) THEN RAISE EXCEPTION 'Policy review retry content changed' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('review',to_jsonb(prior),'replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM eoms.mapping_policy_versions WHERE estate_id=p.estate_id AND revision>p.revision) THEN RAISE EXCEPTION 'Policy superseded; inspect the latest proposal' USING ERRCODE='23505'; END IF;
 SELECT * INTO head FROM eoms.mapping_policy_reviews WHERE policy_id=proposal AND actor_id=actor ORDER BY revision DESC LIMIT 1;
 IF coalesce(head.revision,0)<>expected THEN RAISE EXCEPTION 'Policy review revision changed; refresh' USING ERRCODE='23505'; END IF;
 INSERT INTO eoms.mapping_policy_reviews(policy_id,estate_id,actor_id,retry_key,revision,previous_id,policy_sha256,outcome,reference,reason,request_id)
 VALUES(proposal,p.estate_id,actor,retry,expected+1,head.id,digest,result,ref,why,request) RETURNING * INTO event;
 RETURN jsonb_build_object('review',to_jsonb(event),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION eoms.review_mapping_policy(uuid,uuid,integer,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.review_mapping_policy(uuid,uuid,integer,text,text,text,text) TO eoms_app;
