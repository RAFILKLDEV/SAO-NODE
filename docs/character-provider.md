# CharacterProvider

Contrato esperado:

```js
listCharacters()
getCharacterByExternalId(externalId)
getSnapshot(externalId)
openExternalCharacter(externalId)
createCharacter(input)
```

`ManualCharacterProvider` e `MockCharacterProvider` ficam em `@sao/domain`. O backend persiste `CharacterBinding` e snapshots locais.

Não existe nesta implementação uma ponte direta Node.js → APIs internas do Firecast. Um bridge futuro deve implementar o mesmo contrato por um canal oficialmente suportado e autenticar cada operação. `Ambesek.Tormenta20` é normalizado para `Ambesek.T20` apenas como compatibilidade de identificador.
