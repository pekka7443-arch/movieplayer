-- ArcadeScore: one personal-best row per owner per game.
CREATE TABLE "ArcadeScore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "total" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "ArcadeScore_ownerId_game_key" ON "ArcadeScore"("ownerId", "game");
CREATE INDEX "ArcadeScore_game_score_idx" ON "ArcadeScore"("game", "score");
