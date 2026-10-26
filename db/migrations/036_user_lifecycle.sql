-- Current-state classification only: migration creates no historical lifecycle decisions.
ALTER TABLE eoms.users ADD COLUMN lifecycle_state text NOT NULL DEFAULT 'active' CHECK(lifecycle_state IN ('active','suspended','deactivated'));
ALTER TABLE eoms.users ADD COLUMN lifecycle_revision bigint NOT NULL DEFAULT 0 CHECK(lifecycle_revision>=0);
UPDATE eoms.users SET lifecycle_state=CASE WHEN active THEN 'active' ELSE 'suspended' END;
ALTER TABLE eoms.users ADD CONSTRAINT lifecycle_active_consistency CHECK(active=(lifecycle_state='active'));
CREATE FUNCTION eoms.synchronize_user_lifecycle() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT NEW.active AND NEW.lifecycle_state='active' THEN NEW.lifecycle_state='suspended'; END IF;
 ELSE
  IF NEW.active IS DISTINCT FROM OLD.active AND NEW.lifecycle_state=OLD.lifecycle_state THEN
   NEW.lifecycle_state=CASE WHEN NEW.active THEN 'active' ELSE 'suspended' END;
  END IF;
  IF (NEW.active,NEW.lifecycle_state) IS DISTINCT FROM (OLD.active,OLD.lifecycle_state) THEN NEW.lifecycle_revision=OLD.lifecycle_revision+1;
  ELSE NEW.lifecycle_revision=OLD.lifecycle_revision; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.synchronize_user_lifecycle() FROM PUBLIC;
CREATE TRIGGER synchronize_user_lifecycle BEFORE INSERT OR UPDATE ON eoms.users FOR EACH ROW EXECUTE FUNCTION eoms.synchronize_user_lifecycle();
CREATE TABLE eoms.platform_lifecycle_authority(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,subject_id uuid NOT NULL REFERENCES eoms.users(id),
 action text NOT NULL CHECK(action IN ('granted','revoked')),user_scope_revision bigint NOT NULL,
 reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 5 AND 200),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 10 AND 500),
 operator text NOT NULL DEFAULT session_user,created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON eoms.platform_lifecycle_authority FROM PUBLIC,eoms_app;
