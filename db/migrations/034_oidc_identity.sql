CREATE TABLE eoms.identity_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),issuer text NOT NULL,subject text NOT NULL,
 user_id uuid NOT NULL REFERENCES eoms.users(id),active boolean NOT NULL DEFAULT true,
 reference text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(issuer,subject)
);
CREATE TABLE eoms.oidc_transactions(state_hash text PRIMARY KEY,binding_hash text NOT NULL,verifier text NOT NULL,nonce_hash text NOT NULL,expires_at timestamptz NOT NULL);
REVOKE ALL ON eoms.identity_links,eoms.oidc_transactions FROM PUBLIC,eoms_app;
CREATE FUNCTION eoms.identity_link_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
BEGIN
 INSERT INTO eoms.security_events(subject_id,action,detail) VALUES(NEW.user_id,'identity.link-changed',jsonb_build_object('operator',session_user,'reference',NEW.reference,'reason',NEW.reason,'active',NEW.active,'linkId',NEW.id));
 DELETE FROM eoms.sessions WHERE user_id=NEW.user_id AND auth_method='oidc';
 IF TG_OP='UPDATE' AND OLD.user_id<>NEW.user_id THEN DELETE FROM eoms.sessions WHERE user_id=OLD.user_id AND auth_method='oidc'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER identity_link_audit AFTER INSERT OR UPDATE ON eoms.identity_links FOR EACH ROW EXECUTE FUNCTION eoms.identity_link_audit();
CREATE FUNCTION eoms.begin_oidc(state_hash_value text,binding_hash_value text,verifier_value text,nonce_hash_value text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
BEGIN
 DELETE FROM eoms.oidc_transactions WHERE expires_at<now();
 INSERT INTO eoms.oidc_transactions VALUES(state_hash_value,binding_hash_value,verifier_value,nonce_hash_value,now()+interval '10 minutes');
END $$;
CREATE FUNCTION eoms.consume_oidc(state_hash_value text,binding_hash_value text)
RETURNS TABLE(verifier text,nonce_hash text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
 DELETE FROM eoms.oidc_transactions WHERE state_hash=state_hash_value AND binding_hash=binding_hash_value AND expires_at>now() RETURNING verifier,nonce_hash
$$;
CREATE FUNCTION eoms.open_oidc_session(issuer_value text,subject_value text,new_hash text,csrf_value text,previous_hash text,request_ref uuid)
RETURNS TABLE(id uuid,email text,display_name text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE uid uuid; sid uuid; link eoms.identity_links%ROWTYPE; u eoms.users%ROWTYPE;
BEGIN
 SELECT user_id INTO uid FROM eoms.identity_links WHERE issuer=issuer_value AND subject=subject_value AND active;
 IF uid IS NULL THEN RETURN; END IF;
 SELECT * INTO u FROM eoms.users WHERE eoms.users.id=uid FOR UPDATE;
 SELECT * INTO link FROM eoms.identity_links WHERE issuer=issuer_value AND subject=subject_value AND active FOR SHARE;
 IF NOT FOUND OR NOT u.active OR link.user_id<>uid THEN RETURN; END IF;
 IF new_hash !~ '^[a-f0-9]{64}$' OR csrf_value !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid token' USING ERRCODE='22023'; END IF;
 IF previous_hash IS NOT NULL THEN DELETE FROM eoms.sessions WHERE token_hash=previous_hash; END IF;
 INSERT INTO eoms.sessions(token_hash,user_id,csrf,expires_at,auth_method,mfa) VALUES(new_hash,uid,csrf_value,now()+interval '8 hours','oidc',true) RETURNING eoms.sessions.id INTO sid;
 INSERT INTO eoms.security_events(subject_id,actor_id,action,session_id,request_id,detail) VALUES(uid,uid,'sign-in.oidc',sid,request_ref,jsonb_build_object('mfa',true,'linkId',link.id));
 RETURN QUERY SELECT u.id,u.email,u.display_name;
END $$;
REVOKE ALL ON FUNCTION eoms.begin_oidc(text,text,text,text),eoms.consume_oidc(text,text),eoms.open_oidc_session(text,text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.begin_oidc(text,text,text,text),eoms.consume_oidc(text,text),eoms.open_oidc_session(text,text,text,text,text,uuid) TO eoms_app;
CREATE INDEX oidc_transaction_expiry ON eoms.oidc_transactions(expires_at);
