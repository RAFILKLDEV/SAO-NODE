import { readFile, writeFile } from 'node:fs/promises';
const replacements = [
  ['apps/web/src/pages/ImportHistoryPage.jsx', 'className="modal import-history-detail"', 'ref={modalRef} className="modal import-history-detail"'],
  ['apps/web/src/pages/MapPage.jsx', "routePopup={roadMode === 'query' && selectedPins.length === 2 ?", "routePopup={roadMode === 'query' && selectedPins.length === 2 && !routePopupDismissed ?"],
  ['apps/web/src/pages/MapPage.jsx', 'onClose={() => changeMode(false)} /> : null}', 'onClose={() => changeMode(false)} onDismiss={() => setRoutePopupDismissed(true)} /> : null}']
];
for (const [file, before, after] of replacements) {
  const source = await readFile(file, 'utf8');
  if (source.split(before).length !== 2) throw new Error(`Trecho não é único: ${file}`);
  await writeFile(file, source.replace(before, after), 'utf8');
}
