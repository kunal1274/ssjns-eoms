-- Explicit, scoped external-decision recording. Never an executable mapping grant.
-- Record only real changes after this migration; no retrospective grant history.
CREATE TABLE eoms.mapping_policy_scope_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,subject_id uuid NOT NULL REFERENCES eoms.users(id),estate_id uuid REFERENCES eoms.estates(id),customer_id uuid REFERENCES eoms.customers(id),
 kind text NOT NULL CHECK(kind IN ('membership','setup','user-active')),actor_id uuid REFERENCES eoms.users(id),request_id uuid,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX policy_scope_subject ON eoms.mapping_policy_scope_events(subject_id,id);
ALTER TABLE eoms.mapping_policy_scope_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoms.mapping_policy_scope_events FORCE ROW LEVEL SECURITY;
CREATE TRIGGER policy_scope_immutable BEFORE UPDATE OR DELETE ON eoms.mapping_policy_scope_events FOR EACH ROW EXECUTE FUNCTION eoms.reconciliation_immutable();
CREATE FUNCTION eoms.note_policy_scope_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE who uuid;estate uuid;customer uuid;category text;
BEGIN
 IF TG_TABLE_NAME='users' THEN who:=NEW.id;category:='user-active';
 ELSIF TG_TABLE_NAME='memberships' THEN
  IF TG_OP='UPDATE' AND (NEW.role,NEW.user_id,NEW.estate_id) IS NOT DISTINCT FROM (OLD.role,OLD.user_id,OLD.estate_id) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND (NEW.user_id,NEW.estate_id) IS DISTINCT FROM (OLD.user_id,OLD.estate_id) THEN INSERT INTO eoms.mapping_policy_scope_events(subject_id,estate_id,kind,actor_id,request_id) VALUES(OLD.user_id,OLD.estate_id,'membership',eoms.actor_id(),nullif(current_setting('app.request_id',true),'')::uuid); END IF;
  who:=coalesce(NEW.user_id,OLD.user_id);estate:=coalesce(NEW.estate_id,OLD.estate_id);category:='membership';
 ELSE
  IF TG_OP='UPDATE' AND (NEW.user_id,NEW.customer_id) IS DISTINCT FROM (OLD.user_id,OLD.customer_id) THEN INSERT INTO eoms.mapping_policy_scope_events(subject_id,customer_id,kind,actor_id,request_id) VALUES(OLD.user_id,OLD.customer_id,'setup',eoms.actor_id(),nullif(current_setting('app.request_id',true),'')::uuid); END IF;
  who:=coalesce(NEW.user_id,OLD.user_id);customer:=coalesce(NEW.customer_id,OLD.customer_id);category:='setup'; END IF;
 INSERT INTO eoms.mapping_policy_scope_events(subject_id,estate_id,customer_id,kind,actor_id,request_id) VALUES(who,estate,customer,category,eoms.actor_id(),nullif(current_setting('app.request_id',true),'')::uuid);
 RETURN coalesce(NEW,OLD);
