-- AlterTable
ALTER TABLE "Department" ADD COLUMN "operatorQuotaBytes" INTEGER;
ALTER TABLE "Department" ADD COLUMN "storageQuotaBytes" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "storageQuotaBytes" INTEGER;

-- CreateTable
CREATE TABLE "SharedFolder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "departmentId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SharedFolder_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SharedFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "SharedFolder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SharedFolder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SharedFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "departmentId" TEXT NOT NULL,
    "folderId" TEXT,
    "name" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "scanStatus" TEXT NOT NULL DEFAULT 'SKIPPED',
    "uploadedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SharedFile_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SharedFile_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "SharedFolder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SharedFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SharedFolder_departmentId_parentId_idx" ON "SharedFolder"("departmentId", "parentId");

-- CreateIndex
CREATE INDEX "SharedFolder_createdById_idx" ON "SharedFolder"("createdById");

-- CreateIndex
CREATE INDEX "SharedFile_departmentId_folderId_idx" ON "SharedFile"("departmentId", "folderId");

-- CreateIndex
CREATE INDEX "SharedFile_uploadedById_idx" ON "SharedFile"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "SharedFile_departmentId_folderId_name_key" ON "SharedFile"("departmentId", "folderId", "name");

