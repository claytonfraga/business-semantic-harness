export function transferir(asset, novoResponsavel) {
  if (asset.status === 'Baixado') throw new Error('Ativo baixado nao pode ser transferido');
  if (!novoResponsavel) throw new Error('responsavel obrigatorio');
  return { ...asset, responsible: novoResponsavel };
}

export function darBaixa(asset, motivo) {
  if (asset.status === 'Baixado') throw new Error('Ativo ja baixado');
  if (!motivo) throw new Error('motivo obrigatorio');
  return { ...asset, status: 'Baixado' };
}

export function alterarResponsavel(asset, novoResponsavel) {
  if (asset.status === 'Baixado') throw new Error('Ativo baixado nao pode mudar de responsavel');
  return { ...asset, responsible: novoResponsavel };
}

export function alterarLocalizacao(asset, novaLocalizacao) {
  if (asset.status === 'Baixado') throw new Error('Ativo baixado nao pode mudar de localizacao');
  return { ...asset, location: novaLocalizacao };
}
