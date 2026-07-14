ALTER TABLE paper_order_batches ADD COLUMN market_data_timestamp TEXT;

ALTER TABLE paper_order_batch_orders ADD COLUMN target_allocation_pct REAL NOT NULL DEFAULT 0;
