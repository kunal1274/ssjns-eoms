-- Reopen only an unaccepted registration; never reactivate an established identity.
CREATE FUNCTION eoms.registration_reopen_context(session_hash text,customer uuid,target uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE a record;
BEGIN
 SELECT * INTO a FROM eoms.auth_session(session_hash);
 IF a.id IS NULL THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000';END IF;
 IF NOT eoms.lifecycle_operator_allowed(a.id) OR NOT eoms.onboarding_allowed(a.id,customer) THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM eoms.users u JOIN eoms.user_registrations r ON r.user_id=u.id WHERE u.id=target AND u.id<>a.id AND NOT u.active AND u.lifecycle_state='deactivated' AND r.customer_id IS NOT DISTINCT FROM customer AND NOT EXISTS(SELECT 1 FROM eoms.user_invitations i WHERE i.user_id=u.id AND i.state='accepted') AND NOT EXISTS(SELECT 1 FROM eoms.memberships m WHERE m.user_id=u.id) AND NOT EXISTS(SELECT 1 FROM eoms.organization_admins g WHERE g.user_id=u.id));
END $$;
CREATE FUNCTION eoms.reopen_registration(session_hash text,csrf_proof text,input jsonb,retry_key uuid,request_ref uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE a record;uid uuid;customer uuid:=(input->>'customerId')::uuid;target uuid:=(input->>'targetId')::uuid;r eoms.user_registrations;prior eoms.security_receipts;payload jsonb;answer jsonb;eid bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(6543808);
 IF customer IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(customer::text,625));END IF;
 SELECT user_id INTO uid FROM eoms.sessions WHERE token_hash=session_hash;
 PERFORM 1 FROM eoms.users WHERE id IN(uid,target) ORDER BY id FOR UPDATE;
 SELECT * INTO a FROM eoms.auth_session(session_hash);
 IF a.id IS NULL OR a.csrf IS DISTINCT FROM csrf_proof THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000';END IF;
 IF NOT eoms.lifecycle_operator_allowed(a.id) OR NOT eoms.onboarding_allowed(a.id,customer) OR target=a.id THEN RAISE EXCEPTION 'Separate platform lifecycle and scoped onboarding authority required' USING ERRCODE='42501';END IF;
 IF retry_key IS NULL OR request_ref IS NULL OR input->>'reference' IS NULL OR length(trim(input->>'reference')) NOT BETWEEN 5 AND 200 OR input->>'reason' IS NULL OR length(trim(input->>'reason')) NOT BETWEEN 10 AND 500 OR input->>'reviewed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Reviewed registration recovery required' USING ERRCODE='22023';END IF;
 payload=jsonb_build_object('kind','onboarding.reopen','input',input);
 SELECT * INTO prior FROM eoms.security_receipts WHERE subject_id=uid AND key=retry_key;
 IF FOUND THEN IF prior.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Changed retry' USING ERRCODE='40001';END IF;RETURN prior.result||jsonb_build_object('replayed',true);END IF;
 SELECT * INTO r FROM eoms.user_registrations WHERE user_id=target AND customer_id IS NOT DISTINCT FROM customer FOR UPDATE;
 IF r.user_id IS NULL OR r.revision IS DISTINCT FROM (input->>'revision')::integer OR NOT eoms.registration_reopen_context(session_hash,customer,target) THEN RAISE EXCEPTION 'Registration changed or cannot be reopened' USING ERRCODE='40001';END IF;
 PERFORM set_config('app.user_id',uid::text,true);PERFORM set_config('app.request_id',request_ref::text,true);PERFORM set_config('app.change_reason',input->>'reason',true);
 UPDATE eoms.user_invitations SET state='superseded' WHERE user_id=target AND state='pending';
 UPDATE eoms.users SET lifecycle_state='staged',active=false WHERE id=target;
 UPDATE eoms.user_registrations SET revision=revision+1 WHERE user_id=target RETURNING * INTO r;
 answer=jsonb_build_object('targetId',target,'state','staged','revision',r.revision,'signInEnabled',false,'estateAccessGranted',false);
 INSERT INTO eoms.security_events(subject_id,actor_id,action,request_id,detail) VALUES(target,uid,'registration.reopen',request_ref,jsonb_build_object('customerId',customer,'reference',input->>'reference','reason',input->>'reason','beforeState','deactivated','afterState','staged','reviewed',true,'result',answer)) RETURNING id INTO eid;
 answer=answer||jsonb_build_object('eventId',eid::text,'requestId',request_ref,'replayed',false);
 INSERT INTO eoms.security_receipts(subject_id,key,payload,result) VALUES(uid,retry_key,payload,answer);RETURN answer;
END $$;
REVOKE ALL ON FUNCTION eoms.registration_reopen_context(text,uuid,uuid),eoms.reopen_registration(text,text,jsonb,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.registration_reopen_context(text,uuid,uuid),eoms.reopen_registration(text,text,jsonb,uuid,uuid) TO eoms_app;
