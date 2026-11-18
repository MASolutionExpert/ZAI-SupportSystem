-- AlterTable
ALTER TABLE "KnowledgeDocument" ADD COLUMN "sourceRef" TEXT;
ALTER TABLE "KnowledgeDocument" ADD COLUMN "validUntil" DATETIME;

-- CreateTable
CREATE TABLE "RagJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payload" TEXT NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "runAfter" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RagTrace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT,
    "departmentId" TEXT,
    "query" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "iterations" INTEGER NOT NULL DEFAULT 0,
    "llmCalls" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "finalConfidence" REAL,
    "correctiveActions" TEXT,
    "evidence" TEXT,
    "citations" TEXT,
    "conflictDetected" BOOLEAN NOT NULL DEFAULT false,
    "supersededExcluded" BOOLEAN NOT NULL DEFAULT false,
    "embeddingModel" TEXT,
    "budgetExceeded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RagEvalRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datasetId" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "passed" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "metricsJson" TEXT NOT NULL,
    "resultsJson" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_KnowledgeChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PARAGRAPH',
    "parentId" TEXT,
    "headingPath" TEXT,
    "page" INTEGER,
    "text" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "embedding" TEXT,
    "embeddingModel" TEXT,
    "embeddingDim" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeChunk_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "KnowledgeDocumentVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeChunk_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "KnowledgeChunk" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_KnowledgeChunk" ("createdAt", "documentId", "id", "isActive", "normalized", "ordinal", "text", "versionId") SELECT "createdAt", "documentId", "id", "isActive", "normalized", "ordinal", "text", "versionId" FROM "KnowledgeChunk";
DROP TABLE "KnowledgeChunk";
ALTER TABLE "new_KnowledgeChunk" RENAME TO "KnowledgeChunk";
CREATE INDEX "KnowledgeChunk_documentId_idx" ON "KnowledgeChunk"("documentId");
CREATE INDEX "KnowledgeChunk_isActive_idx" ON "KnowledgeChunk"("isActive");
CREATE INDEX "KnowledgeChunk_parentId_idx" ON "KnowledgeChunk"("parentId");
CREATE INDEX "KnowledgeChunk_embeddingModel_idx" ON "KnowledgeChunk"("embeddingModel");
CREATE UNIQUE INDEX "KnowledgeChunk_versionId_ordinal_key" ON "KnowledgeChunk"("versionId", "ordinal");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "RagJob_status_runAfter_idx" ON "RagJob"("status", "runAfter");

-- CreateIndex
CREATE INDEX "RagJob_type_idx" ON "RagJob"("type");

-- CreateIndex
CREATE INDEX "RagJob_createdAt_idx" ON "RagJob"("createdAt");

-- CreateIndex
CREATE INDEX "RagTrace_conversationId_idx" ON "RagTrace"("conversationId");

-- CreateIndex
CREATE INDEX "RagTrace_departmentId_idx" ON "RagTrace"("departmentId");

-- CreateIndex
CREATE INDEX "RagTrace_decision_idx" ON "RagTrace"("decision");

-- CreateIndex
CREATE INDEX "RagTrace_createdAt_idx" ON "RagTrace"("createdAt");

-- CreateIndex
CREATE INDEX "RagEvalRun_datasetId_idx" ON "RagEvalRun"("datasetId");

-- CreateIndex
CREATE INDEX "RagEvalRun_createdAt_idx" ON "RagEvalRun"("createdAt");
