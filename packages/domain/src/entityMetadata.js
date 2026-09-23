export const labels = {
  npc: 'Personagens',
  location: 'Locais',
  item: 'Itens',
  monster: 'Monstros',
  quest: 'Missões'
};
export const bulkEntityLabels = {
  npc: 'Liberar personagens',
  location: 'Liberar locais',
  item: 'Liberar itens',
  monster: 'Liberar monstros',
  quest: 'Liberar missões'
};
export const entityTypeLabels = {
  npc: 'Personagem',
  location: 'Local',
  item: 'Item',
  monster: 'Monstro',
  quest: 'Missão'
};
export const singular = {
  npc: 'Personagem',
  location: 'Local',
  item: 'Item',
  monster: 'Monstro',
  quest: 'Missão'
};
export const entityTypes = Object.keys(labels);
export const objectiveTypeLabels = {
  talk: 'Falar',
  kill: 'Matar',
  collect: 'Coletar',
  explore: 'Explorar',
  deliver: 'Entregar',
  interact: 'Interagir',
  survive: 'Sobreviver',
  custom: 'Personalizado'
};
export const referenceRoleLabels = {
  related: 'Relacionado',
  friend: 'Amigo',
  ally: 'Aliado',
  enemy: 'Inimigo',
  family: 'Família',
  rival: 'Rival',
  visited: 'Visitado',
  'part-of': 'Parte de',
  'used-by': 'Utilizado por',
  'managed-by': 'Administrado por',
  start: 'Início',
  completion: 'Entrega',
  next: 'Próxima missão',
  parent: 'Superior',
  connection: 'Conexão',
  requirement: 'Requisito',
  reward: 'Recompensa',
  drops: 'Drop',
  drop: 'Drop'
};
export const referenceRoleOptions = [
  { value: 'related', label: 'Relacionado' },
  { value: 'friend', label: 'Amigo' },
  { value: 'ally', label: 'Aliado' },
  { value: 'enemy', label: 'Inimigo' },
  { value: 'family', label: 'Família' },
  { value: 'rival', label: 'Rival' },
  { value: 'drops', label: 'Drop' }
];
export const operationOptions = [
  { value: 'set', label: 'Definir valor' },
  { value: 'add', label: 'Adicionar' },
  { value: 'subtract', label: 'Subtrair' },
  { value: 'multiply', label: 'Multiplicar' }
];
export const questTypeOptions = [
  { value: 'main', label: 'Principal' },
  { value: 'side', label: 'Secundária' },
  { value: 'daily', label: 'Diária' },
  { value: 'event', label: 'Evento' }
];
export const questStateOptions = [
  { value: 'available', label: 'Disponível' },
  { value: 'active', label: 'Ativa' },
  { value: 'completed', label: 'Concluída' },
  { value: 'failed', label: 'Falhou' },
  { value: 'hidden', label: 'Oculta' }
];
export const requirementLogicOptions = [
  { value: 'all', label: 'Todos os requisitos' },
  { value: 'any', label: 'Qualquer requisito' }
];
export const objectiveModeOptions = [
  { value: 'free', label: 'Livre' },
  { value: 'ordered', label: 'Em ordem' }
];
export const locationTypeOptions = [
  { value: 'region', label: 'Região' },
  { value: 'city', label: 'Cidade' },
  { value: 'district', label: 'Distrito' },
  { value: 'bank', label: 'Banco' },
  { value: 'market', label: 'Mercado' },
  { value: 'workshop', label: 'Oficina' },
  { value: 'plaza', label: 'Praça' },
  { value: 'government', label: 'Centro administrativo' },
  { value: 'storage', label: 'Armazenamento' },
  { value: 'temple', label: 'Templo' },
  { value: 'inn', label: 'Hospedaria' },
  { value: 'shop', label: 'Loja' },
  { value: 'residence', label: 'Residência' },
  { value: 'building', label: 'Edifício' },
  { value: 'floor', label: 'Andar' },
  { value: 'dungeon', label: 'Masmorra' },
  { value: 'room', label: 'Sala' },
  { value: 'landmark', label: 'Ponto de interesse' }
];
export const locationStateOptions = [
  { value: 'safe', label: 'Seguro' },
  { value: 'dangerous', label: 'Perigoso' },
  { value: 'unknown', label: 'Desconhecido' },
  { value: 'blocked', label: 'Bloqueado' }
];
export const itemCategoryOptions = [
  { value: 'weapon', label: 'Arma' },
  { value: 'armor', label: 'Armadura' },
  { value: 'shield', label: 'Escudo' },
  { value: 'ammunition', label: 'Munição' },
  { value: 'consumable', label: 'Consumível' },
  { value: 'equipment', label: 'Equipamento' },
  { value: 'tool', label: 'Ferramenta' },
  { value: 'material', label: 'Material' },
  { value: 'treasure', label: 'Tesouro' },
  { value: 'quest', label: 'Missão' },
  { value: 'misc', label: 'Diversos' }
];
export const itemRarityOptions = [
  { value: 'common', label: 'Comum' },
  { value: 'uncommon', label: 'Incomum' },
  { value: 'rare', label: 'Raro' },
  { value: 'epic', label: 'Épico' },
  { value: 'legendary', label: 'Lendário' },
  { value: 'unique', label: 'Único' }
];
export const monsterSizeOptions = [
  { value: 'tiny', label: 'Minúsculo' },
  { value: 'small', label: 'Pequeno' },
  { value: 'medium', label: 'Médio' },
  { value: 'large', label: 'Grande' },
  { value: 'huge', label: 'Enorme' },
  { value: 'gargantuan', label: 'Colossal' }
];
export const monsterTypeOptions = [
  { value: 'animal', label: 'Animal' },
  { value: 'construct', label: 'Constructo' },
  { value: 'humanoid', label: 'Humanoide' },
  { value: 'monstrosity', label: 'Monstruosidade' },
  { value: 'undead', label: 'Morto-vivo' },
  { value: 'other', label: 'Outro' }
];
export const monsterSubtypeOptions = [
  { value: 'none', label: 'Nenhum' },
  { value: 'goblinoid', label: 'Goblinóide' },
  { value: 'dragon', label: 'Dragão' },
  { value: 'elemental', label: 'Elemental' },
  { value: 'other', label: 'Outro' }
];
export const rewardTypeOptions = [
  ...Object.entries(entityTypeLabels).map(([value, label]) => ({ value, label })),
  { value: 'currency', label: 'Moeda' },
  { value: 'xp', label: 'Experiência' },
  { value: 'custom', label: 'Personalizada' }
];
export const idPrefixes = {
  npc: 'npc.',
  location: 'loc.',
  item: 'item.',
  monster: 'monster.',
  quest: 'quest.'
};

