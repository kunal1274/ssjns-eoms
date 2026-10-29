-- New staged identities have no usable credential or operational grant.
ALTER TABLE eoms.users DROP CONSTRAINT users_lifecycle_state_check;
ALTER TABLE eoms.users ADD CONSTRAINT users_lifecycle_state_check CHECK(lifecycle_state IN ('active','suspended','deactivated','staged'));
CREATE TABLE eoms.user_registrations(
 user_id uuid PRIMARY KEY REFERENCES eoms.users(id),customer_id uuid REFERENCES eoms.customers(id),
 user_code text NOT NULL,employee_reference text NOT NULL,proposed_estates jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES eoms.users(id),authority_revision text NOT NULL,revision integer NOT NULL DEFAULT 1,
 reference text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(customer_id,user_code)
);
CREATE TABLE eoms.user_invitations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES eoms.user_registrations(user_id),
 token_hash text NOT NULL UNIQUE,method text NOT NULL CHECK(method IN ('local','oidc')),issuer text,subject text,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','cancelled','accepted','superseded')),
 expires_at timestamptz NOT NULL,created_by uuid NOT NULL REFERENCES eoms.users(id),authority_revision text NOT NULL,
 reference text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),accepted_at timestamptz
);
CREATE TABLE eoms.customer_user_access(
 customer_id uuid NOT NULL REFERENCES eoms.customers(id),user_id uuid NOT NULL REFERENCES eoms.users(id),
 state text NOT NULL CHECK(state IN ('active','suspended','deactivated')),revision integer NOT NULL DEFAULT 1,
 retained_estates jsonb NOT NULL DEFAULT '[]',PRIMARY KEY(customer_id,user_id)
);
REVOKE ALL ON eoms.user_registrations,eoms.user_invitations,eoms.customer_user_access FROM PUBLIC,eoms_app;
CREATE FUNCTION eoms.onboarding_allowed(subject uuid,customer uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
 SELECT EXISTS(SELECT 1 FROM eoms.users WHERE id=subject AND active) AND CASE WHEN customer IS NULL THEN eoms.lifecycle_operator_allowed(subject) ELSE EXISTS(SELECT 1 FROM eoms.organization_admins WHERE customer_id=customer AND user_id=subject) END
$$;
CREATE FUNCTION eoms.onboarding_revision(subject uuid,customer uuid) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
 SELECT coalesce((SELECT max(id) FROM eoms.mapping_policy_scope_events WHERE subject_id=subject AND (kind='user-active' OR customer_id=customer OR estate_id IN(SELECT id FROM eoms.estates WHERE customer_id=customer))),0)::text||':'||CASE WHEN customer IS NULL THEN coalesce((SELECT max(id) FROM eoms.platform_lifecycle_authority WHERE subject_id=subject),0) ELSE 0 END::text
$$;
REVOKE ALL ON FUNCTION eoms.onboarding_allowed(uuid,uuid),eoms.onboarding_revision(uuid,uuid) FROM PUBLIC;
CREATE FUNCTION eoms.onboarding_context(session_hash text,customer uuid DEFAULT NULL,target uuid DEFAULT NULL,history_after bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE a record; answer jsonb; r eoms.user_registrations; access eoms.customer_user_access;
BEGIN
 SELECT * INTO a FROM eoms.auth_session(session_hash);IF a.id IS NULL THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000';END IF;
 IF customer IS NULL AND target IS NULL THEN
  RETURN jsonb_build_object('global',eoms.lifecycle_operator_allowed(a.id),'customers',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) ORDER BY c.id) FROM eoms.organization_admins g JOIN eoms.customers c ON c.id=g.customer_id WHERE g.user_id=a.id),'[]'::jsonb));
 END IF;
 IF NOT eoms.onboarding_allowed(a.id,customer) THEN RAISE EXCEPTION 'Explicit customer or platform authority required' USING ERRCODE='42501';END IF;
 IF target IS NULL THEN RETURN jsonb_build_object('allowed',true); END IF;
 SELECT * INTO r FROM eoms.user_registrations WHERE user_id=target AND customer_id IS NOT DISTINCT FROM customer;
 IF NOT FOUND AND (customer IS NULL OR NOT EXISTS(SELECT 1 FROM eoms.memberships m JOIN eoms.estates e ON e.id=m.estate_id WHERE m.user_id=target AND e.customer_id=customer) AND NOT EXISTS(SELECT 1 FROM eoms.customer_user_access WHERE user_id=target AND customer_id=customer)) THEN RAISE EXCEPTION 'Scoped user unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO access FROM eoms.customer_user_access WHERE customer_id=customer AND user_id=target;
 SELECT jsonb_build_object('id',u.id,'name',u.display_name,'email',u.email,'state',u.lifecycle_state,'registrationRevision',r.revision,
 'userCode',r.user_code,'employeeReference',r.employee_reference,'proposedEstates',r.proposed_estates,
 'retainedAssignments',coalesce(access.retained_estates,'[]'::jsonb),'accessState',coalesce(access.state,CASE WHEN customer IS NULL THEN 'unassigned' WHEN u.lifecycle_state='staged' THEN 'pending-activation' ELSE 'active' END),'accessRevision',coalesce(access.revision,0),'scopeRevision',eoms.onboarding_revision(target,customer),
 'assignments',coalesce((SELECT jsonb_agg(jsonb_build_object('estateId',e.id,'name',e.name,'role',m.role) ORDER BY e.id) FROM eoms.memberships m JOIN eoms.estates e ON e.id=m.estate_id WHERE m.user_id=u.id AND e.customer_id=customer),'[]'::jsonb),
 'invitations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'state',i.state,'method',i.method,'expiresAt',i.expires_at,'createdAt',i.created_at) ORDER BY i.created_at DESC) FROM (SELECT * FROM eoms.user_invitations WHERE user_id=u.id AND r.user_id IS NOT NULL ORDER BY created_at DESC LIMIT 25)i),'[]'::jsonb),
 'history',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id::bigint DESC) FROM(SELECT id::text,actor_id,action,request_id,created_at,detail FROM eoms.security_events WHERE subject_id=u.id AND (detail->>'customerId') IS NOT DISTINCT FROM customer::text AND action LIKE 'registration.%' AND (history_after IS NULL OR id<history_after) ORDER BY id DESC LIMIT 26)h),'[]'::jsonb)) INTO answer FROM eoms.users u WHERE u.id=target;
 RETURN answer;
