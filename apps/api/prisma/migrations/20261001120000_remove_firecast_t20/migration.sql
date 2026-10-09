UPDATE "Entity"
SET "data" = CASE
  WHEN "type" = 'monster' THEN jsonb_set(
    jsonb_set(
      ("data" - 't20'::text - 'character'::text - 'sheet'::text - 'extraStatBlocks'::text),
      '{rank}',
      to_jsonb(COALESCE(
        "data"->>'rank',
        CASE
          WHEN lower("data"->>'group') = 'boss'
            OR "data" #>> '{statBlocks,default,boss}' = 'true'
            OR "data" #>> '{statBlocks,Ambesek.T20,boss}' = 'true'
            OR "data" #>> '{statBlocks,Ambesek.Tormenta20,boss}' = 'true'
            OR "data" #>> '{sheet,boss}' = 'true' THEN 'boss'
          WHEN lower("data"->>'group') = 'elite'
            OR "data" #>> '{statBlocks,default,elite}' = 'true'
            OR "data" #>> '{statBlocks,Ambesek.T20,elite}' = 'true'
            OR "data" #>> '{statBlocks,Ambesek.Tormenta20,elite}' = 'true'
            OR "data" #>> '{sheet,elite}' = 'true' THEN 'elite'
          ELSE 'common'
        END
      )),
      true
    ),
    '{statBlocks}',
    (
      (COALESCE("data"->'statBlocks', '{}'::jsonb) || COALESCE("data"->'extraStatBlocks', '{}'::jsonb))
        - 'Ambesek.T20'::text - 'Ambesek.Tormenta20'::text
    ) || CASE
      WHEN jsonb_typeof("data"->'sheet') = 'object' AND "data"->'sheet' <> '{}'::jsonb
        THEN jsonb_build_object('default', ("data"->'sheet') - ARRAY['elite', 'boss']::text[])
      ELSE '{}'::jsonb
    END,
    true
  )
  ELSE "data" - 'character'::text - 't20'::text
END
WHERE "data" ? 'character'
   OR "data" ? 't20'
   OR "data" ? 'sheet'
   OR "data" ? 'extraStatBlocks'
   OR "data" #> '{statBlocks,Ambesek.T20}' IS NOT NULL
   OR "data" #> '{statBlocks,Ambesek.Tormenta20}' IS NOT NULL;

DROP TABLE IF EXISTS "CharacterBinding";