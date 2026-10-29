CREATE UNIQUE INDEX "scheduled_emails_userId_idempotencyKey_key"
ON "scheduled_emails"("userId", "idempotencyKey");
