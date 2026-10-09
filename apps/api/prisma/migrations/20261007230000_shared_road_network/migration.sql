-- Start the independent road network empty; preserve every legacy route and pin.
ALTER TABLE "MapBoard" ADD COLUMN "roadNetwork" JSONB;
