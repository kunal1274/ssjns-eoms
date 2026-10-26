-- Page by the numeric event identity, not the text display alias.
CREATE OR REPLACE FUNCTION eoms.onboarding_context(session_hash text,customer uuid DEFAULT NULL,target uuid DEFAULT NULL,history_after bigint DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
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
 'history',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id::bigint DESC) FROM(SELECT id::text,actor_id,action,request_id,created_at,detail FROM eoms.security_events WHERE subject_id=u.id AND (detail->>'customerId') IS NOT DISTINCT FROM customer::text AND action LIKE 'registration.%' AND (history_after IS NULL OR id<history_after) ORDER BY eoms.security_events.id DESC LIMIT 26)h),'[]'::jsonb)) INTO answer FROM eoms.users u WHERE u.id=target;
 RETURN answer;
END $$;
