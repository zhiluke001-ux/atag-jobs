-- ATAG Jobs post-migration verification queries
-- Run in Supabase Dashboard -> SQL Editor after migration.

-- Core counts
SELECT count(*) AS user_count FROM public.users;
SELECT count(*) AS job_count FROM public.jobs;
SELECT count(*) AS application_count FROM public.job_applications;
SELECT status, count(*) AS application_count
FROM public.job_applications
GROUP BY status
ORDER BY status;
SELECT count(*) AS attendance_record_count FROM public.job_attendance;
SELECT count(*) AS notification_count FROM public.notifications;
SELECT count(*) AS audit_log_count FROM public.audit_logs;
SELECT count(*) AS parking_receipt_count FROM public.parking_receipts;
SELECT count(*) AS push_subscription_count FROM public.push_subscriptions;

-- Operational table counts
SELECT count(*) AS loading_member_count FROM public.job_loading_members;
SELECT count(*) AS early_call_member_count FROM public.job_early_call_members;
SELECT count(*) AS adjustment_count FROM public.job_adjustments;
SELECT count(*) AS full_timer_count FROM public.job_full_timers;

-- Files recorded by the legacy migration
SELECT count(*) AS migrated_legacy_file_count FROM public.legacy_blob_migrations;
SELECT bucket, count(*) AS migrated_files
FROM public.legacy_blob_migrations
GROUP BY bucket
ORDER BY bucket;

-- Actual Supabase Storage objects. This table is owned by Supabase Storage.
SELECT bucket_id, count(*) AS object_count
FROM storage.objects
WHERE bucket_id IN ('avatars','verification-photos','parking-receipts')
GROUP BY bucket_id
ORDER BY bucket_id;

-- Check for database references that should not be broken
SELECT count(*) AS applications_with_missing_users
FROM public.job_applications a
LEFT JOIN public.users u ON u.id = a.user_id
WHERE u.id IS NULL;

SELECT count(*) AS applications_with_missing_jobs
FROM public.job_applications a
LEFT JOIN public.jobs j ON j.id = a.job_id
WHERE j.id IS NULL;

SELECT count(*) AS receipts_with_missing_storage_path
FROM public.parking_receipts
WHERE storage_path IS NULL OR btrim(storage_path) = '';

-- Application deadlines, shown in Malaysia time
SELECT id, title,
       application_deadline,
       application_deadline AT TIME ZONE 'Asia/Kuala_Lumpur' AS deadline_malaysia
FROM public.jobs
WHERE application_deadline IS NOT NULL
ORDER BY application_deadline;

-- Migration run status. Latest run should be completed and failures should be empty.
SELECT id, started_at, finished_at, status, summary
FROM public.migration_runs
ORDER BY started_at DESC
LIMIT 5;

-- Database size
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;

-- Largest public tables
SELECT schemaname, relname AS table_name,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_catalog.pg_statio_user_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(relid) DESC;
