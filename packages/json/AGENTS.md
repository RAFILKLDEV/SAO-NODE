# packages/json

- Preserve import/export v1/v2, validação, diff e round-trip existentes.
- Não descarte campos legados/extensões silenciosamente.
- `REMOVED_FROM_JSON` não deve virar exclusão destrutiva por acidente.
- Ao alterar parser/exportador, teste pacotes pequenos em `examples/`; não use backups grandes salvo quando necessário para regressão específica.
- Mantenha a saída determinística quando isso já for esperado pelos testes.
