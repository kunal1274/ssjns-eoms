-- Immutable review submissions only. No approval or historical application is inferred.
CREATE FUNCTION eoms.can_review_reconciliation(scope uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,eoms AS $$
 SELECT EXISTS(SELECT 1 FROM eoms.estates e JOIN eoms.memberships m ON m.estate_id=e.id WHERE e.id=scope AND m.user_id=eoms.actor_id() AND m.role='manager' AND eoms.can_manage_customer(e.customer_id))
$$;
REVOKE ALL ON FUNCTION eoms.can_review_reconciliation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.can_review_reconciliation(uuid) TO eoms_app;
CREATE TABLE eoms.reconciliation_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),estate_id uuid NOT NULL REFERENCES eoms.estates(id),
 created_by uuid NOT NULL REFERENCES eoms.users(id),retry_key uuid NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND coalesce(snapshot->'applied'='false'::jsonb,false) AND coalesce(snapshot->'sourceEvidenceVerified'='false'::jsonb,false)),
 request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(estate_id,created_by,retry_key)
);
CREATE INDEX reconciliation_job_page ON eoms.reconciliation_jobs(estate_id,id);
ALTER TABLE eoms.reconciliation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoms.reconciliation_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_job_read ON eoms.reconciliation_jobs FOR SELECT TO eoms_app USING(eoms.can_review_reconciliation(estate_id));
CREATE POLICY reconciliation_job_create ON eoms.reconciliation_jobs FOR INSERT TO eoms_app WITH CHECK(eoms.can_review_reconciliation(estate_id) AND created_by=eoms.actor_id());
CREATE TABLE eoms.reconciliation_job_history(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,job_id uuid NOT NULL REFERENCES eoms.reconciliation_jobs(id),
 estate_id uuid NOT NULL REFERENCES eoms.estates(id),action text NOT NULL CHECK(action='review-saved'),
 actor_id uuid NOT NULL REFERENCES eoms.users(id),request_id uuid NOT NULL,reason text NOT NULL,
 manifest_sha256 text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reconciliation_job_audit ON eoms.reconciliation_job_history(job_id,id);
ALTER TABLE eoms.reconciliation_job_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoms.reconciliation_job_history FORCE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_job_history_read ON eoms.reconciliation_job_history FOR SELECT TO eoms_app USING(eoms.can_review_reconciliation(estate_id));
CREATE FUNCTION eoms.reconciliation_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
BEGIN RAISE EXCEPTION 'Saved reconciliation reviews and audit are append only' USING ERRCODE='23514'; END $$;
REVOKE ALL ON FUNCTION eoms.reconciliation_immutable() FROM PUBLIC;
CREATE TRIGGER reconciliation_job_immutable BEFORE UPDATE OR DELETE ON eoms.reconciliation_jobs FOR EACH ROW EXECUTE FUNCTION eoms.reconciliation_immutable();
CREATE TRIGGER reconciliation_audit_immutable BEFORE UPDATE OR DELETE ON eoms.reconciliation_job_history FOR EACH ROW EXECUTE FUNCTION eoms.reconciliation_immutable();
CREATE FUNCTION eoms.record_reconciliation_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
BEGIN
 IF NEW.created_by IS DISTINCT FROM eoms.actor_id() OR NEW.request_id IS DISTINCT FROM nullif(current_setting('app.request_id',true),'')::uuid THEN
  RAISE EXCEPTION 'Review actor and request provenance required' USING ERRCODE='23514';
 END IF;
 INSERT INTO eoms.reconciliation_job_history(job_id,estate_id,action,actor_id,request_id,reason,manifest_sha256)
 VALUES(NEW.id,NEW.estate_id,'review-saved',NEW.created_by,NEW.request_id,NEW.reason,NEW.manifest_sha256);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.record_reconciliation_job() FROM PUBLIC;
CREATE TRIGGER reconciliation_job_saved AFTER INSERT ON eoms.reconciliation_jobs FOR EACH ROW EXECUTE FUNCTION eoms.record_reconciliation_job();
GRANT SELECT ON eoms.reconciliation_jobs TO eoms_app;
GRANT INSERT(estate_id,created_by,retry_key,reason,manifest,manifest_sha256,snapshot,request_id) ON eoms.reconciliation_jobs TO eoms_app;
GRANT SELECT ON eoms.reconciliation_job_history TO eoms_app;
