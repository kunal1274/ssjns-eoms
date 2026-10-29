-- Explicit metadata-only inheritance. No memberships, work permissions or setup grants are inferred.
CREATE VIEW eoms.hierarchy_scope_nodes AS
 SELECT c.id AS customer_id,'customer'::text AS kind,c.id,NULL::text AS parent_kind,NULL::uuid AS parent_id,c.code,c.name FROM eoms.customers c
 UNION ALL SELECT g.customer_id,'group',g.id,'customer',g.customer_id,g.code,g.name FROM eoms.customer_groups g
 UNION ALL SELECT c.customer_id,'company',c.id,CASE WHEN c.group_id IS NULL THEN 'customer' ELSE 'group' END,coalesce(c.group_id,c.customer_id),coalesce(c.code,''),c.name FROM eoms.companies c
 UNION ALL SELECT a.customer_id,'area',a.id,CASE WHEN a.parent_id IS NULL THEN 'customer' ELSE 'area' END,coalesce(a.parent_id,a.customer_id),a.code,a.name FROM eoms.operating_areas a
 UNION ALL SELECT e.customer_id,'estate',e.id,'company',e.company_id,e.code,e.name FROM eoms.estates e
 UNION ALL SELECT e.customer_id,'estate',e.id,'area',e.area_id,e.code,e.name FROM eoms.estates e WHERE e.area_id IS NOT NULL
 UNION ALL SELECT u.customer_id,'unit',u.id,CASE WHEN u.parent_id IS NULL THEN 'estate' ELSE 'unit' END,coalesce(u.parent_id,u.estate_id),u.code,u.name FROM eoms.operating_units u
 UNION ALL SELECT s.customer_id,'site',s.id,'company',s.company_id,s.code,s.name FROM eoms.operational_sites s
 UNION ALL SELECT s.customer_id,'site',s.id,'estate',s.estate_id,s.code,s.name FROM eoms.operational_sites s WHERE s.estate_id IS NOT NULL;
