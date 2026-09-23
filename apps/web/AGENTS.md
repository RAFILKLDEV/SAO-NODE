# apps/web

- O servidor é a autoridade de permissões; não implemente segurança apenas escondendo elementos na UI.
- Preserve React Query/cache e invalidações em tempo real existentes.
- `src/pages/EntityPage.jsx` é grande: não leia o arquivo inteiro por padrão. Localize função/componente com busca e abra apenas o intervalo relevante.
- Reutilize helpers de `src/lib/` antes de adicionar lógica duplicada em páginas.
- Não edite `dist/` ou `node_modules/`; eles são artefatos/dependências gerados.
- Rode primeiro os testes dos helpers/componentes diretamente afetados.
