const campaignLinks = [
  ['npcs', 'Personagens', '♟'],
  ['locations', 'Locais', '⌖'],
  ['items', 'Itens', '▣'],
  ['monsters', 'Monstros', '◆'],
  ['quests', 'Missões', '✦'],
  ['progress', 'Progresso e decisões', '◔'],
  ['groups', 'Grupos', '●']
];

export function resolveCampaignLinks({ isGm, visibleEntityTypes = new Set() }) {
  if (isGm) return campaignLinks;
  const visibleTypes = new Set(visibleEntityTypes);
  return campaignLinks.filter(([path]) => {
    if (path === 'progress' || path === 'groups') return true;
    return visibleTypes.has(path);
  });
}
