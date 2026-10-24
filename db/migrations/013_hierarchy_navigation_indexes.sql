-- Read-path indexes only: do not rewrite business records, scope or audit history.
CREATE INDEX estate_customer_page ON eoms.estates(customer_id,id);
CREATE INDEX unit_estate_page ON eoms.operating_units(estate_id,id);
CREATE INDEX hierarchy_history_estate_page ON eoms.hierarchy_history(customer_id,estate_id,id DESC);
CREATE INDEX hierarchy_history_record_page ON eoms.hierarchy_history(customer_id,record_id,id DESC);
