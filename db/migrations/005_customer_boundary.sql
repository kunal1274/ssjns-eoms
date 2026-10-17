-- F06.1: explicit customer roots; legacy companies remain separate until approved mapping.
CREATE TABLE eoms.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (length(code) BETWEEN 1 AND 50),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200)
);
CREATE TABLE eoms.customer_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES eoms.customers(id),
  actor_id uuid REFERENCES eoms.users(id),
  action text NOT NULL CHECK(action IN ('customer.created','customer.updated')),
  detail jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_history_scope ON eoms.customer_history(customer_id,id DESC);
CREATE FUNCTION eoms.record_customer_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,eoms AS $$
BEGIN
  INSERT INTO eoms.customer_history(customer_id,actor_id,action,detail)
  VALUES(NEW.id,eoms.actor_id(),CASE WHEN TG_OP='INSERT' THEN 'customer.created' ELSE 'customer.updated' END,
    jsonb_build_object('before',CASE WHEN TG_OP='UPDATE' THEN jsonb_build_object('code',OLD.code,'name',OLD.name) ELSE NULL END,
      'after',jsonb_build_object('code',NEW.code,'name',NEW.name),
      'requestId',nullif(current_setting('app.request_id',true),'')));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION eoms.record_customer_history() FROM PUBLIC;
CREATE TRIGGER customer_history_record AFTER INSERT OR UPDATE ON eoms.customers FOR EACH ROW EXECUTE FUNCTION eoms.record_customer_history();
ALTER TABLE eoms.companies ADD COLUMN customer_id uuid REFERENCES eoms.customers(id);
INSERT INTO eoms.customers(code,name)
SELECT 'MIG-'||upper(replace(id::text,'-','')),name FROM eoms.companies;
UPDATE eoms.companies c SET customer_id=t.id FROM eoms.customers t WHERE t.code='MIG-'||upper(replace(c.id::text,'-',''));
ALTER TABLE eoms.companies ALTER COLUMN customer_id SET NOT NULL;
ALTER TABLE eoms.companies ADD CONSTRAINT company_customer_key UNIQUE(id,customer_id);
CREATE INDEX company_customer ON eoms.companies(customer_id);
ALTER TABLE eoms.estates ADD COLUMN customer_id uuid REFERENCES eoms.customers(id);
UPDATE eoms.estates e SET customer_id=c.customer_id FROM eoms.companies c WHERE c.id=e.company_id;
ALTER TABLE eoms.estates ALTER COLUMN customer_id SET NOT NULL;
ALTER TABLE eoms.estates ADD CONSTRAINT estate_company_customer FOREIGN KEY(company_id,customer_id) REFERENCES eoms.companies(id,customer_id);
CREATE INDEX estate_customer ON eoms.estates(customer_id);
ALTER TABLE eoms.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoms.customers FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_visible ON eoms.customers FOR SELECT TO eoms_app USING (
  EXISTS(SELECT 1 FROM eoms.companies c JOIN eoms.estates e ON e.company_id=c.id WHERE c.customer_id=customers.id)
);
ALTER TABLE eoms.customer_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE eoms.customer_history FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_history_visible ON eoms.customer_history FOR SELECT TO eoms_app USING (
  EXISTS(SELECT 1 FROM eoms.customers c WHERE c.id=customer_id)
);
GRANT SELECT ON eoms.customers,eoms.customer_history TO eoms_app;
-- No runtime write/delete grants: provisioning/admin actions arrive in later F06 increments.
