CREATE TABLE eoms.customer_join_invitations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES eoms.customers(id),user_id uuid NOT NULL REFERENCES eoms.users(id),
 user_code text NOT NULL,employee_reference text NOT NULL,proposed_estates jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','accepted','declined','cancelled','superseded')),
 created_by uuid NOT NULL REFERENCES eoms.users(id),authority_revision text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',created_at timestamptz NOT NULL DEFAULT now(),
 reference text NOT NULL,reason text NOT NULL
);
CREATE UNIQUE INDEX one_pending_customer_join ON eoms.customer_join_invitations(customer_id,user_id) WHERE state='pending';
CREATE TABLE eoms.customer_user_profiles(
 customer_id uuid NOT NULL REFERENCES eoms.customers(id),user_id uuid NOT NULL REFERENCES eoms.users(id),
 user_code text NOT NULL,employee_reference text NOT NULL,PRIMARY KEY(customer_id,user_id),UNIQUE(customer_id,user_code)
);
REVOKE ALL ON eoms.customer_join_invitations,eoms.customer_user_profiles FROM PUBLIC,eoms_app;

CREATE FUNCTION eoms.customer_join_page(session_hash text,customer uuid,after_id uuid,page_size integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE a record;items jsonb;
BEGIN
 SELECT * INTO a FROM eoms.auth_session(session_hash);IF a.id IS NULL THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000';END IF;
 IF customer IS NOT NULL AND NOT eoms.onboarding_allowed(a.id,customer) THEN RAISE EXCEPTION 'Customer setup authority required' USING ERRCODE='42501';END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid page size' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.id),'[]'::jsonb) INTO items FROM(
  SELECT i.id,i.customer_id,i.user_id,i.user_code,i.employee_reference,i.state,i.expires_at,i.created_at,c.name AS customer_name,
  i.reference,i.reason,
  coalesce((SELECT jsonb_agg(jsonb_build_object('estateId',e.id,'name',e.name,'role',p->>'role') ORDER BY e.id) FROM jsonb_array_elements(i.proposed_estates)p JOIN eoms.estates e ON e.id=(p->>'estateId')::uuid AND e.customer_id=i.customer_id),'[]'::jsonb) AS estates,
  (i.state='pending' AND i.expires_at>now() AND eoms.onboarding_allowed(i.created_by,i.customer_id) AND i.authority_revision=eoms.onboarding_revision(i.created_by,i.customer_id)) AS accept_available,
  coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id::bigint DESC) FROM(SELECT e.id::text,e.actor_id,e.action,e.request_id,e.created_at,e.detail FROM eoms.security_events e WHERE e.subject_id=i.user_id AND e.detail->>'customerId'=i.customer_id::text AND (e.detail->>'joinInvitationId'=i.id::text OR e.detail->>'replacedInvitationId'=i.id::text) ORDER BY e.id DESC LIMIT 3)h),'[]'::jsonb) AS history
  FROM eoms.customer_join_invitations i JOIN eoms.customers c ON c.id=i.customer_id
  WHERE (CASE WHEN customer IS NULL THEN i.user_id=a.id ELSE i.customer_id=customer END) AND (after_id IS NULL OR i.id>after_id) ORDER BY i.id LIMIT page_size+1
 )v;
 RETURN jsonb_build_object('items',items);
END $$;

