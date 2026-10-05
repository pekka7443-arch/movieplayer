-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Rating" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "userId" TEXT,
    "profileId" TEXT NOT NULL DEFAULT 'main',
    "tmdbId" INTEGER NOT NULL,
    "mediaType" TEXT NOT NULL,
    "score" INTEGER,
    "note" TEXT,
    "watched" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Rating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Rating" ("createdAt", "id", "mediaType", "note", "ownerId", "profileId", "score", "tmdbId", "updatedAt", "userId", "watched") SELECT "createdAt", "id", "mediaType", "note", "ownerId", "profileId", "score", "tmdbId", "updatedAt", "userId", "watched" FROM "Rating";
DROP TABLE "Rating";
ALTER TABLE "new_Rating" RENAME TO "Rating";
CREATE INDEX "Rating_ownerId_updatedAt_idx" ON "Rating"("ownerId", "updatedAt");
CREATE UNIQUE INDEX "Rating_ownerId_tmdbId_mediaType_profileId_key" ON "Rating"("ownerId", "tmdbId", "mediaType", "profileId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

