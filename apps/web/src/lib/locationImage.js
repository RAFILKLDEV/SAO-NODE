export const locationImageAccept = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp,.png,.jpg,.jpeg,.gif,.webp,.avif,.bmp';

export function locationImageUrlError(value) {
  const url = value.trim();
  if (!url || /^\/api\/v1\/campaigns\/[^/]+\/media\/[a-f0-9-]+\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(url)) return '';
  try {
    const parsed = new URL(url);
    if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) return '';
  } catch { /* Report the same actionable message for malformed URLs. */ }
  return 'Informe um link HTTP ou HTTPS válido, sem usuário ou senha.';
}

export function locationImageFileError(file) {
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'].includes(file.type)) {
    return 'Escolha uma imagem PNG, JPEG, GIF, WebP, AVIF ou BMP.';
  }
  if (!file.size) return 'O arquivo de imagem está vazio.';
  return '';
}