CREATE TRIGGER lifecycle_authority_immutable BEFORE UPDATE OR DELETE ON eoms.platform_lifecycle_authority FOR EACH ROW EXECUTE FUNCTION eoms.security_event_immutable();
CREATE FUNCTION eoms.lifecycle_operator_allowed(subject uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
 SELECT coalesce((SELECT g.action='granted' AND g.user_scope_revision=coalesce((SELECT max(e.id) FROM eoms.mapping_policy_scope_events e WHERE e.subject_id=subject AND e.kind='user-active'),0)
 FROM eoms.platform_lifecycle_authority g JOIN eoms.users u ON u.id=g.subject_id AND u.active WHERE g.subject_id=subject ORDER BY g.id DESC LIMIT 1),false)
$$;
REVOKE ALL ON FUNCTION eoms.lifecycle_operator_allowed(uuid) FROM PUBLIC;
CREATE FUNCTION eoms.lifecycle_context(session_hash text,target uuid DEFAULT NULL,after_id bigint DEFAULT NULL,page_size integer DEFAULT 10) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE a record; result jsonb; history jsonb;
BEGIN
 SELECT * INTO a FROM eoms.auth_session(session_hash);
 IF a.id IS NULL THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000'; END IF;
 IF NOT eoms.lifecycle_operator_allowed(a.id) THEN
  IF target IS NOT NULL THEN RAISE EXCEPTION 'Explicit lifecycle operator required' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('allowed',false);
 END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 OR after_id<1 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
 IF target IS NULL THEN RETURN jsonb_build_object('allowed',true); END IF;
 SELECT jsonb_build_object('id',u.id,'name',u.display_name,'state',u.lifecycle_state,'revision',u.lifecycle_revision::text,
 'self',u.id=a.id,'sessionCount',(SELECT count(*) FROM eoms.sessions s WHERE s.user_id=u.id AND s.expires_at>now() AND s.last_seen_at>now()-interval '30 minutes'),
 'estateAssignments',(SELECT count(*) FROM eoms.memberships m WHERE m.user_id=u.id),
 'setupAssignments',(SELECT count(*) FROM eoms.organization_admins g WHERE g.user_id=u.id),
 'protectedSetups',(SELECT count(*) FROM eoms.organization_admins g WHERE g.user_id=u.id AND NOT EXISTS(SELECT 1 FROM eoms.organization_admins p JOIN eoms.users v ON v.id=p.user_id AND v.active WHERE p.customer_id=g.customer_id AND p.user_id<>u.id)))
 INTO result FROM eoms.users u WHERE u.id=target;
 IF result IS NULL THEN RAISE EXCEPTION 'Named account unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id::bigint DESC),'[]'::jsonb) INTO history FROM
 (SELECT h.id::text,h.actor_id,h.action,h.request_id,h.detail,h.created_at FROM eoms.security_events h
 WHERE h.subject_id=target AND h.action LIKE 'lifecycle.%' AND (after_id IS NULL OR h.id<after_id) ORDER BY h.id DESC LIMIT page_size+1)e;
 RETURN jsonb_build_object('allowed',true,'target',result,'items',history);
END $$;
CREATE FUNCTION eoms.change_user_lifecycle(session_hash text,csrf_proof text,target uuid,expected_revision bigint,next_state text,retry_key uuid,reference_value text,reason_value text,reviewed boolean,request_ref uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE uid uuid; a record; u eoms.users%ROWTYPE; payload jsonb; prior eoms.security_receipts%ROWTYPE; n integer; eid bigint; answer jsonb; customer uuid;
BEGIN
 -- Serialize lifecycle decisions, including simultaneous changes to two setup administrators.
 PERFORM pg_advisory_xact_lock(6543808);
 SELECT user_id INTO uid FROM eoms.sessions WHERE token_hash=session_hash;
 IF uid IS NULL THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000'; END IF;
 -- Customer handovers share these locks; active checks below are live after locking.
 FOR customer IN SELECT customer_id FROM eoms.organization_admins WHERE user_id=target ORDER BY customer_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(customer::text,625));
 END LOOP;
 PERFORM 1 FROM eoms.users v WHERE v.id IN (uid,target) ORDER BY v.id FOR UPDATE;
 SELECT * INTO a FROM eoms.auth_session(session_hash);
 IF a.id IS NULL OR a.csrf IS DISTINCT FROM csrf_proof THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000'; END IF;
 IF NOT eoms.lifecycle_operator_allowed(uid) THEN RAISE EXCEPTION 'Explicit lifecycle operator required' USING ERRCODE='42501'; END IF;
 IF target=uid THEN RAISE EXCEPTION 'A separate lifecycle operator must change your account' USING ERRCODE='42501'; END IF;
 IF target IS NULL OR expected_revision IS NULL OR expected_revision<0 OR next_state IS NULL OR next_state NOT IN ('active','suspended','deactivated') OR retry_key IS NULL OR reference_value IS NULL OR length(trim(reference_value)) NOT BETWEEN 5 AND 200 OR reason_value IS NULL OR length(trim(reason_value)) NOT BETWEEN 10 AND 500 OR reviewed IS DISTINCT FROM true OR request_ref IS NULL THEN RAISE EXCEPTION 'Explicit reviewed lifecycle decision required' USING ERRCODE='22023'; END IF;
 payload=jsonb_build_object('kind','lifecycle-change','target',target,'revision',expected_revision,'state',next_state,'reference',reference_value,'reason',reason_value,'reviewed',reviewed);
 SELECT * INTO prior FROM eoms.security_receipts WHERE subject_id=uid AND key=retry_key;
 IF FOUND THEN
  IF prior.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Changed retry' USING ERRCODE='40001'; END IF;
  RETURN prior.result||jsonb_build_object('replayed',true);
 END IF;
 SELECT * INTO u FROM eoms.users WHERE id=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501'; END IF;
 IF u.lifecycle_revision<>expected_revision THEN RAISE EXCEPTION 'Account changed; refresh preview' USING ERRCODE='40001'; END IF;
 IF u.lifecycle_state=next_state OR (u.lifecycle_state='deactivated' AND next_state='suspended') THEN RAISE EXCEPTION 'Choose an allowed change' USING ERRCODE='22023'; END IF;
 IF next_state<>'active' AND EXISTS(SELECT 1 FROM eoms.organization_admins g WHERE g.user_id=target AND NOT EXISTS(SELECT 1 FROM eoms.organization_admins p JOIN eoms.users v ON v.id=p.user_id AND v.active WHERE p.customer_id=g.customer_id AND p.user_id<>target)) THEN RAISE EXCEPTION 'Retain another active setup administrator' USING ERRCODE='23514'; END IF;
 PERFORM set_config('app.user_id',uid::text,true);PERFORM set_config('app.request_id',request_ref::text,true);
 SELECT count(*) INTO n FROM eoms.sessions WHERE user_id=target;
 UPDATE eoms.users SET lifecycle_state=next_state,active=(next_state='active') WHERE id=target RETURNING * INTO u;
 -- Also cover suspended -> deactivated (active remains false) and any anomalous private artifacts.
 DELETE FROM eoms.sessions WHERE user_id=target;
 DELETE FROM eoms.recovery_tokens WHERE user_id=target;
 INSERT INTO eoms.security_events(subject_id,actor_id,action,request_id,detail)
 VALUES(target,uid,'lifecycle.'||next_state,request_ref,jsonb_build_object('state',next_state,'revision',u.lifecycle_revision::text,'sessionsInvalidated',n,'reference',reference_value,'reason',reason_value,'assignmentsRetained',true,'reviewed',true)) RETURNING id INTO eid;
 answer=jsonb_build_object('targetId',target,'state',next_state,'revision',u.lifecycle_revision::text,'eventId',eid::text,'sessionsInvalidated',n,'requestId',request_ref,'replayed',false);
 INSERT INTO eoms.security_receipts(subject_id,key,payload,result) VALUES(uid,retry_key,payload,answer);
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION eoms.lifecycle_context(text,uuid,bigint,integer),eoms.change_user_lifecycle(text,text,uuid,bigint,text,uuid,text,text,boolean,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.lifecycle_context(text,uuid,bigint,integer),eoms.change_user_lifecycle(text,text,uuid,bigint,text,uuid,text,text,boolean,uuid) TO eoms_app;