CREATE FUNCTION eoms.customer_join_write(session_hash text,csrf_proof text,operation text,input jsonb,retry_key uuid,request_ref uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE a record;uid uuid;customer uuid:=(input->>'customerId')::uuid;target uuid;invitation eoms.customer_join_invitations;previous eoms.customer_join_invitations;payload jsonb;prior eoms.security_receipts;proposal jsonb;item jsonb;answer jsonb;eid bigint;before_state text;
BEGIN
 PERFORM pg_advisory_xact_lock(6543808);
 IF customer IS NULL THEN RAISE EXCEPTION 'Customer scope required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(customer::text,625));
 SELECT user_id INTO uid FROM eoms.sessions WHERE token_hash=session_hash;
 IF operation='prepare' THEN target=(input->>'targetId')::uuid;
 ELSE SELECT * INTO invitation FROM eoms.customer_join_invitations WHERE id=(input->>'invitationId')::uuid AND customer_id=customer;target=invitation.user_id;END IF;
 PERFORM 1 FROM eoms.users WHERE id IN(uid,target) ORDER BY id FOR UPDATE;
 SELECT * INTO a FROM eoms.auth_session(session_hash);
 IF a.id IS NULL OR a.csrf IS DISTINCT FROM csrf_proof THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000';END IF;
 IF operation NOT IN('prepare','cancel','accept','decline') OR retry_key IS NULL OR request_ref IS NULL OR input->>'reference' IS NULL OR length(trim(input->>'reference')) NOT BETWEEN 5 AND 200 OR input->>'reason' IS NULL OR length(trim(input->>'reason')) NOT BETWEEN 10 AND 500 OR input->>'reviewed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Reviewed customer invitation intent required' USING ERRCODE='22023';END IF;
 IF operation IN('prepare','cancel') THEN
  IF NOT eoms.onboarding_allowed(uid,customer) THEN RAISE EXCEPTION 'Explicit customer setup authority required' USING ERRCODE='42501';END IF;
 ELSIF target IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Only the invited account can record consent' USING ERRCODE='42501';END IF;
 payload=jsonb_build_object('kind','customer-join.'||operation,'input',input);
 SELECT * INTO prior FROM eoms.security_receipts WHERE subject_id=uid AND key=retry_key;
 IF FOUND THEN IF prior.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Changed retry' USING ERRCODE='40001';END IF;RETURN prior.result||jsonb_build_object('replayed',true);END IF;
 PERFORM set_config('app.user_id',uid::text,true);PERFORM set_config('app.request_id',request_ref::text,true);PERFORM set_config('app.change_reason',input->>'reason',true);
 IF operation='prepare' THEN
  IF target=uid OR NOT EXISTS(SELECT 1 FROM eoms.users WHERE id=target AND active) THEN RAISE EXCEPTION 'A separate active existing account is required; verify its account UUID with the recipient' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM eoms.customer_user_access WHERE customer_id=customer AND user_id=target) OR EXISTS(SELECT 1 FROM eoms.memberships m JOIN eoms.estates e ON e.id=m.estate_id WHERE m.user_id=target AND e.customer_id=customer) OR EXISTS(SELECT 1 FROM eoms.organization_admins WHERE customer_id=customer AND user_id=target) THEN RAISE EXCEPTION 'Use the existing scoped access workflow for an assigned account' USING ERRCODE='40001';END IF;
  IF input->>'userCode' IS NULL OR length(trim(input->>'userCode')) NOT BETWEEN 1 AND 50 OR input->>'employeeReference' IS NULL OR length(trim(input->>'employeeReference')) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Bounded customer employee references required' USING ERRCODE='22023';END IF;
  proposal=input->'estates';
  IF proposal IS NULL OR jsonb_typeof(proposal)<>'array' OR jsonb_array_length(proposal) NOT BETWEEN 1 AND 100 OR (SELECT count(*) FROM jsonb_array_elements(proposal))<>(SELECT count(DISTINCT p->>'estateId') FROM jsonb_array_elements(proposal)p) THEN RAISE EXCEPTION 'Explicit unique estate proposal required' USING ERRCODE='22023';END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(proposal) ORDER BY value->>'estateId' LOOP
   IF item->>'role' IS NULL OR item->>'role' NOT IN('manager','supervisor','clerk') THEN RAISE EXCEPTION 'Invalid estate role' USING ERRCODE='22023';END IF;
   PERFORM id FROM eoms.estates WHERE id=(item->>'estateId')::uuid AND customer_id=customer AND active FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Estate outside current customer scope' USING ERRCODE='42501';END IF;
  END LOOP;
  SELECT * INTO previous FROM eoms.customer_join_invitations WHERE customer_id=customer AND user_id=target AND state='pending' FOR UPDATE;
  IF previous.id IS DISTINCT FROM (input->>'replaceId')::uuid THEN RAISE EXCEPTION 'Pending invitation changed; review it before replacing' USING ERRCODE='40001';END IF;
  IF previous.id IS NOT NULL THEN UPDATE eoms.customer_join_invitations SET state='superseded' WHERE id=previous.id;END IF;
  INSERT INTO eoms.customer_join_invitations(customer_id,user_id,user_code,employee_reference,proposed_estates,created_by,authority_revision,reference,reason) VALUES(customer,target,trim(input->>'userCode'),trim(input->>'employeeReference'),proposal,uid,eoms.onboarding_revision(uid,customer),input->>'reference',input->>'reason') RETURNING * INTO invitation;
 ELSE
  IF invitation.id IS NULL OR invitation.state<>'pending' THEN RAISE EXCEPTION 'Invitation changed or already resolved' USING ERRCODE='40001';END IF;
  before_state=invitation.state;
  IF operation='accept' THEN
   IF invitation.expires_at<=now() OR NOT eoms.onboarding_allowed(invitation.created_by,customer) OR invitation.authority_revision IS DISTINCT FROM eoms.onboarding_revision(invitation.created_by,customer) THEN RAISE EXCEPTION 'Invitation expired or its issuing authority changed; request a fresh proposal' USING ERRCODE='40001';END IF;
   IF EXISTS(SELECT 1 FROM eoms.customer_user_access WHERE customer_id=customer AND user_id=target) OR EXISTS(SELECT 1 FROM eoms.memberships m JOIN eoms.estates e ON e.id=m.estate_id WHERE m.user_id=target AND e.customer_id=customer) OR EXISTS(SELECT 1 FROM eoms.organization_admins WHERE customer_id=customer AND user_id=target) THEN RAISE EXCEPTION 'Customer access changed; use the existing access workflow' USING ERRCODE='40001';END IF;
   proposal=invitation.proposed_estates;
   FOR item IN SELECT * FROM jsonb_array_elements(proposal) ORDER BY value->>'estateId' LOOP
    PERFORM id FROM eoms.estates WHERE id=(item->>'estateId')::uuid AND customer_id=customer AND active FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Proposed estate changed; request a fresh invitation' USING ERRCODE='40001';END IF;
   END LOOP;
   IF EXISTS(SELECT 1 FROM eoms.user_registrations WHERE customer_id=customer AND user_code=invitation.user_code AND user_id<>target) THEN RAISE EXCEPTION 'Customer user code already registered' USING ERRCODE='23505';END IF;
   INSERT INTO eoms.customer_user_profiles(customer_id,user_id,user_code,employee_reference) VALUES(customer,target,invitation.user_code,invitation.employee_reference);
   INSERT INTO eoms.customer_user_access(customer_id,user_id,state,retained_estates) VALUES(customer,target,'active',proposal);
   FOR item IN SELECT * FROM jsonb_array_elements(proposal) LOOP INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES(target,(item->>'estateId')::uuid,item->>'role');END LOOP;
  END IF;
  UPDATE eoms.customer_join_invitations SET state=CASE operation WHEN 'accept' THEN 'accepted' WHEN 'decline' THEN 'declined' ELSE 'cancelled' END WHERE id=invitation.id RETURNING * INTO invitation;
 END IF;
 answer=jsonb_build_object('invitationId',invitation.id,'targetId',target,'state',invitation.state,'delivery','account-inbox-not-email','globalAccountChanged',false);
 INSERT INTO eoms.security_events(subject_id,actor_id,action,request_id,detail) VALUES(target,uid,'registration.join-'||operation,request_ref,jsonb_build_object('customerId',customer,'joinInvitationId',invitation.id,'replacedInvitationId',previous.id,'reference',input->>'reference','reason',input->>'reason','beforeState',before_state,'afterState',invitation.state,'proposedAssignments',invitation.proposed_estates,'userCode',invitation.user_code,'employeeReference',invitation.employee_reference,'afterAssignments',CASE WHEN operation='accept' THEN proposal ELSE NULL END,'result',answer)) RETURNING id INTO eid;
 answer=answer||jsonb_build_object('eventId',eid::text,'requestId',request_ref,'replayed',false);
 INSERT INTO eoms.security_receipts(subject_id,key,payload,result) VALUES(uid,retry_key,payload,answer);RETURN answer;