END $$;
CREATE FUNCTION eoms.onboarding_write(session_hash text,csrf_proof text,operation text,input jsonb,retry_key uuid,request_ref uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE uid uuid;a record;customer uuid:=(input->>'customerId')::uuid;target uuid:=(input->>'targetId')::uuid;u eoms.users%ROWTYPE;r eoms.user_registrations;i eoms.user_invitations;access eoms.customer_user_access;prior eoms.security_receipts;payload jsonb;answer jsonb;proposal jsonb;item jsonb;eid bigint;email_value text;scope_marker text;before_assignments jsonb;before_identity jsonb;after_identity jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(6543808);
 IF customer IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(customer::text,625));END IF;
 SELECT user_id INTO uid FROM eoms.sessions WHERE token_hash=session_hash;IF uid IS NULL THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000';END IF;
 PERFORM 1 FROM eoms.users WHERE id IN(uid,target) ORDER BY id FOR UPDATE;
 SELECT * INTO a FROM eoms.auth_session(session_hash);IF a.id IS NULL OR a.csrf IS DISTINCT FROM csrf_proof THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000';END IF;
 IF NOT eoms.onboarding_allowed(uid,customer) THEN RAISE EXCEPTION 'Explicit scoped authority required' USING ERRCODE='42501';END IF;
 IF operation NOT IN ('stage','amend','invite','cancel','access','assign') OR retry_key IS NULL OR request_ref IS NULL OR jsonb_typeof(input)<>'object' OR length(trim(input->>'reference')) NOT BETWEEN 5 AND 200 OR length(trim(input->>'reason')) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'Bounded onboarding intent required' USING ERRCODE='22023';END IF;
 payload=jsonb_build_object('kind','onboarding.'||operation,'input',input);
 SELECT * INTO prior FROM eoms.security_receipts WHERE subject_id=uid AND key=retry_key;
 IF FOUND THEN IF prior.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Changed retry' USING ERRCODE='40001';END IF;RETURN prior.result||jsonb_build_object('replayed',true);END IF;
 PERFORM set_config('app.user_id',uid::text,true);PERFORM set_config('app.request_id',request_ref::text,true);PERFORM set_config('app.change_reason',input->>'reason',true);
 scope_marker=eoms.onboarding_revision(uid,customer);
 IF operation IN ('stage','amend') THEN
  IF operation='amend' THEN SELECT * INTO u FROM eoms.users WHERE id=target;SELECT * INTO r FROM eoms.user_registrations WHERE user_id=target AND customer_id IS NOT DISTINCT FROM customer FOR UPDATE;IF r.user_id IS NULL OR u.lifecycle_state<>'staged' OR r.revision<>(input->>'revision')::integer THEN RAISE EXCEPTION 'Staged registration changed' USING ERRCODE='40001';END IF;END IF;
  IF operation='amend' THEN before_identity=jsonb_build_object('name',u.display_name,'email',u.email,'userCode',r.user_code,'employeeReference',r.employee_reference);END IF;
  email_value=lower(trim(input->>'email'));proposal=input->'estates';
  IF email_value IS NULL OR email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(email_value)>254 OR length(trim(input->>'name')) NOT BETWEEN 1 AND 160 OR length(trim(input->>'userCode')) NOT BETWEEN 1 AND 50 OR length(trim(input->>'employeeReference')) NOT BETWEEN 1 AND 100 OR jsonb_typeof(proposal)<>'array' OR jsonb_array_length(proposal)>100 THEN RAISE EXCEPTION 'Invalid registration' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM eoms.users WHERE lower(trim(email))=email_value AND (operation='stage' OR id<>target)) THEN RAISE EXCEPTION 'Identity already exists; no merge or reassignment' USING ERRCODE='23505';END IF;
  IF customer IS NULL AND jsonb_array_length(proposal)>0 THEN RAISE EXCEPTION 'Platform registration grants no estate access' USING ERRCODE='42501';END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(proposal))<>(SELECT count(DISTINCT x->>'estateId') FROM jsonb_array_elements(proposal)x) THEN RAISE EXCEPTION 'Duplicate estates' USING ERRCODE='22023';END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(proposal) LOOP
   IF item->>'role' NOT IN ('manager','supervisor','clerk') THEN RAISE EXCEPTION 'Invalid estate role' USING ERRCODE='22023';END IF;PERFORM id FROM eoms.estates WHERE id=(item->>'estateId')::uuid AND customer_id=customer AND active FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Estate outside approved customer scope' USING ERRCODE='42501';END IF;
  END LOOP;
  IF operation='stage' THEN
   INSERT INTO eoms.users(email,display_name,password_hash,active,lifecycle_state) VALUES(email_value,trim(input->>'name'),'staged-no-credential',false,'staged') RETURNING * INTO u;target=u.id;
   INSERT INTO eoms.user_registrations(user_id,customer_id,user_code,employee_reference,proposed_estates,created_by,authority_revision,reference,reason) VALUES(target,customer,trim(input->>'userCode'),trim(input->>'employeeReference'),proposal,uid,scope_marker,input->>'reference',input->>'reason') RETURNING * INTO r;
  ELSE
   before_assignments=r.proposed_estates;
   UPDATE eoms.users SET email=email_value,display_name=trim(input->>'name') WHERE id=target;
   UPDATE eoms.user_registrations SET user_code=trim(input->>'userCode'),employee_reference=trim(input->>'employeeReference'),proposed_estates=proposal,revision=revision+1 WHERE user_id=target RETURNING * INTO r;
   UPDATE eoms.user_invitations SET state='superseded' WHERE user_id=target AND state='pending';
  END IF;
  after_identity=jsonb_build_object('name',trim(input->>'name'),'email',email_value,'userCode',trim(input->>'userCode'),'employeeReference',trim(input->>'employeeReference'));
  answer=jsonb_build_object('targetId',target,'state','staged','revision',r.revision);
 ELSE
  SELECT * INTO u FROM eoms.users WHERE id=target;SELECT * INTO r FROM eoms.user_registrations WHERE user_id=target AND customer_id IS NOT DISTINCT FROM customer FOR UPDATE;
  IF operation IN ('invite','cancel') THEN
   IF r.user_id IS NULL OR u.lifecycle_state<>'staged' OR r.revision<>(input->>'revision')::integer THEN RAISE EXCEPTION 'Staged registration changed' USING ERRCODE='40001';END IF;
   IF operation='invite' THEN
    IF input->>'tokenHash' IS NULL OR input->>'tokenHash' !~ '^[a-f0-9]{64}$' OR input->>'method' NOT IN ('local','oidc') OR ((input->>'method'='oidc') AND (length(input->>'issuer') NOT BETWEEN 1 AND 2048 OR length(input->>'subject') NOT BETWEEN 1 AND 255)) THEN RAISE EXCEPTION 'Explicit invitation proof and method required' USING ERRCODE='22023';END IF;
    UPDATE eoms.user_invitations SET state='superseded' WHERE user_id=target AND state='pending';
    INSERT INTO eoms.user_invitations(user_id,token_hash,method,issuer,subject,expires_at,created_by,authority_revision,reference,reason) VALUES(target,input->>'tokenHash',input->>'method',input->>'issuer',input->>'subject',now()+interval '24 hours',uid,scope_marker,input->>'reference',input->>'reason') RETURNING * INTO i;
   ELSE
    UPDATE eoms.user_invitations SET state='cancelled' WHERE user_id=target AND id=(input->>'invitationId')::uuid AND state='pending' RETURNING * INTO i;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invitation changed' USING ERRCODE='40001';END IF;
   END IF;
   UPDATE eoms.user_registrations SET revision=revision+1 WHERE user_id=target RETURNING * INTO r;
   answer=jsonb_build_object('targetId',target,'revision',r.revision,'invitationId',i.id,'state',i.state,'expiresAt',i.expires_at,'delivery','prepared-not-sent');
  ELSE
   IF customer IS NULL OR target=uid OR NOT u.active OR EXISTS(SELECT 1 FROM eoms.organization_admins WHERE customer_id=customer AND user_id=target) THEN RAISE EXCEPTION 'Separate non-setup user in this customer required' USING ERRCODE='42501';END IF;
   SELECT * INTO access FROM eoms.customer_user_access WHERE customer_id=customer AND user_id=target FOR UPDATE;
   IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM eoms.memberships m JOIN eoms.estates e ON e.id=m.estate_id WHERE m.user_id=target AND e.customer_id=customer) THEN RAISE EXCEPTION 'Scoped user unavailable' USING ERRCODE='42501';END IF;
   IF coalesce(access.revision,0)<>(input->>'revision')::integer OR input->>'scopeRevision' IS DISTINCT FROM eoms.onboarding_revision(target,customer) OR (operation='access' AND (input->>'state'=coalesce(access.state,'active') OR input->>'state' NOT IN ('active','suspended','deactivated'))) THEN RAISE EXCEPTION 'Access changed or invalid state' USING ERRCODE='40001';END IF;
   SELECT coalesce(jsonb_agg(jsonb_build_object('estateId',m.estate_id,'role',m.role) ORDER BY m.estate_id),'[]'::jsonb) INTO before_assignments FROM eoms.memberships m JOIN eoms.estates e ON e.id=m.estate_id WHERE m.user_id=target AND e.customer_id=customer;
   IF coalesce(access.state,'active')<>'active' THEN before_assignments=access.retained_estates;END IF;
   IF operation='assign' THEN
    proposal=input->'estates';
    IF jsonb_typeof(proposal)<>'array' OR jsonb_array_length(proposal)>100 OR (SELECT count(*) FROM jsonb_array_elements(proposal))<>(SELECT count(DISTINCT x->>'estateId') FROM jsonb_array_elements(proposal)x) THEN RAISE EXCEPTION 'Exact unique estate assignments required' USING ERRCODE='22023';END IF;
    FOR item IN SELECT * FROM jsonb_array_elements(proposal) LOOP
     IF item->>'role' NOT IN ('manager','supervisor','clerk') THEN RAISE EXCEPTION 'Invalid estate role' USING ERRCODE='22023';END IF;PERFORM id FROM eoms.estates WHERE id=(item->>'estateId')::uuid AND customer_id=customer AND active FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Estate outside customer' USING ERRCODE='42501';END IF;
    END LOOP;
    IF coalesce(access.state,'active')='active' THEN
     DELETE FROM eoms.memberships m USING eoms.estates e WHERE m.estate_id=e.id AND m.user_id=target AND e.customer_id=customer;
     FOR item IN SELECT * FROM jsonb_array_elements(proposal) LOOP INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES(target,(item->>'estateId')::uuid,item->>'role');END LOOP;
    END IF;
    input=input||jsonb_build_object('state',coalesce(access.state,'active'));
   ELSIF input->>'state'='active' THEN
    proposal=access.retained_estates;
    FOR item IN SELECT * FROM jsonb_array_elements(proposal) LOOP
     PERFORM id FROM eoms.estates WHERE id=(item->>'estateId')::uuid AND customer_id=customer AND active FOR SHARE;
     IF NOT FOUND OR EXISTS(SELECT 1 FROM eoms.memberships WHERE user_id=target AND estate_id=(item->>'estateId')::uuid) THEN RAISE EXCEPTION 'Retained assignments changed; reconcile first' USING ERRCODE='40001';END IF;
     INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES(target,(item->>'estateId')::uuid,item->>'role');
    END LOOP;
   ELSE
    IF coalesce(access.state,'active')='active' THEN SELECT coalesce(jsonb_agg(jsonb_build_object('estateId',m.estate_id,'role',m.role) ORDER BY m.estate_id),'[]'::jsonb) INTO proposal FROM eoms.memberships m JOIN eoms.estates e ON e.id=m.estate_id WHERE m.user_id=target AND e.customer_id=customer;ELSE proposal=access.retained_estates;END IF;
    DELETE FROM eoms.memberships m USING eoms.estates e WHERE m.estate_id=e.id AND m.user_id=target AND e.customer_id=customer;
   END IF;
   INSERT INTO eoms.customer_user_access(customer_id,user_id,state,revision,retained_estates) VALUES(customer,target,input->>'state',coalesce(access.revision,0)+1,proposal) ON CONFLICT(customer_id,user_id) DO UPDATE SET state=excluded.state,revision=excluded.revision,retained_estates=excluded.retained_estates RETURNING * INTO access;
   answer=jsonb_build_object('targetId',target,'state',access.state,'accessRevision',access.revision,'globalAccountChanged',false);
  END IF;
 END IF;
 INSERT INTO eoms.security_events(subject_id,actor_id,action,request_id,detail) VALUES(target,uid,'registration.'||operation,request_ref,jsonb_build_object('customerId',customer,'reference',input->>'reference','reason',input->>'reason','result',answer,'beforeIdentity',before_identity,'afterIdentity',after_identity,'beforeAssignments',before_assignments,'afterAssignments',CASE WHEN operation IN ('assign','access') THEN proposal WHEN operation IN ('stage','amend') THEN input->'estates' ELSE NULL END)) RETURNING id INTO eid;
 answer=answer||jsonb_build_object('eventId',eid::text,'requestId',request_ref,'replayed',false);
 INSERT INTO eoms.security_receipts(subject_id,key,payload,result) VALUES(uid,retry_key,payload,answer);RETURN answer;
