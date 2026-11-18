-- AlterTable
ALTER TABLE "Department" ADD COLUMN "aiSettings" TEXT;

-- CreateTable
CREATE TABLE "KnowledgeCollection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "access" TEXT NOT NULL DEFAULT 'DEPARTMENT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "KnowledgeCollectionDepartment" (
    "collectionId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("collectionId", "departmentId"),
    CONSTRAINT "KnowledgeCollectionDepartment_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "KnowledgeCollection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeCollectionDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "statusError" TEXT,
    "extractedChars" INTEGER,
    "chunkCount" INTEGER,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgeDocument_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "KnowledgeCollection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeDocument_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeDocumentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeDocumentVersion_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeChunk_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "KnowledgeDocumentVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeQaEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "question" TEXT NOT NULL,
    "officialAnswer" TEXT NOT NULL,
    "category" TEXT,
    "keywords" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgeQaEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeQaAlternate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    CONSTRAINT "KnowledgeQaAlternate_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "KnowledgeQaEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeQaDepartment" (
    "entryId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,

    PRIMARY KEY ("entryId", "departmentId"),
    CONSTRAINT "KnowledgeQaDepartment_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "KnowledgeQaEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeQaDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeRetrievalRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT,
    "departmentId" TEXT,
    "queryDigest" TEXT NOT NULL,
    "queryText" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "topScore" REAL,
    "sources" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeRetrievalRecord_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "departmentId" TEXT NOT NULL,
    "customerToken" TEXT NOT NULL,
    "customerName" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'AI_ASSISTED',
    "assignedToId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastMessageAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Conversation_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Conversation_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourcesCount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiUsageLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT,
    "departmentId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiUsageLog_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "KnowledgeCollection_access_idx" ON "KnowledgeCollection"("access");

-- CreateIndex
CREATE INDEX "KnowledgeCollection_isActive_idx" ON "KnowledgeCollection"("isActive");

-- CreateIndex
CREATE INDEX "KnowledgeCollectionDepartment_departmentId_idx" ON "KnowledgeCollectionDepartment"("departmentId");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_collectionId_idx" ON "KnowledgeDocument"("collectionId");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_status_idx" ON "KnowledgeDocument"("status");

-- CreateIndex
CREATE INDEX "KnowledgeDocumentVersion_documentId_idx" ON "KnowledgeDocumentVersion"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeDocumentVersion_documentId_versionNo_key" ON "KnowledgeDocumentVersion"("documentId", "versionNo");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_documentId_idx" ON "KnowledgeChunk"("documentId");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_isActive_idx" ON "KnowledgeChunk"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_versionId_ordinal_key" ON "KnowledgeChunk"("versionId", "ordinal");

-- CreateIndex
CREATE INDEX "KnowledgeQaEntry_status_idx" ON "KnowledgeQaEntry"("status");

-- CreateIndex
CREATE INDEX "KnowledgeQaEntry_createdById_idx" ON "KnowledgeQaEntry"("createdById");

-- CreateIndex
CREATE INDEX "KnowledgeQaAlternate_entryId_idx" ON "KnowledgeQaAlternate"("entryId");

-- CreateIndex
CREATE INDEX "KnowledgeQaDepartment_departmentId_idx" ON "KnowledgeQaDepartment"("departmentId");

-- CreateIndex
CREATE INDEX "KnowledgeRetrievalRecord_conversationId_idx" ON "KnowledgeRetrievalRecord"("conversationId");

-- CreateIndex
CREATE INDEX "KnowledgeRetrievalRecord_decision_idx" ON "KnowledgeRetrievalRecord"("decision");

-- CreateIndex
CREATE INDEX "KnowledgeRetrievalRecord_createdAt_idx" ON "KnowledgeRetrievalRecord"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_customerToken_key" ON "Conversation"("customerToken");

-- CreateIndex
CREATE INDEX "Conversation_departmentId_idx" ON "Conversation"("departmentId");

-- CreateIndex
CREATE INDEX "Conversation_mode_idx" ON "Conversation"("mode");

-- CreateIndex
CREATE INDEX "Conversation_customerToken_idx" ON "Conversation"("customerToken");

-- CreateIndex
CREATE INDEX "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageLog_departmentId_idx" ON "AiUsageLog"("departmentId");

-- CreateIndex
CREATE INDEX "AiUsageLog_outcome_idx" ON "AiUsageLog"("outcome");

-- CreateIndex
CREATE INDEX "AiUsageLog_createdAt_idx" ON "AiUsageLog"("createdAt");
