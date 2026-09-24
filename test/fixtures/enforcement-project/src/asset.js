export function transferir(asset, novoResponsavel) {
  if (asset.status === 'Baixado') throw new Error('Ativo baixado nao pode ser transferido');
  return { ...asset, responsible: novoResponsavel };
}
