ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3), ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Project" ADD COLUMN "additionalOrigins" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "targetRevision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "verificationToken" TEXT,
  ADD COLUMN "verificationMethod" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Project_verificationToken_key" ON "Project"("verificationToken");
ALTER TABLE "Suite" ADD COLUMN "approvedTargetRevision" INTEGER;
CREATE TABLE "Identity" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "provider" TEXT NOT NULL, "subject" TEXT NOT NULL
);
CREATE UNIQUE INDEX "Identity_provider_subject_key" ON "Identity"("provider", "subject");
CREATE UNIQUE INDEX "Identity_userId_provider_key" ON "Identity"("userId", "provider");
CREATE TABLE "AuthToken" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "kind" TEXT NOT NULL, "hash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL, "consumedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "AuthToken_hash_key" ON "AuthToken"("hash");
CREATE INDEX "AuthToken_userId_kind_createdAt_idx" ON "AuthToken"("userId", "kind", "createdAt");
