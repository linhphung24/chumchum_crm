-- CreateTable
CREATE TABLE "DomainVerification" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verificationKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "method" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DomainVerification_domain_key" ON "DomainVerification"("domain");
CREATE UNIQUE INDEX "DomainVerification_verificationKey_key" ON "DomainVerification"("verificationKey");
