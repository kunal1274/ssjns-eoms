CREATE TABLE eoms.recovery_tokens(token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES eoms.users(id),credential_version text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON eoms.recovery_tokens FROM PUBLIC,eoms_app;
CREATE FUNCTION eoms.open_local_session(subject uuid,verified_hash text,new_hash text,csrf_token text,previous_hash text,request_ref uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
BEGIN
 PERFORM set_config('app.request_id',request_ref::text,true);
 RETURN eoms.open_verified_session(subject,verified_hash,new_hash,csrf_token,previous_hash);
END $$;
CREATE FUNCTION eoms.change_local_credential(session_hash text,csrf_proof text,verified_hash text,replacement_hash text,request_ref uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE uid uuid; a record;
BEGIN
 SELECT user_id INTO uid FROM eoms.sessions WHERE token_hash=session_hash;
 IF uid IS NULL THEN RETURN false; END IF;
 PERFORM 1 FROM eoms.users WHERE id=uid FOR UPDATE;
 SELECT * INTO a FROM eoms.auth_session(session_hash);
 IF a.id IS NULL OR a.csrf IS DISTINCT FROM csrf_proof OR a.auth_method<>'local' THEN RETURN false; END IF;
 IF replacement_hash !~ '^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$' THEN RETURN false; END IF;
 PERFORM set_config('app.user_id',uid::text,true); PERFORM set_config('app.request_id',request_ref::text,true);
 UPDATE eoms.users SET password_hash=replacement_hash WHERE id=uid AND password_hash=verified_hash;
 IF NOT FOUND THEN RETURN false; END IF;
 DELETE FROM eoms.recovery_tokens WHERE user_id=uid;
 RETURN true;
END $$;
CREATE FUNCTION eoms.reset_local_credential(recovery_hash text,replacement_hash text,request_ref uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE uid uuid; r eoms.recovery_tokens%ROWTYPE; u eoms.users%ROWTYPE;
BEGIN
 SELECT user_id INTO uid FROM eoms.recovery_tokens WHERE token_hash=recovery_hash;
 IF uid IS NULL THEN RETURN false; END IF;
 SELECT * INTO u FROM eoms.users WHERE id=uid FOR UPDATE;
 SELECT * INTO r FROM eoms.recovery_tokens WHERE token_hash=recovery_hash FOR UPDATE;
 IF NOT FOUND OR NOT u.active OR r.expires_at<=now() OR r.credential_version<>u.password_hash OR replacement_hash !~ '^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$' THEN RETURN false; END IF;
 DELETE FROM eoms.recovery_tokens WHERE user_id=uid;
 PERFORM set_config('app.user_id','',true); PERFORM set_config('app.request_id',request_ref::text,true);
 UPDATE eoms.users SET password_hash=replacement_hash WHERE id=uid;
 INSERT INTO eoms.security_events(subject_id,action,request_id,detail) VALUES(uid,'recovery.completed',request_ref,jsonb_build_object('sessionsInvalidated',true));
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION eoms.open_local_session(uuid,text,text,text,text,uuid),eoms.change_local_credential(text,text,text,text,uuid),eoms.reset_local_credential(text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.open_local_session(uuid,text,text,text,text,uuid),eoms.change_local_credential(text,text,text,text,uuid),eoms.reset_local_credential(text,text,uuid) TO eoms_app;
CREATE FUNCTION eoms.recovery_requested(login_email text,request_ref uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
 INSERT INTO eoms.security_events(subject_id,action,request_id)
 SELECT (SELECT u.id FROM eoms.users u WHERE u.email=login_email),'recovery.requested',request_ref
$$;
REVOKE ALL ON FUNCTION eoms.recovery_requested(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.recovery_requested(text,uuid) TO eoms_app;
-- Neither a restored active flag nor a new credential revives an old recovery token.
CREATE OR REPLACE FUNCTION eoms.invalidate_credential_sessions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
BEGIN
 IF OLD.active IS DISTINCT FROM NEW.active OR OLD.password_hash IS DISTINCT FROM NEW.password_hash THEN
  INSERT INTO eoms.security_events(subject_id,actor_id,action,request_id,detail)
  VALUES(NEW.id,eoms.actor_id(),CASE WHEN OLD.active IS DISTINCT FROM NEW.active THEN 'account.active-changed' ELSE 'credential.changed' END,
    nullif(current_setting('app.request_id',true),'')::uuid,jsonb_build_object('active',NEW.active,'sessionsInvalidated',true,'recoveryTokensInvalidated',true));
  DELETE FROM eoms.sessions WHERE user_id=NEW.id;
  DELETE FROM eoms.recovery_tokens WHERE user_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
