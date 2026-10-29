-- F07: private session storage and append-only own-account security history.
ALTER TABLE eoms.sessions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN auth_method text NOT NULL DEFAULT 'local' CHECK(auth_method IN ('local','oidc')),
 ADD COLUMN mfa boolean NOT NULL DEFAULT false;
CREATE INDEX sessions_user_display ON eoms.sessions(user_id,id);
CREATE TABLE eoms.security_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 subject_id uuid REFERENCES eoms.users(id),
 actor_id uuid REFERENCES eoms.users(id),
 action text NOT NULL,
 session_id uuid,
 request_id uuid,
 detail jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_subject ON eoms.security_events(subject_id,id DESC);
-- Legacy rows have no trustworthy creation/last-use metadata. Revoke them rather
-- than presenting migration-time defaults as historical facts; record the actual cutover.
INSERT INTO eoms.security_events(subject_id,action,detail)
SELECT user_id,'sessions.security-upgrade',jsonb_build_object('count',count(*),'reason','Legacy session metadata unavailable; fresh authentication required') FROM eoms.sessions GROUP BY user_id;
DELETE FROM eoms.sessions;

CREATE FUNCTION eoms.security_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Security history is immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER security_event_immutable BEFORE UPDATE OR DELETE ON eoms.security_events
FOR EACH ROW EXECUTE FUNCTION eoms.security_event_immutable();
REVOKE ALL ON eoms.security_events FROM PUBLIC,eoms_app;
REVOKE ALL ON eoms.sessions FROM eoms_app;
REVOKE SELECT ON eoms.users FROM eoms_app;
GRANT SELECT(id,email,display_name,active) ON eoms.users TO eoms_app;
CREATE TABLE eoms.security_receipts(
 subject_id uuid NOT NULL REFERENCES eoms.users(id),key uuid NOT NULL,
 payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(subject_id,key)
);
REVOKE ALL ON eoms.security_receipts FROM PUBLIC,eoms_app;
CREATE TRIGGER security_receipt_immutable BEFORE UPDATE OR DELETE ON eoms.security_receipts
FOR EACH ROW EXECUTE FUNCTION eoms.security_event_immutable();
CREATE TABLE eoms.auth_attempt_buckets(bucket text NOT NULL,window_start timestamptz NOT NULL,count integer NOT NULL,PRIMARY KEY(bucket,window_start));
REVOKE ALL ON eoms.auth_attempt_buckets FROM PUBLIC,eoms_app;
CREATE FUNCTION eoms.auth_attempt_allowed(bucket_key text,maximum integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE n integer; w timestamptz=date_trunc('minute',now());
BEGIN
 IF bucket_key !~ '^[a-f0-9]{64}$' OR maximum NOT BETWEEN 1 AND 10000 THEN RETURN false; END IF;
 INSERT INTO eoms.auth_attempt_buckets VALUES(bucket_key,w,1)
 ON CONFLICT(bucket,window_start) DO UPDATE SET count=eoms.auth_attempt_buckets.count+1 RETURNING count INTO n;
 DELETE FROM eoms.auth_attempt_buckets WHERE window_start<now()-interval '2 hours';
 RETURN n<=maximum;
END $$;
CREATE FUNCTION eoms.login_credential(login_email text)
RETURNS TABLE(id uuid,email text,display_name text,password_hash text,active boolean)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
 SELECT u.id,u.email,u.display_name,u.password_hash,u.active FROM eoms.users u WHERE u.email=login_email AND length(login_email)<=254
$$;
CREATE FUNCTION eoms.auth_failure(login_email text,request_ref uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
 INSERT INTO eoms.security_events(subject_id,action,request_id)
 SELECT (SELECT u.id FROM eoms.users u WHERE u.email=login_email),'sign-in.denied',request_ref
$$;
CREATE FUNCTION eoms.auth_session(session_hash text,idle_seconds integer DEFAULT 1800)
RETURNS TABLE(id uuid,email text,display_name text,csrf text,session_id uuid,auth_method text,mfa boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE uid uuid; u eoms.users%ROWTYPE; s eoms.sessions%ROWTYPE;
BEGIN
 IF idle_seconds NOT BETWEEN 300 AND 28800 THEN RETURN; END IF;
 SELECT user_id INTO uid FROM eoms.sessions WHERE token_hash=session_hash;
 IF uid IS NULL THEN RETURN; END IF;
 SELECT * INTO u FROM eoms.users WHERE eoms.users.id=uid FOR SHARE;
 IF NOT u.active THEN RETURN; END IF;
 SELECT * INTO s FROM eoms.sessions WHERE token_hash=session_hash AND expires_at>now()
  AND last_seen_at>now()-make_interval(secs=>idle_seconds) FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF s.last_seen_at<now()-interval '30 seconds' THEN UPDATE eoms.sessions SET last_seen_at=now() WHERE token_hash=session_hash; END IF;
 RETURN QUERY SELECT u.id,u.email,u.display_name,s.csrf,s.id,s.auth_method,s.mfa;
END $$;
CREATE OR REPLACE FUNCTION eoms.invalidate_credential_sessions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
BEGIN
 IF OLD.active IS DISTINCT FROM NEW.active OR OLD.password_hash IS DISTINCT FROM NEW.password_hash THEN
  INSERT INTO eoms.security_events(subject_id,actor_id,action,request_id,detail)
  VALUES(NEW.id,eoms.actor_id(),CASE WHEN OLD.active IS DISTINCT FROM NEW.active THEN 'account.active-changed' ELSE 'credential.changed' END,
    nullif(current_setting('app.request_id',true),'')::uuid,jsonb_build_object('active',NEW.active,'sessionsInvalidated',true));
  DELETE FROM eoms.sessions WHERE user_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
-- Keep the old narrow issuance signature for upgrade consumers; add actual audit.
CREATE OR REPLACE FUNCTION eoms.open_verified_session(subject uuid,verified_hash text,new_token_hash text,csrf_token text,previous_token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE u eoms.users%ROWTYPE; sid uuid;
BEGIN
 SELECT * INTO u FROM eoms.users WHERE id=subject FOR UPDATE;
 IF NOT FOUND OR NOT u.active OR u.password_hash IS DISTINCT FROM verified_hash THEN RETURN false; END IF;
 IF new_token_hash IS NULL OR csrf_token IS NULL OR new_token_hash !~ '^[a-f0-9]{64}$' OR csrf_token !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid session token' USING ERRCODE='22023'; END IF;
 -- The presented prior token is a bearer capability; no other sessions are inferred.
 IF previous_token_hash IS NOT NULL THEN DELETE FROM eoms.sessions WHERE token_hash=previous_token_hash; END IF;
 INSERT INTO eoms.sessions(token_hash,user_id,csrf,expires_at) VALUES(new_token_hash,subject,csrf_token,now()+interval '8 hours') RETURNING id INTO sid;
 INSERT INTO eoms.security_events(subject_id,actor_id,action,session_id,request_id)
 VALUES(subject,subject,'sign-in.local',sid,nullif(current_setting('app.request_id',true),'')::uuid);
 RETURN true;
END $$;
CREATE FUNCTION eoms.account_security(session_hash text,view_kind text,after_id text DEFAULT NULL,page_size integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE a record; rows jsonb;
BEGIN
 SELECT * INTO a FROM eoms.auth_session(session_hash);
 IF a.id IS NULL THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000'; END IF;
 IF page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='22023'; END IF;
 IF view_kind='sessions' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]') INTO rows FROM (
   SELECT s.id,s.created_at,s.last_seen_at,s.expires_at,s.auth_method,s.mfa,s.id=a.session_id AS current
   FROM eoms.sessions s WHERE s.user_id=a.id AND s.expires_at>now() AND s.last_seen_at>now()-interval '30 minutes'
   AND (after_id IS NULL OR s.id>after_id::uuid) ORDER BY s.id LIMIT page_size+1
  ) q;
 ELSIF view_kind='events' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id::bigint DESC),'[]') INTO rows FROM (
   SELECT e.id::text,e.action,e.session_id,e.request_id,e.detail,e.created_at,e.actor_id FROM eoms.security_events e
   WHERE e.subject_id=a.id AND (after_id IS NULL OR e.id<after_id::bigint) ORDER BY e.id DESC LIMIT page_size+1
  ) q;
 ELSE RAISE EXCEPTION 'Invalid view' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('items',rows,'actorId',a.id,'currentSessionId',a.session_id);
END $$;
CREATE FUNCTION eoms.revoke_account_sessions(session_hash text,csrf_proof text,retry_key uuid,target_id uuid,all_others boolean,request_ref uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE uid uuid; a record; prior eoms.security_receipts%ROWTYPE; payload jsonb; answer jsonb; count_revoked integer; eid bigint;
BEGIN
 SELECT user_id INTO uid FROM eoms.sessions WHERE token_hash=session_hash;
 IF uid IS NULL THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000'; END IF;
 PERFORM 1 FROM eoms.users WHERE id=uid FOR UPDATE;
 SELECT * INTO a FROM eoms.auth_session(session_hash);
 IF a.id IS NULL OR a.csrf IS DISTINCT FROM csrf_proof THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000'; END IF;
 IF retry_key IS NULL OR (all_others AND target_id IS NOT NULL) OR (NOT all_others AND target_id IS NULL) THEN RAISE EXCEPTION 'Invalid revocation' USING ERRCODE='22023'; END IF;
 payload=jsonb_build_object('targetId',target_id,'allOthers',all_others);
 SELECT * INTO prior FROM eoms.security_receipts WHERE subject_id=uid AND key=retry_key;
 IF FOUND THEN
  IF prior.payload<>payload THEN RAISE EXCEPTION 'Changed retry' USING ERRCODE='40001'; END IF;
  RETURN prior.result||jsonb_build_object('replayed',true);
 END IF;
 -- Current-device logout uses its dedicated endpoint and device-draft coordination.
 IF target_id=a.session_id THEN RAISE EXCEPTION 'Use sign out for this device' USING ERRCODE='22023'; END IF;
 IF NOT all_others AND NOT EXISTS(SELECT 1 FROM eoms.sessions WHERE user_id=uid AND id=target_id) THEN RAISE EXCEPTION 'Session unavailable' USING ERRCODE='42501'; END IF;
 DELETE FROM eoms.sessions WHERE user_id=uid AND id<>a.session_id AND (all_others OR id=target_id);
 GET DIAGNOSTICS count_revoked=ROW_COUNT;
 INSERT INTO eoms.security_events(subject_id,actor_id,action,session_id,request_id,detail)
 VALUES(uid,uid,CASE WHEN all_others THEN 'sessions.others-revoked' ELSE 'session.revoked' END,target_id,request_ref,jsonb_build_object('count',count_revoked)) RETURNING id INTO eid;
 answer=jsonb_build_object('eventId',eid::text,'count',count_revoked,'requestId',request_ref,'replayed',false,'currentSessionRetained',true);
 INSERT INTO eoms.security_receipts(subject_id,key,payload,result) VALUES(uid,retry_key,payload,answer);
 RETURN answer;
END $$;
CREATE FUNCTION eoms.close_session(session_hash text,request_ref uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE uid uuid; sid uuid;
BEGIN
 SELECT user_id INTO uid FROM eoms.sessions WHERE token_hash=session_hash;
 IF uid IS NULL THEN RETURN; END IF;
 PERFORM 1 FROM eoms.users WHERE id=uid FOR UPDATE;
 DELETE FROM eoms.sessions WHERE token_hash=session_hash RETURNING id INTO sid;
 IF sid IS NOT NULL THEN INSERT INTO eoms.security_events(subject_id,actor_id,action,session_id,request_id) VALUES(uid,uid,'session.signed-out',sid,request_ref); END IF;
END $$;
REVOKE ALL ON FUNCTION eoms.auth_attempt_allowed(text,integer),eoms.login_credential(text),eoms.auth_failure(text,uuid),eoms.auth_session(text,integer),eoms.account_security(text,text,text,integer),eoms.revoke_account_sessions(text,text,uuid,uuid,boolean,uuid),eoms.close_session(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.auth_attempt_allowed(text,integer),eoms.login_credential(text),eoms.auth_failure(text,uuid),eoms.auth_session(text,integer),eoms.account_security(text,text,text,integer),eoms.revoke_account_sessions(text,text,uuid,uuid,boolean,uuid),eoms.close_session(text,uuid) TO eoms_app;
CREATE INDEX auth_attempt_window ON eoms.auth_attempt_buckets(window_start);
CREATE FUNCTION eoms.close_all_sessions(session_hash text,csrf_proof text,request_ref uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE uid uuid; a record; n integer;
BEGIN
 SELECT user_id INTO uid FROM eoms.sessions WHERE token_hash=session_hash;
 IF uid IS NULL THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000'; END IF;
 PERFORM 1 FROM eoms.users WHERE id=uid FOR UPDATE;
 SELECT * INTO a FROM eoms.auth_session(session_hash);
 IF a.id IS NULL OR a.csrf IS DISTINCT FROM csrf_proof THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000'; END IF;
 DELETE FROM eoms.sessions WHERE user_id=uid; GET DIAGNOSTICS n=ROW_COUNT;
 INSERT INTO eoms.security_events(subject_id,actor_id,action,request_id,detail) VALUES(uid,uid,'sessions.all-signed-out',request_ref,jsonb_build_object('count',n));
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION eoms.close_all_sessions(text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.close_all_sessions(text,text,uuid) TO eoms_app;

CREATE FUNCTION eoms.external_security_event(event_action text,request_ref uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
BEGIN
 IF event_action NOT IN ('oidc.callback-denied','sign-in.rate-limited') THEN RAISE EXCEPTION 'Invalid event' USING ERRCODE='22023'; END IF;
 INSERT INTO eoms.security_events(action,request_id) VALUES(event_action,request_ref);
END $$;
REVOKE ALL ON FUNCTION eoms.external_security_event(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.external_security_event(text,uuid) TO eoms_app;