export const visibilityLabels = {
  public: 'Público',
  gm: 'Somente mestre',
  discoverable: 'Descobrível'
};

export const fieldLabels = {
  shortDescription: 'Resumo',
  description: 'Descrição',
  gmNotes: 'Anotações do mestre',
  title: 'Título',
  level: 'Nível',
  race: 'Raça',
  gender: 'Gênero',
  age: 'Idade',
  profession: 'Profissão',
  type: 'Tipo',
  state: 'Estado',
  andar: 'Andar',
  parentId: 'Local superior',
  environment: 'Ambiente',
  levelRecommended: 'Nível recomendado',
  recommendedLevel: 'Nível recomendado',
  category: 'Categoria',
  rarity: 'Raridade',
  value: 'Valor',
  group: 'Grupo',
  subtitle: 'Subtítulo',
  requirementLogic: 'Lógica',
  objectiveMode: 'Ordem dos objetivos',
  objectivesMode: 'Ordem dos objetivos',
  nd: 'ND',
  subtype: 'Subtipo',
  size: 'Tamanho',
  initiative: 'Iniciativa',
  perception: 'Percepção',
  senses: 'Sentidos',
  defense: 'Defesa',
  fortitude: 'Fortitude',
  reflex: 'Reflexos',
  will: 'Vontade',
  hp: 'PV',
  hpMax: 'PV máximo',
  mp: 'PM',
  mpMax: 'PM máximo',
  strength: 'Força',
  dexterity: 'Destreza',
  constitution: 'Constituição',
  intelligence: 'Inteligência',
  wisdom: 'Sabedoria',
  charisma: 'Carisma',
  name: 'Nome',
  action: 'Ação',
  bonus: 'Bônus',
  damage: 'Dano',
  critical: 'Crítico',
  damageType: 'Tipo de dano',
  range: 'Alcance',
  quantity: 'Quantidade',
  notes: 'Notas',
  meters: 'Metros',
  mpCost: 'Custo de PM',
  save: 'Resistência',
  dc: 'CD',
  operation: 'Operação',
  minimum: 'Mínimo',
  prerequisites: 'Pré-requisitos',
  choiceGroup: 'Grupo de escolha',
  currency: 'Moeda',
  amount: 'Valor',
  distanceKm: 'Distância (km)',
  travelMinutes: 'Tempo (min)',
  access: 'Acesso',
  appearance: 'Aparência',
  personality: 'Personalidade',
  history: 'História',
  services: 'Serviços',
  instantTransfers: 'Transferências instantâneas',
  accessRestriction: 'Restrição de acesso',
  storedCurrency: 'Moeda armazenada',
  designPurpose: 'Finalidade do projeto',
  restRequirement: 'Requisito de descanso',
  pioneerLodging: 'Hospedagem pioneira',
  commonLodging: 'Hospedagem comum',
  comfortableLodging: 'Hospedagem confortável',
  luxuryLodging: 'Hospedagem de luxo',
  economyRule: 'Regra de economia',
  npcPurchasePrice: 'Preço de compra dos NPCs',
  npcSellPrice: 'Preço de venda dos NPCs',
  bargain: 'Barganha',
  restrictions: 'Restrições',
  stations: 'Estações',
  tools: 'Ferramentas',
  craftMaterialCost: 'Custo de materiais de fabricação',
  simpleItemDC: 'CD de item simples',
  complexItemDC: 'CD de item complexo',
  queueSystem: 'Sistema de filas',
  privateWorkshopAdvantage: 'Vantagem da oficina privada',
  duelArea: 'Área de duelos',
  trainingDummies: 'Bonecos de treinamento',
  missionBoard: 'Quadro de missões',
  teleportRule: 'Regra de teletransporte',
  spawnPoint: 'Ponto de surgimento',
  propertyServices: 'Serviços da propriedade',
  guildServices: 'Serviços da guilda',
  commercialServices: 'Serviços comerciais',
  roomManagement: 'Administração dos quartos',
  auctions: 'Leilões',
  pioneerChest: 'Baú pioneiro',
  simpleChest: 'Baú simples',
  largeChest: 'Baú grande',
  reinforcedChest: 'Baú reforçado',
  storageRoom: 'Depósito',
  warehouse: 'Armazém',
  t20InventoryReference: 'Referência de inventário T20',
  meditationInterval: 'Intervalo de meditação',
  initialDivineContactChance: 'Chance inicial de contato divino',
  divineContactProgression: 'Progressão do contato divino',
  multipleAttempts: 'Múltiplas tentativas',
  chancePersistence: 'Persistência da chance',
  chanceReset: 'Reinício da chance',
  activePurposeLimit: 'Limite de finalidades ativas',
  propertyProgression: 'Progressão da propriedade',
  propertyRule: 'Regra da propriedade',
  offlineSales: 'Vendas offline',
  economyPurpose: 'Finalidade econômica',
  propertyUse: 'Uso da propriedade',
  availableRooms: 'Quartos disponíveis',
  bankingRoom: 'Sala bancária',
  mailRoom: 'Sala de correio',
  mailNotification: 'Notificação de correio',
  guildPermissions: 'Permissões da guilda'
};

