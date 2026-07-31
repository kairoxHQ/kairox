ALTER TABLE ira_alternative_strategy_portfolios
  ADD COLUMN activation_timestamp TEXT;

ALTER TABLE ira_alternative_strategy_portfolios
  ADD COLUMN activated_by TEXT;
