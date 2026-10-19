-- Staff employee identifiers were previously generated in the admin browser
-- (a random `EMP-###`) and discarded by the API. Persist them on the user row
-- so the staff directory and invoices/dispatch paperwork can rely on a stable
-- identifier. Nullable because customers have no employee id.
--
-- Written defensively so it is a no-op on databases where the column or index
-- was already added out-of-band.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employeeId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_employeeId_key" ON "users"("employeeId");
