-- Immediate operating placement changes, distinct from dated legal responsibility.
ALTER TABLE eoms.operating_areas ADD COLUMN active boolean NOT NULL DEFAULT true;
GRANT UPDATE(active) ON eoms.operating_areas TO eoms_app;
CREATE TABLE eoms.placement_move_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), estate_id uuid NOT NULL, customer_id uuid NOT NULL,
 from_area_id uuid, to_area_id uuid, expected_version integer NOT NULL CHECK(expected_version>0),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500), requester_id uuid NOT NULL REFERENCES eoms.users(id),
 request_id uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,estate_id,customer_id),
 FOREIGN KEY(estate_id,customer_id) REFERENCES eoms.estates(id,customer_id),
 FOREIGN KEY(from_area_id,customer_id) REFERENCES eoms.operating_areas(id,customer_id),
 FOREIGN KEY(to_area_id,customer_id) REFERENCES eoms.operating_areas(id,customer_id),
 CHECK(from_area_id IS DISTINCT FROM to_area_id)
);
CREATE TABLE eoms.placement_move_decisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), move_request_id uuid NOT NULL UNIQUE,
 estate_id uuid NOT NULL, customer_id uuid NOT NULL, decision text NOT NULL CHECK(decision IN ('approved','rejected')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500), reviewer_id uuid NOT NULL REFERENCES eoms.users(id),
 request_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(move_request_id,estate_id,customer_id) REFERENCES eoms.placement_move_requests(id,estate_id,customer_id)
);
ALTER TABLE eoms.placement_move_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoms.placement_move_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE eoms.placement_move_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoms.placement_move_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY move_requests_read ON eoms.placement_move_requests FOR SELECT TO eoms_app USING(eoms.is_member(estate_id));
CREATE POLICY move_requests_create ON eoms.placement_move_requests FOR INSERT TO eoms_app WITH CHECK(eoms.is_member(estate_id) AND eoms.can_manage_customer(customer_id));
CREATE POLICY move_decisions_read ON eoms.placement_move_decisions FOR SELECT TO eoms_app USING(eoms.is_member(estate_id));
CREATE POLICY move_decisions_create ON eoms.placement_move_decisions FOR INSERT TO eoms_app WITH CHECK(eoms.is_member(estate_id) AND eoms.can_manage_customer(customer_id));
GRANT SELECT ON eoms.placement_move_requests,eoms.placement_move_decisions TO eoms_app;
GRANT INSERT(estate_id,customer_id,to_area_id,expected_version,reason) ON eoms.placement_move_requests TO eoms_app;
GRANT INSERT(move_request_id,estate_id,customer_id,decision,reason) ON eoms.placement_move_decisions TO eoms_app;
CREATE INDEX placement_move_customer ON eoms.placement_move_requests(customer_id,created_at DESC);

-- A customer lock serializes lifecycle checks with area creation/placement/move writes.
-- This guard checks ALL dependencies, including estates outside the actor's read scope.
CREATE FUNCTION eoms.area_has_dependencies(target uuid,customer uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
BEGIN
 IF NOT eoms.can_manage_customer(customer) THEN RAISE EXCEPTION 'Setup grant required' USING ERRCODE='42501'; END IF;
 RETURN EXISTS(SELECT 1 FROM eoms.operating_areas WHERE customer_id=customer AND parent_id=target AND active)
     OR EXISTS(SELECT 1 FROM eoms.estates WHERE customer_id=customer AND area_id=target);
END $$;
REVOKE ALL ON FUNCTION eoms.area_has_dependencies(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.area_has_dependencies(uuid,uuid) TO eoms_app;
CREATE OR REPLACE FUNCTION eoms.validate_operating_area() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
DECLARE parent_kind text; parent_active boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.customer_id::text,610));
 IF TG_OP='UPDATE' AND ((NEW.id,NEW.customer_id,NEW.kind,NEW.parent_id) IS DISTINCT FROM (OLD.id,OLD.customer_id,OLD.kind,OLD.parent_id) OR NEW.version<>OLD.version+1) THEN RAISE EXCEPTION 'Immutable operating area scope or invalid version' USING ERRCODE='23514'; END IF;
 IF NEW.kind='region' AND NEW.parent_id IS NOT NULL THEN RAISE EXCEPTION 'Region must attach to customer' USING ERRCODE='23514'; END IF;
 IF NEW.parent_id IS NOT NULL THEN
  SELECT kind,active INTO parent_kind,parent_active FROM eoms.operating_areas WHERE id=NEW.parent_id AND customer_id=NEW.customer_id;
  IF NEW.parent_id=NEW.id OR parent_kind IS NULL OR NEW.kind<>'business-unit' OR parent_kind<>'region' THEN RAISE EXCEPTION 'Invalid active region parent' USING ERRCODE='23514'; END IF;
  IF NEW.active AND NOT parent_active THEN RAISE EXCEPTION 'Active area requires active parent' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.active AND NOT NEW.active AND eoms.area_has_dependencies(NEW.id,NEW.customer_id) THEN RAISE EXCEPTION 'Move assigned estates and deactivate active child areas first' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION eoms.validate_placement_move() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