END $$;
REVOKE ALL ON FUNCTION eoms.note_policy_scope_change() FROM PUBLIC;
CREATE TRIGGER policy_scope_membership AFTER INSERT OR UPDATE OR DELETE ON eoms.memberships FOR EACH ROW EXECUTE FUNCTION eoms.note_policy_scope_change();
CREATE TRIGGER policy_scope_setup AFTER INSERT OR UPDATE OR DELETE ON eoms.organization_admins FOR EACH ROW EXECUTE FUNCTION eoms.note_policy_scope_change();
CREATE TRIGGER policy_scope_active AFTER UPDATE OF active ON eoms.users FOR EACH ROW WHEN(OLD.active IS DISTINCT FROM NEW.active) EXECUTE FUNCTION eoms.note_policy_scope_change();
CREATE FUNCTION eoms.policy_scope_revision(estate uuid,subject uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
 SELECT coalesce(max(s.id),0) FROM eoms.mapping_policy_scope_events s WHERE s.subject_id=subject AND(s.estate_id=estate OR s.customer_id=(SELECT customer_id FROM eoms.estates WHERE id=estate) OR s.kind='user-active')
$$;
REVOKE ALL ON FUNCTION eoms.policy_scope_revision(uuid,uuid) FROM PUBLIC;
CREATE TABLE eoms.mapping_policy_authority(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),estate_id uuid NOT NULL REFERENCES eoms.estates(id),
 subject_id uuid NOT NULL REFERENCES eoms.users(id),actor_id uuid NOT NULL REFERENCES eoms.users(id),retry_key uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),previous_id uuid REFERENCES eoms.mapping_policy_authority(id),
 scope_revision bigint NOT NULL CHECK(scope_revision>=0),
 action text NOT NULL CHECK(action IN ('appointed','revoked')),authority_ref text NOT NULL CHECK(length(trim(authority_ref)) BETWEEN 3 AND 240),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(estate_id,subject_id,revision),UNIQUE(estate_id,actor_id,retry_key),CHECK((revision=1)=(previous_id IS NULL)),CHECK(action<>'appointed' OR subject_id<>actor_id)
);
CREATE TABLE eoms.mapping_policy_acceptance(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),policy_id uuid NOT NULL REFERENCES eoms.mapping_policy_versions(id),estate_id uuid NOT NULL REFERENCES eoms.estates(id),
 actor_id uuid NOT NULL REFERENCES eoms.users(id),retry_key uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),previous_id uuid REFERENCES eoms.mapping_policy_acceptance(id),
 policy_sha256 text NOT NULL CHECK(policy_sha256 ~ '^[a-f0-9]{64}$'),authority_id uuid NOT NULL REFERENCES eoms.mapping_policy_authority(id),
 outcome text NOT NULL CHECK(outcome IN ('accepted-externally','changes-requested','rejected','withdrawn')),
 external_ref text NOT NULL CHECK(length(trim(external_ref)) BETWEEN 3 AND 240),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 attested boolean NOT NULL CHECK(attested),request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(policy_id,revision),UNIQUE(policy_id,actor_id,retry_key),CHECK((revision=1)=(previous_id IS NULL))
);
CREATE INDEX policy_authority_page ON eoms.mapping_policy_authority(estate_id,id);
CREATE INDEX policy_acceptance_page ON eoms.mapping_policy_acceptance(policy_id,id);
ALTER TABLE eoms.mapping_policy_authority ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoms.mapping_policy_authority FORCE ROW LEVEL SECURITY;
ALTER TABLE eoms.mapping_policy_acceptance ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoms.mapping_policy_acceptance FORCE ROW LEVEL SECURITY;
CREATE POLICY policy_authority_read ON eoms.mapping_policy_authority FOR SELECT TO eoms_app USING(eoms.can_review_reconciliation(estate_id));
CREATE POLICY policy_acceptance_read ON eoms.mapping_policy_acceptance FOR SELECT TO eoms_app USING(eoms.can_review_reconciliation(estate_id));
CREATE TRIGGER policy_authority_immutable BEFORE UPDATE OR DELETE ON eoms.mapping_policy_authority FOR EACH ROW EXECUTE FUNCTION eoms.reconciliation_immutable();
CREATE TRIGGER policy_acceptance_immutable BEFORE UPDATE OR DELETE ON eoms.mapping_policy_acceptance FOR EACH ROW EXECUTE FUNCTION eoms.reconciliation_immutable();
GRANT SELECT ON eoms.mapping_policy_authority,eoms.mapping_policy_acceptance TO eoms_app;
-- Internal lock helper, not callable by runtime. Holds scope rows until commit.
CREATE FUNCTION eoms.lock_policy_recording_scope(estate uuid,subject uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
BEGIN
 PERFORM u.id FROM eoms.users u JOIN eoms.memberships m ON m.user_id=u.id JOIN eoms.estates e ON e.id=m.estate_id JOIN eoms.organization_admins a ON a.customer_id=e.customer_id AND a.user_id=u.id
 WHERE e.id=estate AND u.id=subject AND u.active AND m.role='manager' FOR SHARE OF u,m,e,a;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current estate-manager and customer setup scope required' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION eoms.lock_policy_recording_scope(uuid,uuid) FROM PUBLIC;
CREATE FUNCTION eoms.policy_authority_candidates(estate uuid) RETURNS TABLE(id uuid,name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
BEGIN
 IF NOT coalesce(eoms.can_review_reconciliation(estate),false) OR NOT EXISTS(SELECT 1 FROM eoms.users WHERE users.id=eoms.actor_id() AND active) THEN RAISE EXCEPTION 'Policy authority scope required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT u.id,u.display_name FROM eoms.users u JOIN eoms.memberships m ON m.user_id=u.id JOIN eoms.estates e ON e.id=m.estate_id JOIN eoms.organization_admins a ON a.customer_id=e.customer_id AND a.user_id=u.id WHERE e.id=estate AND u.active AND m.role='manager';
END $$;
REVOKE ALL ON FUNCTION eoms.policy_authority_candidates(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.policy_authority_candidates(uuid) TO eoms_app;
CREATE FUNCTION eoms.policy_authority_state(estate uuid,subject uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE head eoms.mapping_policy_authority;eligible boolean;
BEGIN
 IF NOT coalesce(eoms.can_review_reconciliation(estate),false) OR NOT EXISTS(SELECT 1 FROM eoms.users WHERE id=eoms.actor_id() AND active) THEN RAISE EXCEPTION 'Policy authority scope required' USING ERRCODE='42501'; END IF;
 SELECT * INTO head FROM eoms.mapping_policy_authority WHERE estate_id=estate AND subject_id=subject ORDER BY revision DESC LIMIT 1;
 SELECT EXISTS(SELECT 1 FROM eoms.users u JOIN eoms.memberships m ON m.user_id=u.id JOIN eoms.estates e ON e.id=m.estate_id JOIN eoms.organization_admins a ON a.customer_id=e.customer_id AND a.user_id=u.id WHERE e.id=estate AND u.id=subject AND u.active AND m.role='manager') INTO eligible;
 RETURN jsonb_build_object('current',CASE WHEN head.id IS NULL THEN NULL ELSE to_jsonb(head) END,'eligible',eligible,'scopeCurrent',coalesce(head.scope_revision=eoms.policy_scope_revision(estate,subject),false),'effective',coalesce(head.action='appointed' AND eligible AND head.scope_revision=eoms.policy_scope_revision(estate,subject),false),'scope','external-policy-decision-recording-only');
END $$;
REVOKE ALL ON FUNCTION eoms.policy_authority_state(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.policy_authority_state(uuid,uuid) TO eoms_app;
CREATE FUNCTION eoms.record_policy_authority(estate uuid,subject uuid,retry uuid,expected integer,result text,ref text,why text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE actor uuid:=eoms.actor_id();request uuid:=nullif(current_setting('app.request_id',true),'')::uuid;prior eoms.mapping_policy_authority;head eoms.mapping_policy_authority;event eoms.mapping_policy_authority;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(estate::text,622));
 PERFORM eoms.lock_policy_recording_scope(estate,actor);
 IF subject IS NULL OR retry IS NULL OR request IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 2147483646 OR result IS NULL OR result NOT IN ('appointed','revoked') OR ref IS NULL OR length(trim(ref)) NOT BETWEEN 3 AND 240 OR why IS NULL OR length(trim(why)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Bounded authority appointment and reference required' USING ERRCODE='23514'; END IF;
 SELECT * INTO prior FROM eoms.mapping_policy_authority WHERE estate_id=estate AND actor_id=actor AND retry_key=retry;
 IF FOUND THEN
  IF (prior.subject_id,prior.revision-1,prior.action,prior.authority_ref,prior.reason) IS DISTINCT FROM(subject,expected,result,ref,why) THEN RAISE EXCEPTION 'Authority retry content changed' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('authority',to_jsonb(prior),'replayed',true);
 END IF;
 SELECT * INTO head FROM eoms.mapping_policy_authority WHERE estate_id=estate AND subject_id=subject ORDER BY revision DESC LIMIT 1;
 IF coalesce(head.revision,0)<>expected THEN RAISE EXCEPTION 'Authority revision changed' USING ERRCODE='23505'; END IF;
 IF result='appointed' THEN
  IF subject=actor THEN RAISE EXCEPTION 'Self appointment is not allowed' USING ERRCODE='42501'; END IF;
  PERFORM eoms.lock_policy_recording_scope(estate,subject);
 ELSE
  IF head.id IS NULL OR head.action<>'appointed' THEN RAISE EXCEPTION 'Only an existing appointment can be revoked' USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO eoms.mapping_policy_authority(estate_id,subject_id,actor_id,retry_key,revision,previous_id,scope_revision,action,authority_ref,reason,request_id)
 VALUES(estate,subject,actor,retry,expected+1,head.id,eoms.policy_scope_revision(estate,subject),result,ref,why,request) RETURNING * INTO event;
 RETURN jsonb_build_object('authority',to_jsonb(event),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION eoms.record_policy_authority(uuid,uuid,uuid,integer,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.record_policy_authority(uuid,uuid,uuid,integer,text,text,text) TO eoms_app;
CREATE FUNCTION eoms.policy_acceptance_state(proposal uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE p eoms.mapping_policy_versions;head eoms.mapping_policy_acceptance;authority jsonb;latest boolean;concerns integer;
BEGIN
 SELECT * INTO p FROM eoms.mapping_policy_versions WHERE id=proposal;
 IF NOT FOUND OR NOT coalesce(eoms.can_review_reconciliation(p.estate_id),false) OR NOT EXISTS(SELECT 1 FROM eoms.users WHERE id=eoms.actor_id() AND active) THEN RAISE EXCEPTION 'Policy acceptance scope required' USING ERRCODE='42501'; END IF;
 SELECT * INTO head FROM eoms.mapping_policy_acceptance WHERE policy_id=proposal ORDER BY revision DESC LIMIT 1;
 SELECT NOT EXISTS(SELECT 1 FROM eoms.mapping_policy_versions WHERE estate_id=p.estate_id AND revision>p.revision) INTO latest;
 SELECT count(*)::int INTO concerns FROM(SELECT DISTINCT ON(actor_id) outcome FROM eoms.mapping_policy_reviews WHERE policy_id=proposal ORDER BY actor_id,revision DESC) r WHERE outcome IN ('changes-requested','not-supported');
 IF head.id IS NOT NULL THEN authority:=eoms.policy_authority_state(p.estate_id,head.actor_id); END IF;
 RETURN jsonb_build_object('head',CASE WHEN head.id IS NULL THEN NULL ELSE to_jsonb(head) END,'isLatestPolicy',latest,'openDesignConcerns',concerns,'recordedExternalAcceptance',coalesce(head.outcome='accepted-externally',false),'authorityCurrent',coalesce((authority->>'effective')::boolean AND authority->'current'->>'id'=head.authority_id::text,false),'current',coalesce(head.outcome='accepted-externally' AND latest AND concerns=0 AND (authority->>'effective')::boolean AND authority->'current'->>'id'=head.authority_id::text,false),'applicationEnabled',false,'sourceAuthenticityVerified',false);
END $$;
REVOKE ALL ON FUNCTION eoms.policy_acceptance_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.policy_acceptance_state(uuid) TO eoms_app;
CREATE FUNCTION eoms.record_policy_acceptance(proposal uuid,retry uuid,expected integer,digest text,grant_id uuid,result text,ref text,why text,confirmed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE p eoms.mapping_policy_versions;actor uuid:=eoms.actor_id();request uuid:=nullif(current_setting('app.request_id',true),'')::uuid;prior eoms.mapping_policy_acceptance;head eoms.mapping_policy_acceptance;event eoms.mapping_policy_acceptance;authority jsonb;
BEGIN
 SELECT * INTO p FROM eoms.mapping_policy_versions WHERE id=proposal;
 IF NOT FOUND OR NOT coalesce(eoms.can_review_reconciliation(p.estate_id),false) OR NOT EXISTS(SELECT 1 FROM eoms.users WHERE id=eoms.actor_id() AND active) THEN RAISE EXCEPTION 'Policy acceptance scope required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p.estate_id::text,622));
 PERFORM eoms.lock_policy_recording_scope(p.estate_id,actor);
 IF retry IS NULL OR request IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 2147483646 OR digest IS DISTINCT FROM p.sha256 OR grant_id IS NULL OR result IS NULL OR result NOT IN ('accepted-externally','changes-requested','rejected','withdrawn') OR ref IS NULL OR length(trim(ref)) NOT BETWEEN 3 AND 240 OR why IS NULL OR length(trim(why)) NOT BETWEEN 3 AND 500 OR confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Exact policy identity authority reference and attestation required' USING ERRCODE='23514'; END IF;
 SELECT * INTO prior FROM eoms.mapping_policy_acceptance WHERE policy_id=proposal AND actor_id=actor AND retry_key=retry;
 IF FOUND THEN
  IF (prior.revision-1,prior.policy_sha256,prior.authority_id,prior.outcome,prior.external_ref,prior.reason,prior.attested) IS DISTINCT FROM(expected,digest,grant_id,result,ref,why,confirmed) THEN RAISE EXCEPTION 'Acceptance retry content changed' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('acceptance',to_jsonb(prior),'replayed',true);
 END IF;
 authority:=eoms.policy_authority_state(p.estate_id,actor);
 IF NOT coalesce((authority->>'effective')::boolean,false) THEN RAISE EXCEPTION 'An explicit current policy recording appointment is required' USING ERRCODE='42501'; END IF;
 IF authority->'current'->>'id'<>grant_id::text THEN RAISE EXCEPTION 'Authority appointment changed; refresh' USING ERRCODE='23505'; END IF;
 IF actor=p.actor_id THEN RAISE EXCEPTION 'Policy author cannot record independent external acceptance' USING ERRCODE='42501'; END IF;
 SELECT * INTO head FROM eoms.mapping_policy_acceptance WHERE policy_id=proposal ORDER BY revision DESC LIMIT 1;
 IF coalesce(head.revision,0)<>expected THEN RAISE EXCEPTION 'Acceptance revision changed; refresh' USING ERRCODE='23505'; END IF;
 IF result='withdrawn' THEN
  IF head.outcome IS DISTINCT FROM 'accepted-externally' THEN RAISE EXCEPTION 'Only recorded external acceptance can be withdrawn' USING ERRCODE='23514'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM eoms.mapping_policy_versions WHERE estate_id=p.estate_id AND revision>p.revision) THEN RAISE EXCEPTION 'Policy superseded; inspect latest version' USING ERRCODE='23505'; END IF;
 END IF;
 IF result='accepted-externally' AND EXISTS(SELECT 1 FROM(SELECT DISTINCT ON(actor_id) outcome FROM eoms.mapping_policy_reviews WHERE policy_id=proposal ORDER BY actor_id,revision DESC) r WHERE outcome IN ('changes-requested','not-supported')) THEN RAISE EXCEPTION 'Resolve current design concerns through linked reviews before recording acceptance' USING ERRCODE='23514'; END IF;
 INSERT INTO eoms.mapping_policy_acceptance(policy_id,estate_id,actor_id,retry_key,revision,previous_id,policy_sha256,authority_id,outcome,external_ref,reason,attested,request_id)
 VALUES(proposal,p.estate_id,actor,retry,expected+1,head.id,digest,grant_id,result,ref,why,confirmed,request) RETURNING * INTO event;
 RETURN jsonb_build_object('acceptance',to_jsonb(event),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION eoms.record_policy_acceptance(uuid,uuid,integer,text,uuid,text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.record_policy_acceptance(uuid,uuid,integer,text,uuid,text,text,text,boolean) TO eoms_app;
