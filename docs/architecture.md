# Arquitetura

## Monorepo

- `apps/api`: Fastify, sessão, autorização, Prisma, Socket.IO e OpenAPI.
- `apps/web`: React/Vite, Router, TanStack Query, formulários e UI responsiva.
- `packages/domain`: regras puras e schemas de domínio.
- `packages/json`: documento versionado, validação Zod, diff e exportação.
- `packages/shared`: constantes e contratos compartilhados.

## Fluxo de requisição

1. Cookie de sessão opaco é convertido em hash e resolvido no banco.
2. O `campaignId` da rota é conferido contra `Membership`; falhas retornam 404 para reduzir IDOR.
3. Mutação exige CSRF e, quando aplicável, papel de mestre.
4. Serviço consulta somente registros da campanha.
5. Gate de existência e grants são avaliados no servidor.
6. Campos/objetivos/componentes não autorizados são removidos antes da serialização.
7. Mutação sensível registra `AuditLog` e publica evento apenas na room Socket.IO da campanha.

## Concorrência

Entidades possuem `version`; update exige `If-Match`. Progresso também é versionado. Conflitos retornam 409 em vez de sobrescrever silenciosamente.

## JSON

O preview recebe JSON colado ou carregado, valida tamanho, sintaxe, versão e schemas Zod, resolve avisos e cria o diff. O apply usa uma prévia efêmera vinculada a usuário+campanha e executa toda a seleção em uma transação Prisma.

`REMOVED_FROM_JSON` nunca vem selecionado e, quando escolhido, faz soft-delete. Grants, auditoria e runtime permanecem intactos.

## Tempo real

O socket só entra em `campaign:<id>` depois de validar sessão e membership no servidor. Eventos servem para invalidar caches; o navegador volta a consultar a API, portanto permissões continuam sendo aplicadas no servidor.
