-- SupportMessage.senderId becomes a real foreign key so conversation threads can
-- be rendered with the author's name and role.
ALTER TABLE "support_messages"
  ADD CONSTRAINT "support_messages_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "support_messages_senderId_idx" ON "support_messages"("senderId");