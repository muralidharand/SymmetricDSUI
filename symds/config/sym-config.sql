-- SymmetricDS configuration, loaded into AW_Source (registration server). Idempotent.
SET NOCOUNT ON;
DELETE FROM sym_trigger_router WHERE router_id = 'source_to_target';
DELETE FROM sym_trigger WHERE trigger_id LIKE 'aw_%';
DELETE FROM sym_router WHERE router_id = 'source_to_target';
DELETE FROM sym_node_group_link WHERE source_node_group_id='source' AND target_node_group_id='target';
DELETE FROM sym_channel WHERE channel_id = 'aw_data';
DELETE FROM sym_node_group WHERE node_group_id IN ('source','target');

INSERT INTO sym_node_group (node_group_id, description) VALUES ('source','AdventureWorks source'), ('target','AdventureWorks target');

-- P = source pushes to target. (W = target pulls.)
INSERT INTO sym_node_group_link (source_node_group_id, target_node_group_id, data_event_action)
VALUES ('source','target','P');

-- One ordered channel for all tables so cross-table FKs (Customer -> SalesOrderHeader -> Detail) stay in commit order.
INSERT INTO sym_channel (channel_id, processing_order, max_batch_size, max_batch_to_send, enabled, description)
VALUES ('aw_data', 10, 1000, 20, 1, 'AdventureWorksLT data');

INSERT INTO sym_router (router_id, source_node_group_id, target_node_group_id, router_type, create_time, last_update_time)
VALUES ('source_to_target','source','target','default', GETDATE(), GETDATE());

-- table, schema, initial_load_order (parents before children)
DECLARE @t TABLE (sch varchar(50), tbl varchar(100), ord int);
INSERT @t VALUES
 ('SalesLT','ProductCategory',10), ('SalesLT','ProductModel',20), ('SalesLT','ProductDescription',30),
 ('SalesLT','ProductModelProductDescription',40), ('SalesLT','Product',50),
 ('SalesLT','Customer',60), ('SalesLT','Address',70), ('SalesLT','CustomerAddress',80),
 ('SalesLT','SalesOrderHeader',90), ('SalesLT','SalesOrderDetail',100),
 -- dbo.BuildVersion is excluded on purpose: it has no primary key (SymmetricDS needs a PK or full-row match)
 ('dbo','ErrorLog',120);

INSERT INTO sym_trigger (trigger_id, source_schema_name, source_table_name, channel_id, last_update_time, create_time)
SELECT 'aw_' + tbl, sch, tbl, 'aw_data', GETDATE(), GETDATE() FROM @t;

INSERT INTO sym_trigger_router (trigger_id, router_id, initial_load_order, last_update_time, create_time)
SELECT 'aw_' + tbl, 'source_to_target', ord, GETDATE(), GETDATE() FROM @t;

-- NOTE: do NOT set initial_load_select='1=1 ORDER BY ...' for ProductCategory (self-referencing FK). SymmetricDS wraps the
-- select in COUNT(*) queries, so ORDER BY raises a SQL error and the whole initial load silently produces no batches.
-- Default PK order already loads root categories (NULL parent, IDs 1-4) first.
