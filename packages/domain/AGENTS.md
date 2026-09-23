# packages/domain

- Fonte de verdade das regras de domínio e do contrato saoData 2.0.
- Preserve prefixes de IDs e compatibilidade dos formatos existentes.
- `location.parentId` = hierarquia; `connections` = deslocamento.
- Backlinks devem ser derivados por consulta, não persistidos em duplicidade.
- Alterações em schemas/normalização exigem testes de domínio relacionados e avaliação do impacto em `packages/json` e API.
- Não transforme vocabulários extensíveis em enums fechados quando o contrato atual aceita valores personalizados.