DECLARE item eoms.placement_move_requests%ROWTYPE; current_area uuid; current_version integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.customer_id::text,610));
 IF eoms.actor_id() IS NULL OR NOT(eoms.is_member(NEW.estate_id) AND eoms.can_manage_customer(NEW.customer_id)) THEN RAISE EXCEPTION 'Setup grant and estate membership required' USING ERRCODE='42501'; END IF;
 SELECT area_id,placement_version INTO current_area,current_version FROM eoms.estates WHERE id=NEW.estate_id AND customer_id=NEW.customer_id FOR UPDATE;
 IF current_version IS NULL THEN RAISE EXCEPTION 'Estate unavailable' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='placement_move_requests' THEN
  IF current_version<>NEW.expected_version OR current_area IS NOT DISTINCT FROM NEW.to_area_id THEN RAISE EXCEPTION 'Placement changed or destination unchanged' USING ERRCODE='23514'; END IF;
  IF NEW.to_area_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM eoms.operating_areas WHERE id=NEW.to_area_id AND customer_id=NEW.customer_id AND active) THEN RAISE EXCEPTION 'Choose active area in this customer' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM eoms.placement_move_requests q WHERE q.estate_id=NEW.estate_id AND NOT EXISTS(SELECT 1 FROM eoms.placement_move_decisions d WHERE d.move_request_id=q.id)) THEN RAISE EXCEPTION 'Move already pending' USING ERRCODE='23514'; END IF;
  NEW.from_area_id:=current_area; NEW.requester_id:=eoms.actor_id();
 ELSE
  SELECT * INTO item FROM eoms.placement_move_requests WHERE id=NEW.move_request_id AND estate_id=NEW.estate_id AND customer_id=NEW.customer_id;
  IF item.id IS NULL OR item.requester_id=eoms.actor_id() THEN RAISE EXCEPTION 'Independent setup reviewer required' USING ERRCODE='42501'; END IF;
  IF NEW.decision='approved' THEN
   IF current_version<>item.expected_version OR current_area IS DISTINCT FROM item.from_area_id THEN RAISE EXCEPTION 'Placement changed; reject stale request' USING ERRCODE='23514'; END IF;
   IF item.to_area_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM eoms.operating_areas WHERE id=item.to_area_id AND customer_id=item.customer_id AND active) THEN RAISE EXCEPTION 'Destination inactive; reject request' USING ERRCODE='23514'; END IF;
  END IF;
  NEW.reviewer_id:=eoms.actor_id();
 END IF;
 NEW.request_id:=nullif(current_setting('app.request_id',true),'')::uuid;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.validate_placement_move() FROM PUBLIC;