export const sectionLabels = {
  basic: 'Informações básicas',
  identity: 'Identidade',
  services: 'Serviços',
  locations: 'Locais',
  relations: 'Relações',
  t20: 'Ficha T20',
  additional: 'Informações adicionais',
  references: 'Referências',
  stats: 'Atributos',
  requirements: 'Requisitos',
  flow: 'Fluxo da missão',
  rewards: 'Recompensas'
};

export const monsterStatLabels = {
  basic: 'Informações básicas',
  nd: 'ND',
  type: 'Tipo',
  subtype: 'Subtipo',
  size: 'Tamanho',
  combat: 'Combate',
  resources: 'Recursos',
  resistances: 'Resistências',
  attributes: 'Atributos'
};

export const sectionFields = {
  npc: {
    basic: [
      'title',
      'subtitle',
      'level',
      'imageURL',
      'imageUrl',
      'tokenUrl',
      'portraitUrl',
      'sourceUrl',
      'tags'
    ],
    identity: ['identity', 'race', 'gender', 'age', 'profession'],
    locations: ['mainLocationId', 'primaryLocationId', 'currentLocationId', 'locations'],
    relations: ['relations', 'factions'],
    services: ['services'],
    t20: ['t20']
  },
  location: {
    basic: [
      'subtitle',
      'type',
      'state',
      'parentId',
      'placement',
      'environment',
      'levelRecommended',
      'recommendedLevel',
      'imageURL',
      'imageUrl',
      'mapUrl',
      'tags'
    ],
    services: ['services']
  },
  item: {
    basic: ['subtitle', 'category', 'rarity', 'imageURL', 'imageUrl', 'value', 'tags'],
    stats: ['stats']
  },
  monster: {
    basic: ['subtitle', 'group', 'imageURL', 'imageUrl', 'tags'],
    t20: ['t20']
  },
  quest: {
    basic: [
      'subtitle',
      'type',
      'state',
      'levelRecommended',
      'recommendedLevel',
      'imageURL',
      'imageUrl',
      'tags'
    ],
    requirements: ['requirementLogic', 'requirements', 'prerequisites'],
    flow: ['startSource', 'completionReceiver', 'nextQuests', 'timeLimitMinutes'],
    rewards: ['rewards']
  }
};
