UPDATE system_settings
SET value = '*/30 * * * *',
    description = 'Worker cron trigger for every-30-minute paper automation. Stock and ETF executions are still blocked outside regular US market hours.',
    updated_at = datetime('now')
WHERE key = 'automation_schedule';
