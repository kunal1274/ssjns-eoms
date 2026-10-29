-- Explicit global session-revocation authority; never inferred from estate/setup roles.
CREATE TABLE eoms.platform_security_authority(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,subject_id uuid NOT NULL REFERENCES eoms.users(id),
 action text NOT NULL CHECK(action IN ('granted','revoked')),user_scope_revision bigint NOT NULL,
 reference text NOT NULL,reason text NOT NULL,operator text NOT NULL DEFAULT session_user,created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON eoms.platform_security_authority FROM PUBLIC,eoms_app;
CREATE TRIGGER security_authority_immutable BEFORE UPDATE OR DELETE ON eoms.platform_security_authority FOR EACH ROW EXECUTE FUNCTION eoms.security_event_immutable();
CREATE FUNCTION eoms.security_operator_allowed(subject uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
 SELECT coalesce((SELECT g.action='granted' AND g.user_scope_revision=coalesce((SELECT max(e.id) FROM eoms.mapping_policy_scope_events e WHERE e.subject_id=subject AND e.kind='user-active'),0)
 FROM eoms.platform_security_authority g JOIN eoms.users u ON u.id=g.subject_id AND u.active WHERE g.subject_id=subject ORDER BY g.id DESC LIMIT 1),false)
$$;
REVOKE ALL ON FUNCTION eoms.security_operator_allowed(uuid) FROM PUBLIC;
CREATE FUNCTION eoms.security_operator_context(session_hash text,target uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE a record; result jsonb;
BEGIN
 SELECT * INTO a FROM eoms.auth_session(session_hash);
 IF a.id IS NULL THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000'; END IF;
 IF NOT eoms.security_operator_allowed(a.id) THEN
  IF target IS NOT NULL THEN RAISE EXCEPTION 'Explicit security operator required' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('allowed',false);
 END IF;
 IF target IS NULL THEN RETURN jsonb_build_object('allowed',true); END IF;
 SELECT jsonb_build_object('id',u.id,'name',u.display_name,'active',u.active,'revision',coalesce((SELECT max(e.id)::text FROM eoms.security_events e WHERE e.subject_id=u.id),'0'),'sessionCount',(SELECT count(*) FROM eoms.sessions s WHERE s.user_id=u.id AND s.expires_at>now() AND s.last_seen_at>now()-interval '30 minutes')) INTO result FROM eoms.users u WHERE u.id=target;
 IF result IS NULL THEN RAISE EXCEPTION 'Named account unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('allowed',true,'target',result);
END $$;
CREATE FUNCTION eoms.security_operator_revoke(session_hash text,csrf_proof text,target uuid,expected_revision bigint,retry_key uuid,reference_value text,reason_value text,request_ref uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE uid uuid; a record; payload jsonb; prior eoms.security_receipts%ROWTYPE; current_revision bigint; n integer; eid bigint; answer jsonb;
BEGIN
 SELECT user_id INTO uid FROM eoms.sessions WHERE token_hash=session_hash;
 IF uid IS NULL THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000'; END IF;
 -- Both user locks have one stable order, including two operators targeting each other.
 PERFORM 1 FROM eoms.users u WHERE u.id IN (uid,target) ORDER BY u.id FOR UPDATE;
 SELECT * INTO a FROM eoms.auth_session(session_hash);
 IF a.id IS NULL OR a.csrf IS DISTINCT FROM csrf_proof THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000'; END IF;
 IF NOT eoms.security_operator_allowed(uid) THEN RAISE EXCEPTION 'Explicit security operator required' USING ERRCODE='42501'; END IF;
 IF target=uid OR retry_key IS NULL OR length(reference_value) NOT BETWEEN 5 AND 200 OR length(reason_value) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'Invalid revocation' USING ERRCODE='22023'; END IF;
 payload=jsonb_build_object('kind','operator-revoke','target',target,'revision',expected_revision,'reference',reference_value,'reason',reason_value);
 SELECT * INTO prior FROM eoms.security_receipts WHERE subject_id=uid AND key=retry_key;
 IF FOUND THEN
  IF prior.payload<>payload THEN RAISE EXCEPTION 'Changed retry' USING ERRCODE='40001'; END IF;
  RETURN prior.result||jsonb_build_object('replayed',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM eoms.users WHERE id=target) THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(id),0) INTO current_revision FROM eoms.security_events WHERE subject_id=target;
 IF current_revision<>expected_revision THEN RAISE EXCEPTION 'Account changed; refresh preview' USING ERRCODE='40001'; END IF;
 DELETE FROM eoms.sessions WHERE user_id=target;GET DIAGNOSTICS n=ROW_COUNT;
 INSERT INTO eoms.security_events(subject_id,actor_id,action,request_id,detail)
 VALUES(target,uid,'admin.sessions-revoked',request_ref,jsonb_build_object('count',n,'reference',reference_value,'reason',reason_value)) RETURNING id INTO eid;
 INSERT INTO eoms.security_events(subject_id,actor_id,action,request_id,detail)
 VALUES(uid,uid,'admin.revocation-recorded',request_ref,jsonb_build_object('eventId',eid::text,'target',target,'count',n,'reference',reference_value,'reason',reason_value));
 answer=jsonb_build_object('eventId',eid::text,'count',n,'requestId',request_ref,'replayed',false);
 INSERT INTO eoms.security_receipts(subject_id,key,payload,result) VALUES(uid,retry_key,payload,answer);
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION eoms.security_operator_context(text,uuid),eoms.security_operator_revoke(text,text,uuid,bigint,uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.security_operator_context(text,uuid),eoms.security_operator_revoke(text,text,uuid,bigint,uuid,text,text,uuid) TO eoms_app;