END $$;
REVOKE ALL ON FUNCTION eoms.customer_join_page(text,uuid,uuid,integer),eoms.customer_join_write(text,text,text,jsonb,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.customer_join_page(text,uuid,uuid,integer),eoms.customer_join_write(text,text,text,jsonb,uuid,uuid) TO eoms_app;

-- Keep customer-specific supplied employee references distinct from global identity.
CREATE OR REPLACE FUNCTION eoms.user_access_manifest(session_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE a record;
BEGIN SELECT * INTO a FROM eoms.auth_session(session_hash);IF a.id IS NULL THEN RAISE EXCEPTION 'Sign in again' USING ERRCODE='28000';END IF;
 RETURN jsonb_build_object('userId',a.id,'accountState','active','checkedAt',clock_timestamp(),'estates',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'customerId',e.customer_id,'role',m.role) ORDER BY e.id) FROM eoms.memberships m JOIN eoms.estates e ON e.id=m.estate_id WHERE m.user_id=a.id),'[]'::jsonb),'customerAccess',coalesce((SELECT jsonb_agg(jsonb_build_object('customerId',c.id,'name',c.name,'state',v.state,'revision',v.revision) ORDER BY c.id) FROM eoms.customer_user_access v JOIN eoms.customers c ON c.id=v.customer_id WHERE v.user_id=a.id),'[]'::jsonb),'customerProfiles',coalesce((SELECT jsonb_agg(jsonb_build_object('customerId',c.id,'name',c.name,'userCode',p.user_code,'employeeReference',p.employee_reference) ORDER BY c.id) FROM eoms.customer_user_profiles p JOIN eoms.customers c ON c.id=p.customer_id WHERE p.user_id=a.id),'[]'::jsonb),'registration',(SELECT jsonb_build_object('userCode',user_code,'employeeReference',employee_reference) FROM eoms.user_registrations WHERE user_id=a.id));
END $$;