CREATE TRIGGER placement_move_request_rules BEFORE INSERT ON eoms.placement_move_requests FOR EACH ROW EXECUTE FUNCTION eoms.validate_placement_move();
CREATE TRIGGER placement_move_decision_rules BEFORE INSERT ON eoms.placement_move_decisions FOR EACH ROW EXECUTE FUNCTION eoms.validate_placement_move();
CREATE OR REPLACE FUNCTION eoms.validate_estate_placement() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
BEGIN
 IF (NEW.area_id,NEW.placement_version) IS NOT DISTINCT FROM (OLD.area_id,OLD.placement_version) THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.customer_id::text,610));
 IF (NEW.id,NEW.customer_id,NEW.company_id) IS DISTINCT FROM (OLD.id,OLD.customer_id,OLD.company_id) OR NEW.placement_version<>OLD.placement_version+1 OR NEW.area_id IS NOT DISTINCT FROM OLD.area_id THEN RAISE EXCEPTION 'Invalid placement transition' USING ERRCODE='23514'; END IF;
 IF eoms.actor_id() IS NULL OR NOT(eoms.is_member(NEW.id) AND eoms.can_manage_customer(NEW.customer_id)) THEN RAISE EXCEPTION 'Setup grant and estate membership required' USING ERRCODE='42501'; END IF;
 IF NEW.area_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM eoms.operating_areas WHERE id=NEW.area_id AND customer_id=NEW.customer_id AND active) THEN RAISE EXCEPTION 'Choose active area in this customer' USING ERRCODE='23514'; END IF;
 IF OLD.area_id IS NOT NULL OR OLD.placement_version<>1 OR NEW.area_id IS NULL THEN
  IF NOT EXISTS(SELECT 1 FROM eoms.placement_move_decisions d JOIN eoms.placement_move_requests q ON q.id=d.move_request_id WHERE d.id=nullif(current_setting('app.move_decision_id',true),'')::uuid AND d.decision='approved' AND d.reviewer_id=eoms.actor_id() AND q.estate_id=NEW.id AND q.customer_id=NEW.customer_id AND q.expected_version=OLD.placement_version AND q.from_area_id IS NOT DISTINCT FROM OLD.area_id AND q.to_area_id IS NOT DISTINCT FROM NEW.area_id) THEN RAISE EXCEPTION 'Independent approved move required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION eoms.apply_placement_move() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,eoms AS $$
DECLARE item eoms.placement_move_requests%ROWTYPE;
BEGIN
 IF NEW.decision='approved' THEN
  SELECT * INTO STRICT item FROM eoms.placement_move_requests WHERE id=NEW.move_request_id;
  PERFORM set_config('app.move_decision_id',NEW.id::text,true),set_config('app.change_reason',NEW.reason,true);
  UPDATE eoms.estates SET area_id=item.to_area_id,placement_version=placement_version+1 WHERE id=NEW.estate_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.apply_placement_move() FROM PUBLIC;
CREATE TRIGGER placement_move_apply AFTER INSERT ON eoms.placement_move_decisions FOR EACH ROW EXECUTE FUNCTION eoms.apply_placement_move();
-- Extend existing projected area audit with explicit lifecycle state, preserving prior rows.
CREATE OR REPLACE FUNCTION eoms.record_operating_placement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
DECLARE before_value jsonb; after_value jsonb; event_type text; event_estate uuid; change_reason text;
BEGIN
 change_reason:=nullif(current_setting('app.change_reason',true),'');
 IF eoms.actor_id() IS NOT NULL AND length(trim(coalesce(change_reason,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Placement change reason required' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='operating_areas' THEN
  event_type:='area'; after_value:=jsonb_build_object('code',NEW.code,'name',NEW.name,'kind',NEW.kind,'parentId',NEW.parent_id,'version',NEW.version,'active',NEW.active);
  IF TG_OP='UPDATE' THEN before_value:=jsonb_build_object('code',OLD.code,'name',OLD.name,'kind',OLD.kind,'parentId',OLD.parent_id,'version',OLD.version,'active',OLD.active); END IF;
 ELSE
  IF (NEW.area_id,NEW.placement_version) IS NOT DISTINCT FROM (OLD.area_id,OLD.placement_version) THEN RETURN NEW; END IF;
  event_type:='estate-placement';event_estate:=NEW.id;
  after_value:=jsonb_build_object('code',NEW.code,'name',NEW.name,'parentId',NEW.area_id,'version',NEW.placement_version,'moveDecisionId',nullif(current_setting('app.move_decision_id',true),''));
  before_value:=jsonb_build_object('code',OLD.code,'name',OLD.name,'parentId',OLD.area_id,'version',OLD.placement_version);
 END IF;
 INSERT INTO eoms.hierarchy_history(customer_id,estate_id,record_id,record_type,action,actor_id,reason,request_id,before_state,after_state)
 VALUES(NEW.customer_id,event_estate,NEW.id,event_type,CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'updated' END,eoms.actor_id(),coalesce(change_reason,'System / explicit migration'),nullif(current_setting('app.request_id',true),'')::uuid,before_value,after_value);
 RETURN NEW;
END $$;
