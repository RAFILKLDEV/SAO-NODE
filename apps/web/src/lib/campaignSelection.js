export function getCampaignSelectionDecision(campaigns = []) {
  return campaigns.length === 1
    ? { autoSelect: true, mode: 'auto', campaignId: campaigns[0].id }
    : { autoSelect: false, mode: campaigns.length ? 'choose' : 'empty' };
}
