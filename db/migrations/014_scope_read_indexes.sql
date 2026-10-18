-- Index existing scope joins; do not alter permissions, history or business rows.
CREATE INDEX estate_company_read ON eoms.estates(company_id,id);
CREATE INDEX company_customer_read ON eoms.companies(customer_id,id);
CREATE INDEX area_customer_page ON eoms.operating_areas(customer_id,id);