REVOKE ALL ON eoms.hierarchy_scope_nodes FROM PUBLIC,eoms_app;
CREATE TABLE eoms.hierarchy_read_grants(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES eoms.customers(id),subject_id uuid NOT NULL REFERENCES eoms.users(id),actor_id uuid NOT NULL REFERENCES eoms.users(id),retry_key uuid NOT NULL,
 node_kind text NOT NULL CHECK(node_kind IN ('customer','group','company','area','estate','unit','site')),node_id uuid NOT NULL,permission text NOT NULL DEFAULT 'hierarchy.read' CHECK(permission='hierarchy.read'),inheritance text NOT NULL CHECK(inheritance IN ('none','descendants')),action text NOT NULL CHECK(action IN ('granted','revoked')),revision integer NOT NULL CHECK(revision>0),previous_id uuid REFERENCES eoms.hierarchy_read_grants(id),subject_revision bigint NOT NULL,grantor_revision bigint NOT NULL,
 reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 3 AND 240),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(customer_id,subject_id,node_kind,node_id,revision),UNIQUE(customer_id,actor_id,retry_key),CHECK((revision=1)=(previous_id IS NULL))
);
CREATE INDEX hierarchy_read_subject ON eoms.hierarchy_read_grants(subject_id,customer_id);
CREATE INDEX hierarchy_read_page ON eoms.hierarchy_read_grants(customer_id,id);
ALTER TABLE eoms.hierarchy_read_grants ENABLE ROW LEVEL SECURITY; ALTER TABLE eoms.hierarchy_read_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY hierarchy_read_grant_admin ON eoms.hierarchy_read_grants FOR SELECT TO eoms_app USING(eoms.can_manage_customer(customer_id));
CREATE TRIGGER hierarchy_read_grant_immutable BEFORE UPDATE OR DELETE ON eoms.hierarchy_read_grants FOR EACH ROW EXECUTE FUNCTION eoms.reconciliation_immutable();
GRANT SELECT ON eoms.hierarchy_read_grants TO eoms_app;
CREATE FUNCTION eoms.hierarchy_grantor_revision(customer uuid,subject uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$ SELECT coalesce(max(id),0) FROM eoms.mapping_policy_scope_events WHERE subject_id=subject AND (customer_id=customer OR kind='user-active') $$;
REVOKE ALL ON FUNCTION eoms.hierarchy_grantor_revision(uuid,uuid) FROM PUBLIC;
CREATE FUNCTION eoms.effective_hierarchy_grants(subject uuid) RETURNS SETOF eoms.hierarchy_read_grants LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
 SELECT g.* FROM (SELECT DISTINCT ON(customer_id,node_kind,node_id) * FROM eoms.hierarchy_read_grants WHERE subject_id=subject ORDER BY customer_id,node_kind,node_id,revision DESC)g JOIN eoms.users u ON u.id=g.subject_id JOIN eoms.users a ON a.id=g.actor_id
 WHERE subject=eoms.actor_id() AND g.action='granted' AND u.active AND a.active AND g.subject_revision=(SELECT coalesce(max(id),0) FROM eoms.mapping_policy_scope_events WHERE subject_id=subject AND kind='user-active') AND g.grantor_revision=eoms.hierarchy_grantor_revision(g.customer_id,g.actor_id) AND EXISTS(SELECT 1 FROM eoms.organization_admins WHERE customer_id=g.customer_id AND user_id=g.actor_id)
$$;
REVOKE ALL ON FUNCTION eoms.effective_hierarchy_grants(uuid) FROM PUBLIC;
CREATE FUNCTION eoms.hierarchy_scope_contexts() RETURNS TABLE(id uuid,code text,name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
 SELECT DISTINCT c.id,c.code,c.name FROM eoms.effective_hierarchy_grants(eoms.actor_id())g JOIN eoms.customers c ON c.id=g.customer_id
$$;
REVOKE ALL ON FUNCTION eoms.hierarchy_scope_contexts() FROM PUBLIC; GRANT EXECUTE ON FUNCTION eoms.hierarchy_scope_contexts() TO eoms_app;
CREATE FUNCTION eoms.read_hierarchy_scope(customer uuid) RETURNS TABLE(kind text,id uuid,code text,name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
 WITH RECURSIVE grants AS (SELECT * FROM eoms.effective_hierarchy_grants(eoms.actor_id()) WHERE customer_id=customer),visible(kind,id,descend) AS (
  SELECT n.kind,n.id,g.inheritance='descendants' FROM grants g JOIN eoms.hierarchy_scope_nodes n ON n.customer_id=g.customer_id AND n.kind=g.node_kind AND n.id=g.node_id
  UNION SELECT n.kind,n.id,true FROM visible v JOIN eoms.hierarchy_scope_nodes n ON n.customer_id=customer AND n.parent_kind=v.kind AND n.parent_id=v.id WHERE v.descend
 ) SELECT DISTINCT n.kind,n.id,n.code,n.name FROM visible v JOIN eoms.hierarchy_scope_nodes n ON n.customer_id=customer AND n.kind=v.kind AND n.id=v.id
$$;
REVOKE ALL ON FUNCTION eoms.read_hierarchy_scope(uuid) FROM PUBLIC; GRANT EXECUTE ON FUNCTION eoms.read_hierarchy_scope(uuid) TO eoms_app;
CREATE FUNCTION eoms.record_hierarchy_read_grant(customer uuid,subject uuid,node_type text,node uuid,inherit text,result text,retry uuid,expected integer,ref text,why text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE actor uuid:=eoms.actor_id();support uuid:=nullif(current_setting('app.request_id',true),'')::uuid;prior eoms.hierarchy_read_grants;head eoms.hierarchy_read_grants;event eoms.hierarchy_read_grants;marker bigint;
BEGIN
 IF NOT coalesce(eoms.can_manage_customer(customer),false) THEN RAISE EXCEPTION 'Customer setup authority required for hierarchy-only scope assignments' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(customer::text,625));
 PERFORM a.user_id FROM eoms.organization_admins a JOIN eoms.users u ON u.id=a.user_id WHERE a.customer_id=customer AND a.user_id=actor AND u.active FOR SHARE OF a,u;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active customer setup authority required' USING ERRCODE='42501'; END IF;
 IF subject IS NULL OR node_type IS NULL OR node_type NOT IN ('customer','group','company','area','estate','unit','site') OR node IS NULL OR inherit IS NULL OR inherit NOT IN ('none','descendants') OR result IS NULL OR result NOT IN ('granted','revoked') OR retry IS NULL OR support IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 2147483646 OR ref IS NULL OR length(trim(ref)) NOT BETWEEN 3 AND 240 OR why IS NULL OR length(trim(why)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Exact bounded hierarchy scope assignment required' USING ERRCODE='23514'; END IF;
 SELECT * INTO prior FROM eoms.hierarchy_read_grants WHERE customer_id=customer AND actor_id=actor AND retry_key=retry;
 IF FOUND THEN
  IF (prior.subject_id,prior.node_kind,prior.node_id,prior.inheritance,prior.action,prior.revision-1,prior.reference,prior.reason) IS DISTINCT FROM(subject,node_type,node,inherit,result,expected,ref,why) THEN RAISE EXCEPTION 'Hierarchy scope retry content changed' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('grant',to_jsonb(prior),'replayed',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM eoms.hierarchy_scope_nodes WHERE customer_id=customer AND kind=node_type AND id=node) THEN RAISE EXCEPTION 'Hierarchy node outside customer scope' USING ERRCODE='42501'; END IF;
 SELECT * INTO head FROM eoms.hierarchy_read_grants WHERE customer_id=customer AND subject_id=subject AND node_kind=node_type AND node_id=node ORDER BY revision DESC LIMIT 1;
 IF coalesce(head.revision,0)<>expected THEN RAISE EXCEPTION 'Hierarchy assignment revision changed' USING ERRCODE='23505'; END IF;
 PERFORM id FROM eoms.users WHERE id=subject AND (active OR result='revoked') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Named active hierarchy reader required' USING ERRCODE='23514'; END IF;
 IF result='revoked' AND (head.id IS NULL OR head.action<>'granted') THEN RAISE EXCEPTION 'Existing assignment required for revocation' USING ERRCODE='23514'; END IF;
 SELECT coalesce(max(id),0) INTO marker FROM eoms.mapping_policy_scope_events WHERE subject_id=subject AND kind='user-active';
 INSERT INTO eoms.hierarchy_read_grants(customer_id,subject_id,actor_id,retry_key,node_kind,node_id,inheritance,action,revision,previous_id,subject_revision,grantor_revision,reference,reason,request_id) VALUES(customer,subject,actor,retry,node_type,node,inherit,result,expected+1,head.id,marker,eoms.hierarchy_grantor_revision(customer,actor),ref,why,support) RETURNING * INTO event;
 RETURN jsonb_build_object('grant',to_jsonb(event),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION eoms.record_hierarchy_read_grant(uuid,uuid,text,uuid,text,text,uuid,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.record_hierarchy_read_grant(uuid,uuid,text,uuid,text,text,uuid,integer,text,text) TO eoms_app;
CREATE FUNCTION eoms.hierarchy_assignment_nodes(customer uuid) RETURNS TABLE(kind text,id uuid,code text,name text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
BEGIN
 IF NOT coalesce(eoms.can_manage_customer(customer),false) OR NOT EXISTS(SELECT 1 FROM eoms.users WHERE users.id=eoms.actor_id() AND active) THEN RAISE EXCEPTION 'Customer setup authority required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT DISTINCT n.kind,n.id,n.code,n.name FROM eoms.hierarchy_scope_nodes n WHERE n.customer_id=customer;
END $$;
REVOKE ALL ON FUNCTION eoms.hierarchy_assignment_nodes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.hierarchy_assignment_nodes(uuid) TO eoms_app;
