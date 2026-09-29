-- PostgreSQL row locking requires UPDATE privilege on at least one column.
-- There are no public endpoints to change these values in this milestone.
GRANT UPDATE(capacity_ha) ON eoms.occurrences TO eoms_app;
GRANT UPDATE(locked) ON eoms.periods TO eoms_app;
