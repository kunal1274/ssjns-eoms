-- Read-only indexes for scoped newest-first ledger pages; no business/history changes.
CREATE INDEX responsibility_ledger_page ON eoms.estate_responsibilities(estate_id,created_at DESC,id DESC);
CREATE INDEX cancellation_ledger_page ON eoms.responsibility_cancel_requests(estate_id,created_at DESC,id DESC);
CREATE INDEX move_ledger_page ON eoms.placement_move_requests(customer_id,created_at DESC,id DESC);
