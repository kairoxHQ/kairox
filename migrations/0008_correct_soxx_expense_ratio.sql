UPDATE assets
SET expense_ratio = 0.0034,
    updated_at = datetime('now')
WHERE symbol = 'SOXX';
