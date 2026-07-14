UPDATE paper_order_batch_orders
SET target_allocation_pct = COALESCE((
  SELECT allocation_proposal_lines.target_allocation_pct
  FROM allocation_proposal_lines
  WHERE allocation_proposal_lines.proposal_id = paper_order_batch_orders.proposal_id
    AND allocation_proposal_lines.symbol = paper_order_batch_orders.symbol
  LIMIT 1
), target_allocation_pct)
WHERE target_allocation_pct = 0;

UPDATE paper_order_batches
SET market_data_timestamp = (
  SELECT MAX(paper_order_batch_orders.market_data_timestamp)
  FROM paper_order_batch_orders
  WHERE paper_order_batch_orders.batch_id = paper_order_batches.id
)
WHERE market_data_timestamp IS NULL;
