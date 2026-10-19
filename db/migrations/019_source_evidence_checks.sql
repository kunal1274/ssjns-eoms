-- An immutable digest comparison is evidence of byte identity, never authenticity/approval.
CREATE TABLE eoms.reconciliation_evidence_checks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL REFERENCES eoms.reconciliation_jobs(id),
 estate_id uuid NOT NULL REFERENCES eoms.estates(id),actor_id uuid NOT NULL REFERENCES eoms.users(id),
 retry_key uuid NOT NULL,action text NOT NULL DEFAULT 'source-digest-checked' CHECK(action='source-digest-checked'),
 file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 160),byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 2097152),
 computed_sha256 text NOT NULL CHECK(computed_sha256 ~ '^[a-f0-9]{64}$'),
 declared_sha256 text NOT NULL CHECK(declared_sha256 ~ '^[a-f0-9]{64}$'),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 matches_declared boolean NOT NULL,source_authenticity_verified boolean NOT NULL DEFAULT false CHECK(NOT source_authenticity_verified),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(job_id,actor_id,retry_key),
 CHECK(matches_declared=(computed_sha256=declared_sha256))
);
CREATE INDEX reconciliation_evidence_page ON eoms.reconciliation_evidence_checks(job_id,id);
ALTER TABLE eoms.reconciliation_evidence_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoms.reconciliation_evidence_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_evidence_read ON eoms.reconciliation_evidence_checks FOR SELECT TO eoms_app USING(eoms.can_review_reconciliation(estate_id));
CREATE TRIGGER reconciliation_evidence_immutable BEFORE UPDATE OR DELETE ON eoms.reconciliation_evidence_checks FOR EACH ROW EXECUTE FUNCTION eoms.reconciliation_immutable();
GRANT SELECT ON eoms.reconciliation_evidence_checks TO eoms_app;
-- Only this narrow function may insert. Hash/size/scope/provenance come from actual bytes and session context.
CREATE FUNCTION eoms.check_reconciliation_source(job uuid,retry uuid,filename text,why text,content bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE j eoms.reconciliation_jobs;previous eoms.reconciliation_evidence_checks;event eoms.reconciliation_evidence_checks;
 actor uuid:=eoms.actor_id();request uuid:=nullif(current_setting('app.request_id',true),'')::uuid;
 digest text;size integer:=octet_length(content);
BEGIN
 SELECT * INTO j FROM eoms.reconciliation_jobs WHERE id=job;
 IF NOT FOUND OR NOT eoms.can_review_reconciliation(j.estate_id) THEN RAISE EXCEPTION 'Review access required' USING ERRCODE='42501'; END IF;
 IF actor IS NULL OR request IS NULL OR retry IS NULL OR content IS NULL OR size NOT BETWEEN 1 AND 2097152 OR filename IS NULL OR length(trim(filename)) NOT BETWEEN 1 AND 160 OR filename ~ '[[:cntrl:]/\\]' OR why IS NULL OR length(trim(why)) NOT BETWEEN 3 AND 500 THEN
  RAISE EXCEPTION 'Bounded source bytes and check provenance required' USING ERRCODE='23514';
 END IF;
 digest:=encode(public.digest(content,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(job::text||actor::text||retry::text,619));
 SELECT * INTO previous FROM eoms.reconciliation_evidence_checks WHERE job_id=job AND actor_id=actor AND retry_key=retry;
 IF FOUND THEN
  IF (previous.computed_sha256,previous.file_name,previous.reason,previous.byte_length) IS DISTINCT FROM (digest,filename,why,size) THEN
   RAISE EXCEPTION 'Source check reference already used for different content' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('check',to_jsonb(previous),'replayed',true);
 END IF;
 INSERT INTO eoms.reconciliation_evidence_checks(job_id,estate_id,actor_id,retry_key,file_name,byte_length,computed_sha256,declared_sha256,manifest_sha256,matches_declared,reason,request_id)
 VALUES(job,j.estate_id,actor,retry,filename,size,digest,j.manifest->'source'->>'sha256',j.manifest_sha256,digest=j.manifest->'source'->>'sha256',why,request) RETURNING * INTO event;
 RETURN jsonb_build_object('check',to_jsonb(event),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION eoms.check_reconciliation_source(uuid,uuid,text,text,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.check_reconciliation_source(uuid,uuid,text,text,bytea) TO eoms_app;
