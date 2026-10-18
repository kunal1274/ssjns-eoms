-- Scoped unresolved-record queues; no attribution or grant backfill.
CREATE INDEX occurrence_unlinked_review ON eoms.occurrences(estate_id,id) WHERE block_unit_id IS NULL;
CREATE INDEX muster_unattributed_review ON eoms.musters(estate_id,id) WHERE legal_company_id IS NULL;
