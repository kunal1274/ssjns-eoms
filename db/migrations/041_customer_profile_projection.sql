-- Customer-local identifiers remain searchable and visible after existing-account consent.
CREATE OR REPLACE FUNCTION eoms.onboarding_context(session_hash text,customer uuid DEFAULT NULL,target uuid DEFAULT NULL,history_after bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE a record; answer jsonb; r eoms.user_registrations; access eoms.customer_user_access;profile eoms.customer_user_profiles;
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
 SELECT * INTO profile FROM eoms.customer_user_profiles WHERE customer_id=customer AND user_id=target;
 SELECT jsonb_build_object('id',u.id,'name',u.display_name,'email',u.email,'state',u.lifecycle_state,'registrationRevision',r.revision,
 'userCode',coalesce(r.user_code,profile.user_code),'employeeReference',coalesce(r.employee_reference,profile.employee_reference),'proposedEstates',r.proposed_estates,
 'retainedAssignments',coalesce(access.retained_estates,'[]'::jsonb),'accessState',coalesce(access.state,CASE WHEN customer IS NULL THEN 'unassigned' WHEN u.lifecycle_state='staged' THEN 'pending-activation' ELSE 'active' END),'accessRevision',coalesce(access.revision,0),'scopeRevision',eoms.onboarding_revision(target,customer),
 'assignments',coalesce((SELECT jsonb_agg(jsonb_build_object('estateId',e.id,'name',e.name,'role',m.role) ORDER BY e.id) FROM eoms.memberships m JOIN eoms.estates e ON e.id=m.estate_id WHERE m.user_id=u.id AND e.customer_id=customer),'[]'::jsonb),
 'invitations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'state',i.state,'method',i.method,'expiresAt',i.expires_at,'createdAt',i.created_at) ORDER BY i.created_at DESC) FROM (SELECT * FROM eoms.user_invitations WHERE user_id=u.id AND r.user_id IS NOT NULL ORDER BY created_at DESC LIMIT 25)i),'[]'::jsonb),
 'history',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id::bigint DESC) FROM(SELECT id::text,actor_id,action,request_id,created_at,detail FROM eoms.security_events WHERE subject_id=u.id AND (detail->>'customerId') IS NOT DISTINCT FROM customer::text AND action LIKE 'registration.%' AND (history_after IS NULL OR id<history_after) ORDER BY eoms.security_events.id DESC LIMIT 26)h),'[]'::jsonb)) INTO answer FROM eoms.users u WHERE u.id=target;
 RETURN answer;
END $$;

CREATE OR REPLACE FUNCTION eoms.onboarding_users(session_hash text,customer uuid,term text,after_id uuid,page_size integer) RETURNS TABLE(id uuid,name text,email text,state text,user_code text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE a record;
BEGIN SELECT * INTO a FROM eoms.auth_session(session_hash);IF a.id IS NULL OR NOT eoms.onboarding_allowed(a.id,customer) THEN RAISE EXCEPTION 'Scoped onboarding authority required' USING ERRCODE='42501';END IF;
 IF page_size NOT BETWEEN 1 AND 25 OR length(term)>100 THEN RAISE EXCEPTION 'Invalid user page' USING ERRCODE='22023';END IF;
 RETURN QUERY SELECT u.id,u.display_name,u.email,u.lifecycle_state,coalesce(r.user_code,p.user_code) FROM eoms.users u LEFT JOIN eoms.user_registrations r ON r.user_id=u.id AND r.customer_id IS NOT DISTINCT FROM customer LEFT JOIN eoms.customer_user_profiles p ON p.user_id=u.id AND p.customer_id=customer
 WHERE (after_id IS NULL OR u.id>after_id) AND position(lower(term) IN lower(u.display_name||' '||u.email||' '||coalesce(r.user_code,p.user_code,'')))>0 AND
 (r.user_id IS NOT NULL OR (customer IS NOT NULL AND (EXISTS(SELECT 1 FROM eoms.memberships m JOIN eoms.estates e ON e.id=m.estate_id WHERE m.user_id=u.id AND e.customer_id=customer) OR EXISTS(SELECT 1 FROM eoms.customer_user_access v WHERE v.user_id=u.id AND v.customer_id=customer)))) ORDER BY u.id LIMIT page_size+1;
END $$;
