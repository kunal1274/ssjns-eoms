-- Sessions invalidated by a suspension or credential change cannot revive on restoration.
CREATE FUNCTION eoms.invalidate_credential_sessions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
BEGIN
  IF OLD.active IS DISTINCT FROM NEW.active OR OLD.password_hash IS DISTINCT FROM NEW.password_hash THEN
    DELETE FROM eoms.sessions WHERE user_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.invalidate_credential_sessions() FROM PUBLIC;
CREATE TRIGGER invalidate_credential_sessions AFTER UPDATE OF active,password_hash ON eoms.users
FOR EACH ROW EXECUTE FUNCTION eoms.invalidate_credential_sessions();

-- Runtime cannot lock user rows directly. This narrow function holds the user lock
-- until rotation commits, so suspension/reset cannot race the verified credential.
CREATE FUNCTION eoms.open_verified_session(subject uuid, verified_hash text, new_token_hash text, csrf_token text, previous_token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE u eoms.users%ROWTYPE;
BEGIN
  SELECT * INTO u FROM eoms.users WHERE id=subject FOR SHARE;
  IF NOT FOUND OR NOT u.active OR u.password_hash IS DISTINCT FROM verified_hash THEN
    RETURN false;
  END IF;
  IF new_token_hash !~ '^[a-f0-9]{64}$' OR csrf_token !~ '^[a-f0-9]{64}$'
     OR new_token_hash IS NULL OR csrf_token IS NULL THEN
    RAISE EXCEPTION 'Invalid session token' USING ERRCODE='22023';
  END IF;
  IF previous_token_hash IS NOT NULL THEN
    DELETE FROM eoms.sessions WHERE token_hash=previous_token_hash;
  END IF;
  INSERT INTO eoms.sessions(token_hash,user_id,csrf,expires_at)
    VALUES(new_token_hash,subject,csrf_token,now()+interval '8 hours');
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION eoms.open_verified_session(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.open_verified_session(uuid,text,text,text,text) TO eoms_app;