END $$;
CREATE FUNCTION eoms.accept_user_invitation(proof_hash text,method_value text,credential text,issuer_value text,subject_value text,request_ref uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE i eoms.user_invitations;r eoms.user_registrations;u eoms.users%ROWTYPE;item jsonb;eid bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(6543808);
 SELECT * INTO i FROM eoms.user_invitations WHERE token_hash=proof_hash;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='22023';END IF;
 SELECT * INTO r FROM eoms.user_registrations WHERE user_id=i.user_id;
 IF r.customer_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(r.customer_id::text,625));END IF;
 PERFORM 1 FROM eoms.users WHERE id IN(i.user_id,i.created_by) ORDER BY id FOR UPDATE;
 SELECT * INTO u FROM eoms.users WHERE id=i.user_id;
 IF i.state<>'pending' OR i.expires_at<=now() OR i.method<>method_value OR u.lifecycle_state<>'staged' OR NOT eoms.onboarding_allowed(i.created_by,r.customer_id) OR i.authority_revision<>eoms.onboarding_revision(i.created_by,r.customer_id) THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='22023';END IF;
 IF method_value='local' THEN
  IF credential IS NULL OR credential !~ '^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$' THEN RAISE EXCEPTION 'Credential required' USING ERRCODE='22023';END IF;
 ELSE
  IF method_value<>'oidc' OR issuer_value IS DISTINCT FROM i.issuer OR subject_value IS DISTINCT FROM i.subject THEN RAISE EXCEPTION 'Explicit identity not matched' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM eoms.identity_links WHERE issuer=issuer_value AND subject=subject_value AND user_id<>u.id) THEN RAISE EXCEPTION 'Identity already linked' USING ERRCODE='23505';END IF;
 END IF;
 PERFORM set_config('app.user_id',u.id::text,true);PERFORM set_config('app.request_id',request_ref::text,true);
 PERFORM set_config('app.enrollment_activation',u.id::text,true);
 UPDATE eoms.users SET active=true,lifecycle_state='active',password_hash=CASE WHEN method_value='local' THEN credential ELSE password_hash END WHERE id=u.id;
 IF method_value='oidc' THEN INSERT INTO eoms.identity_links(issuer,subject,user_id,reference,reason) VALUES(issuer_value,subject_value,u.id,i.reference,i.reason) ON CONFLICT(issuer,subject) DO UPDATE SET active=true,reference=excluded.reference,reason=excluded.reason;END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(r.proposed_estates) LOOP
  PERFORM id FROM eoms.estates WHERE id=(item->>'estateId')::uuid AND customer_id=r.customer_id AND active FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Assigned estate unavailable' USING ERRCODE='40001';END IF;
  INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES(u.id,(item->>'estateId')::uuid,item->>'role');
 END LOOP;
 IF r.customer_id IS NOT NULL THEN INSERT INTO eoms.customer_user_access(customer_id,user_id,state,retained_estates) VALUES(r.customer_id,u.id,'active',r.proposed_estates);END IF;
 UPDATE eoms.user_invitations SET state='accepted',accepted_at=now() WHERE id=i.id;
 UPDATE eoms.user_registrations SET revision=revision+1 WHERE user_id=u.id;
 INSERT INTO eoms.security_events(subject_id,actor_id,action,request_id,detail) VALUES(u.id,u.id,'registration.accepted',request_ref,jsonb_build_object('customerId',r.customer_id,'invitationId',i.id,'method',method_value,'estatesGranted',r.proposed_estates,'reference',i.reference,'reason',i.reason)) RETURNING id INTO eid;
 RETURN jsonb_build_object('targetId',u.id,'eventId',eid::text,'requestId',request_ref,'state','active');
