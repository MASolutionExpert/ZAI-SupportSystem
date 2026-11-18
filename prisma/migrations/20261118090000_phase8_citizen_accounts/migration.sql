-- DropIndex
DROP INDEX "IdentityVerificationRecord_expiresAt_idx";

-- DropIndex
DROP INDEX "IdentityVerificationRecord_customerId_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "IdentityVerificationRecord";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CustomerProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fullName" TEXT NOT NULL,
    "nationalIdEnc" TEXT NOT NULL,
    "nationalIdHmac" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_CustomerProfile" ("createdAt", "fullName", "id", "nationalIdEnc", "nationalIdHmac", "phone", "updatedAt") SELECT "createdAt", "fullName", "id", "nationalIdEnc", "nationalIdHmac", "phone", "updatedAt" FROM "CustomerProfile";
DROP TABLE "CustomerProfile";
ALTER TABLE "new_CustomerProfile" RENAME TO "CustomerProfile";
CREATE UNIQUE INDEX "CustomerProfile_nationalIdHmac_key" ON "CustomerProfile"("nationalIdHmac");
CREATE INDEX "CustomerProfile_fullName_idx" ON "CustomerProfile"("fullName");
CREATE INDEX "CustomerProfile_status_idx" ON "CustomerProfile"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

