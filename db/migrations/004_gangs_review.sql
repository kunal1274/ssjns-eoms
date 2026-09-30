CREATE TABLE eoms.gangs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),estate_id uuid NOT NULL REFERENCES eoms.estates(id),code text NOT NULL,name text NOT NULL,active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,UNIQUE(estate_id,id),UNIQUE(estate_id,code));
CREATE TABLE eoms.gang_supervisors(estate_id uuid NOT NULL,gang_id uuid NOT NULL,user_id uuid NOT NULL,PRIMARY KEY(gang_id,user_id),FOREIGN KEY(estate_id,gang_id) REFERENCES eoms.gangs(estate_id,id),FOREIGN KEY(user_id,estate_id) REFERENCES eoms.memberships(user_id,estate_id));
CREATE INDEX gang_estate_code ON eoms.gangs(estate_id,code,id);
DO $$ DECLARE tab text; BEGIN FOREACH tab IN ARRAY ARRAY['gangs','gang_supervisors'] LOOP EXECUTE format('ALTER TABLE eoms.%I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE eoms.%I FORCE ROW LEVEL SECURITY',tab);EXECUTE format('CREATE POLICY estate_scope ON eoms.%I TO eoms_app USING(eoms.is_member(estate_id)) WITH CHECK(eoms.is_member(estate_id))',tab);END LOOP;END $$;
GRANT SELECT,INSERT,UPDATE ON eoms.gangs TO eoms_app;
GRANT SELECT,INSERT,DELETE ON eoms.gang_supervisors TO eoms_app;
-- Preserve historical free-text gang references as registered gangs, without granting new supervisor assignments.
INSERT INTO eoms.gangs(estate_id,code,name) SELECT DISTINCT estate_id,gang_code,gang_code FROM eoms.musters ON CONFLICT DO NOTHING;
ALTER TABLE eoms.musters ADD CONSTRAINT muster_gang_reference FOREIGN KEY(estate_id,gang_code) REFERENCES eoms.gangs(estate_id,code);
ALTER TABLE eoms.musters DROP CONSTRAINT musters_status_check;
ALTER TABLE eoms.musters ADD CONSTRAINT musters_status_check CHECK(status IN('draft','confirmed','reversed'));
ALTER TABLE eoms.musters ADD COLUMN review_status text NOT NULL DEFAULT 'pending' CHECK(review_status IN('pending','approved'));
ALTER TABLE eoms.musters ADD COLUMN reviewed_by uuid REFERENCES eoms.users(id);
ALTER TABLE eoms.musters ADD COLUMN reviewed_at timestamptz;
ALTER TABLE eoms.musters ADD COLUMN review_reason text;
ALTER TABLE eoms.musters ADD COLUMN reversed_by uuid REFERENCES eoms.users(id);
ALTER TABLE eoms.musters ADD COLUMN reversed_at timestamptz;
ALTER TABLE eoms.musters ADD COLUMN reversal_reason text;
-- Limited directory: only an estate manager may see assignable supervisors.
CREATE FUNCTION eoms.assignable_supervisors(estate uuid) RETURNS TABLE(id uuid,name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT u.id,u.display_name FROM eoms.users u JOIN eoms.memberships m ON m.user_id=u.id WHERE m.estate_id=estate AND m.role='supervisor' AND u.active AND EXISTS(SELECT 1 FROM eoms.memberships own WHERE own.user_id=eoms.actor_id() AND own.estate_id=estate AND own.role='manager') ORDER BY u.display_name,u.id
$$;
REVOKE ALL ON FUNCTION eoms.assignable_supervisors(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eoms.assignable_supervisors(uuid) TO eoms_app;