END $$;
ALTER TABLE eoms.oidc_transactions ADD COLUMN invitation_hash text;
CREATE FUNCTION eoms.begin_enrollment_oidc(state_value text,binding_value text,verifier_value text,nonce_value text,proof_hash text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM eoms.user_invitations WHERE token_hash=proof_hash AND method='oidc' AND state='pending' AND expires_at>now()) THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='22023';END IF;
 PERFORM eoms.begin_oidc(state_value,binding_value,verifier_value,nonce_value);UPDATE eoms.oidc_transactions SET invitation_hash=proof_hash WHERE state_hash=state_value;
END $$;
-- Preserve the existing begin_oidc column contract after adding the enrollment column.
CREATE OR REPLACE FUNCTION eoms.begin_oidc(state_hash_value text,binding_hash_value text,verifier_value text,nonce_hash_value text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
BEGIN DELETE FROM eoms.oidc_transactions WHERE expires_at<now();INSERT INTO eoms.oidc_transactions(state_hash,binding_hash,verifier,nonce_hash,expires_at) VALUES(state_hash_value,binding_hash_value,verifier_value,nonce_hash_value,now()+interval '10 minutes');END $$;
CREATE FUNCTION eoms.consume_enrollment_oidc(state_value text,binding_value text) RETURNS TABLE(verifier text,nonce_hash text,invitation_hash text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$ DELETE FROM eoms.oidc_transactions WHERE state_hash=state_value AND binding_hash=binding_value AND expires_at>now() RETURNING verifier,nonce_hash,invitation_hash $$;
REVOKE ALL ON FUNCTION eoms.onboarding_context(text,uuid,uuid,bigint),eoms.onboarding_write(text,text,text,jsonb,uuid,uuid),eoms.accept_user_invitation(text,text,text,text,text,uuid),eoms.begin_enrollment_oidc(text,text,text,text,text),eoms.consume_enrollment_oidc(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.onboarding_context(text,uuid,uuid,bigint),eoms.onboarding_write(text,text,text,jsonb,uuid,uuid),eoms.accept_user_invitation(text,text,text,text,text,uuid),eoms.begin_enrollment_oidc(text,text,text,text,text),eoms.consume_enrollment_oidc(text,text) TO eoms_app;
CREATE FUNCTION eoms.onboarding_estates(session_hash text,customer uuid,after_id uuid,page_size integer) RETURNS TABLE(id uuid,name text,code text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE a record;
BEGIN SELECT * INTO a FROM eoms.auth_session(session_hash);IF a.id IS NULL OR NOT eoms.onboarding_allowed(a.id,customer) OR customer IS NULL THEN RAISE EXCEPTION 'Customer setup authority required' USING ERRCODE='42501';END IF;
 IF page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='22023';END IF;
 RETURN QUERY SELECT e.id,e.name,e.code FROM eoms.estates e WHERE e.customer_id=customer AND e.active AND (after_id IS NULL OR e.id>after_id) ORDER BY e.id LIMIT page_size+1;
END $$;
REVOKE ALL ON FUNCTION eoms.onboarding_estates(text,uuid,uuid,integer) FROM PUBLIC;GRANT EXECUTE ON FUNCTION eoms.onboarding_estates(text,uuid,uuid,integer) TO eoms_app;
CREATE FUNCTION eoms.guard_staged_activation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
BEGIN
 -- Run before synchronize_user_lifecycle, including writes that change only active.
 -- Deactivation must not erase the requirement to accept the bound invitation.
 IF (OLD.lifecycle_state='staged' OR EXISTS(SELECT 1 FROM eoms.user_registrations r WHERE r.user_id=NEW.id AND NOT EXISTS(SELECT 1 FROM eoms.user_invitations i WHERE i.user_id=NEW.id AND i.state='accepted')))
 AND (NEW.active OR NEW.lifecycle_state NOT IN ('staged','deactivated'))
 AND current_setting('app.enrollment_activation',true) IS DISTINCT FROM NEW.id::text THEN
  RAISE EXCEPTION 'Complete the bound invitation to activate this user' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.guard_staged_activation() FROM PUBLIC;
CREATE TRIGGER guard_staged_activation BEFORE UPDATE ON eoms.users FOR EACH ROW EXECUTE FUNCTION eoms.guard_staged_activation();
CREATE FUNCTION eoms.user_access_manifest(session_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE a record;
BEGIN SELECT * INTO a FROM eoms.auth_session(session_hash);IF a.id IS NULL THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000';END IF;
 RETURN jsonb_build_object('userId',a.id,'accountState','active','checkedAt',clock_timestamp(),'estates',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'customerId',e.customer_id,'role',m.role) ORDER BY e.id) FROM eoms.memberships m JOIN eoms.estates e ON e.id=m.estate_id WHERE m.user_id=a.id),'[]'::jsonb),'customerAccess',coalesce((SELECT jsonb_agg(jsonb_build_object('customerId',c.id,'name',c.name,'state',v.state,'revision',v.revision) ORDER BY c.id) FROM eoms.customer_user_access v JOIN eoms.customers c ON c.id=v.customer_id WHERE v.user_id=a.id),'[]'::jsonb),'registration',(SELECT jsonb_build_object('userCode',user_code,'employeeReference',employee_reference) FROM eoms.user_registrations WHERE user_id=a.id));
END $$;
REVOKE ALL ON FUNCTION eoms.user_access_manifest(text) FROM PUBLIC;GRANT EXECUTE ON FUNCTION eoms.user_access_manifest(text) TO eoms_app;
CREATE FUNCTION eoms.onboarding_users(session_hash text,customer uuid,term text,after_id uuid,page_size integer) RETURNS TABLE(id uuid,name text,email text,state text,user_code text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE a record;
BEGIN SELECT * INTO a FROM eoms.auth_session(session_hash);IF a.id IS NULL OR NOT eoms.onboarding_allowed(a.id,customer) THEN RAISE EXCEPTION 'Scoped onboarding authority required' USING ERRCODE='42501';END IF;
 IF page_size NOT BETWEEN 1 AND 25 OR length(term)>100 THEN RAISE EXCEPTION 'Invalid user page' USING ERRCODE='22023';END IF;
 RETURN QUERY SELECT u.id,u.display_name,u.email,u.lifecycle_state,r.user_code FROM eoms.users u LEFT JOIN eoms.user_registrations r ON r.user_id=u.id AND r.customer_id IS NOT DISTINCT FROM customer
 WHERE (after_id IS NULL OR u.id>after_id) AND position(lower(term) IN lower(u.display_name||' '||u.email||' '||coalesce(r.user_code,'')))>0 AND
 (r.user_id IS NOT NULL OR (customer IS NOT NULL AND (EXISTS(SELECT 1 FROM eoms.memberships m JOIN eoms.estates e ON e.id=m.estate_id WHERE m.user_id=u.id AND e.customer_id=customer) OR EXISTS(SELECT 1 FROM eoms.customer_user_access v WHERE v.user_id=u.id AND v.customer_id=customer)))) ORDER BY u.id LIMIT page_size+1;
END $$;
REVOKE ALL ON FUNCTION eoms.onboarding_users(text,uuid,text,uuid,integer) FROM PUBLIC;GRANT EXECUTE ON FUNCTION eoms.onboarding_users(text,uuid,text,uuid,integer) TO eoms_app;

-- Keep global lifecycle guidance aligned with enrollment, including deactivated registrations.
CREATE OR REPLACE FUNCTION eoms.lifecycle_context(session_hash text,target uuid DEFAULT NULL,after_id bigint DEFAULT NULL,page_size integer DEFAULT 10) RETURNS jsonb
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
 'enrollmentRequired',EXISTS(SELECT 1 FROM eoms.user_registrations r WHERE r.user_id=u.id AND NOT EXISTS(SELECT 1 FROM eoms.user_invitations i WHERE i.user_id=u.id AND i.state='accepted')),'self',u.id=a.id,'sessionCount',(SELECT count(*) FROM eoms.sessions s WHERE s.user_id=u.id AND s.expires_at>now() AND s.last_seen_at>now()-interval '30 minutes'),
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
