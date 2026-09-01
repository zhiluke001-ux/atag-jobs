# ATAG Jobs Final UAT Checklist

Run this against a **staging Railway backend connected to the migrated Supabase project** before production cutover. Use at least one Admin/PM account and two Part-Timer accounts. Keep Railway at one replica for the first cutover.

## Account and profile
- [ ] 1. Register a new user with a valid verification photo.
- [ ] 2. Confirm the verification photo is uploaded to `verification-photos` and the DB contains only a `storage://...` path.
- [ ] 3. Admin approves the new user.
- [ ] 4. Approved user can log in.
- [ ] 5. User can edit profile fields.
- [ ] 6. User can upload/change avatar; file is in `avatars`.
- [ ] 7. Admin can remove/review a verification photo through the existing UI/API.
- [ ] 8. Admin can edit a user.
- [ ] 9. Admin can delete a test user without leaving orphan records.

## Jobs and application deadline
- [ ] 10. PM/Admin can create a job.
- [ ] 11. PM/Admin can edit the job.
- [ ] 12. Set an Application Deadline using Malaysia time and verify it displays as `Apply before: DD Mon YYYY, h:mm AM/PM` (or equivalent).
- [ ] 13. A part-timer can apply before the deadline.
- [ ] 14. After the deadline, the frontend disables Apply and shows Applications closed.
- [ ] 15. Directly calling `POST /jobs/:id/apply` after the deadline returns HTTP 409 with `error: application_closed`.
- [ ] 16. Delete a test job and confirm related application/attendance rows cascade away and receipt files are removed best-effort.

## Applications, approval, idempotency and concurrency
- [ ] 17. Apply for a job normally.
- [ ] 18. PM/Admin approves an applicant.
- [ ] 19. PM/Admin rejects an applicant.
- [ ] 20. Reject an approved applicant, then approve again; status transitions correctly.
- [ ] 21. Double-click Approve: both Approve/Reject buttons disable immediately and only one state transition/notification occurs.
- [ ] 22. Replay the exact approval request with the same `Idempotency-Key`; response is safely replayed/no duplicate side effects occur.
- [ ] 23. Send two simultaneous approvals for the final available headcount slot; only one can consume that last slot.
- [ ] 24. Verify approved count never exceeds a positive job headcount.
- [ ] 25. Re-send Approve for an already approved applicant with a new request key; it returns success/idempotent without duplicate notification.

## Notifications and push
- [ ] 26. Approval inserts one notification and the notification summary increments.
- [ ] 27. Repeated identical approval does not create a duplicate approval notification.
- [ ] 28. Web push is delivered when valid VAPID keys/subscription exist.
- [ ] 29. Seed/use an invalid 404/410 push subscription; delivery failure does not fail the approval and invalid endpoint cleanup occurs.

## Operations
- [ ] 30. Loading/unloading mark/unmark works and quota enforcement is correct.
- [ ] 31. Early-call mark/unmark works on both compatibility route spellings.
- [ ] 32. Manual attendance marking works.
- [ ] 33. QR generation works.
- [ ] 34. Scanner heartbeat works.
- [ ] 35. Check-in works and late minutes are calculated.
- [ ] 36. Check-out works.
- [ ] 37. Break in/out works when enabled and is blocked when disabled.
- [ ] 38. Parking receipt upload stores file in private `parking-receipts` bucket.
- [ ] 39. Parking receipt authorised viewing works; unauthorised viewing is denied.
- [ ] 40. Parking receipt deletion removes the DB record and best-effort deletes the Storage object.
- [ ] 41. CSV export downloads/streams successfully without creating a persistent server file.
- [ ] 42. Password reset creates a token and the configured email provider sends the link.

## Persistence and failure behaviour
- [ ] 43. Restart/redeploy backend; users/jobs/attendance remain unchanged and no startup write is performed.
- [ ] 44. `GET /health` returns HTTP 200 and database status OK.
- [ ] 45. Temporarily point staging at a read-only/failing DB or otherwise simulate a DB write error; route returns controlled JSON and Node stays alive.
- [ ] 46. Confirm PostgreSQL `53100` maps to HTTP 507 `database_storage_full` (can be unit/integration simulated if Supabase cannot naturally reproduce it).
- [ ] 47. Confirm unique violation `23505` and FK violation `23503` are controlled responses, not process crashes.
- [ ] 48. After the full UAT, run `VERIFICATION.sql` and compare counts to the legacy migration summary.
