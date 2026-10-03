#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const JOURNEYS = [
  { id: 1, name: 'bsh-governed-scenario', title: 'Sessão Governada — Detecção de Violação e Bloqueio SHACL' },
  { id: 2, name: 'bsh-ungoverned-scenario', title: 'Sessão Desgovernada — Operação sem Harness Ontológico' },
  { id: 3, name: 'bsh-cooperative-scenario', title: 'Sessão Governada Cooperativa — Alteração Conforme' },
  { id: 4, name: 'bsh-domain-mismatch-scenario', title: 'Detecção de Desalinhamento Ontológico' },
  { id: 5, name: 'bsh-model-search-scenario', title: 'Pesquisa de Modelos no OpenRouter' },
  { id: 6, name: 'bsh-mcp-server-scenario', title: 'Servidor MCP de Governança' },
  { id: 7, name: 'bsh-mcp-client-scenario', title: 'BSH como Cliente MCP' },
  { id: 8, name: 'bsh-scrollbar-history-loop-scenario', title: 'Barra de Rolagem e Histórico' },
  { id: 9, name: 'bsh-autonomous-coding-agent-scenario', title: 'Agente de Codificação Autônomo' },
  { id: 10, name: 'bsh-prompt-guard-negation-scenario', title: 'Guarda Semântica com Negações' },
  { id: 11, name: 'bsh-tui-queue-shortcuts-scenario', title: 'Ergonomia TUI e Fila FIFO' },
  { id: 12, name: 'bsh-advanced-ux-reasoning-diff-fuzzy-scenario', title: 'UX Avançada — CoT e Diff' },
  { id: 13, name: 'bsh-skills-prototype-scenario', title: 'Mecanismo de Skills e Prototipação' },
  { id: 14, name: 'bsh-skills-dynamic-inclusion', title: 'Loop Interativo com Inclusão de Skills' },
  { id: 15, name: 'bsh-slash-commands-menu', title: 'Paleta Flutuante de Comandos com Barra' },
  { id: 16, name: 'bsh-opentui-reconstruction-scenario', title: 'Reconstrução da TUI com Componentes Nativos' },
  { id: 17, name: 'bsh-segregacao-funcoes-e-conflito-interesses', title: 'Fraude de Segregação de Funções' },
  { id: 18, name: 'bsh-baixa-destrutiva-alto-valor-sem-alcada', title: 'Baixa Destrutiva de Alto Valor sem Alçada' },
  { id: 19, name: 'bsh-logistica-circular-extravio-alocacao-ilegal', title: 'Logística Circular e Extravio Ilegal' },
];

function sha256(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

const rootDir = resolve(import.meta.dirname, '..');
const localVideosDir = join(rootDir, 'evaluation', 'videos');
const localScreenshotsDir = join(rootDir, 'evaluation', 'screenshots');
const wslDownloadsDir = '/mnt/c/Users/clayt/Downloads/bsh';
const isWslAvailable = existsSync('/mnt/c/Users/clayt/Downloads');

console.log('='.repeat(80));
console.log('VERIFICAÇÃO DE VÍDEOS E SINCRONIZAÇÃO E2E WSL (ARQUIVOS NOVOS)');
console.log('='.repeat(80));
console.log(`Diretório Local de Vídeos: ${localVideosDir}`);
console.log(`Diretório WSL de Downloads: ${wslDownloadsDir} (disponível: ${isWslAvailable})`);
console.log('');

let totalErrors = 0;
const now = Date.now();
const MAX_AGE_MS = 60 * 60 * 1000; // Máximo 1 hora

for (const j of JOURNEYS) {
  const localVideo = join(localVideosDir, `${j.name}.mp4`);
  const localScreenshot = join(localScreenshotsDir, `${j.name}.png`);

  if (!existsSync(localVideo)) {
    console.error(`[ERRO] Jornada ${String(j.id).padStart(2, '0')}: Vídeo local inexistente: ${localVideo}`);
    totalErrors++;
    continue;
  }
  if (!existsSync(localScreenshot)) {
    console.error(`[ERRO] Jornada ${String(j.id).padStart(2, '0')}: Screenshot local inexistente: ${localScreenshot}`);
    totalErrors++;
    continue;
  }

  const vStat = statSync(localVideo);
  const sStat = statSync(localScreenshot);

  if (vStat.size < 10000) {
    console.error(`[ERRO] Jornada ${String(j.id).padStart(2, '0')}: Vídeo corrompido ou vazio (${vStat.size} bytes)`);
    totalErrors++;
    continue;
  }
  if (sStat.size < 5000) {
    console.error(`[ERRO] Jornada ${String(j.id).padStart(2, '0')}: Screenshot corrompida ou vazia (${sStat.size} bytes)`);
    totalErrors++;
    continue;
  }

  // Verifica se o arquivo é recente (gerado nesta sessão)
  if (now - vStat.mtimeMs > MAX_AGE_MS) {
    console.error(`[ERRO] Jornada ${String(j.id).padStart(2, '0')}: Vídeo é antigo (${new Date(vStat.mtimeMs).toISOString()}), não foi regerado!`);
    totalErrors++;
    continue;
  }

  const localVideoHash = sha256(localVideo);
  const localShotHash = sha256(localScreenshot);

  if (isWslAvailable) {
    const wslVideo = join(wslDownloadsDir, `${j.name}.mp4`);
    const wslScreenshot = join(wslDownloadsDir, `${j.name}.png`);

    if (!existsSync(wslVideo)) {
      console.error(`[ERRO] Jornada ${String(j.id).padStart(2, '0')}: Vídeo não sincronizado em WSL: ${wslVideo}`);
      totalErrors++;
      continue;
    }
    if (!existsSync(wslScreenshot)) {
      console.error(`[ERRO] Jornada ${String(j.id).padStart(2, '0')}: Screenshot não sincronizada em WSL: ${wslScreenshot}`);
      totalErrors++;
      continue;
    }

    const wslVideoHash = sha256(wslVideo);
    const wslShotHash = sha256(wslScreenshot);

    if (localVideoHash !== wslVideoHash) {
      console.error(`[ERRO] Jornada ${String(j.id).padStart(2, '0')}: Divergência de hash SHA-256 no vídeo!`);
      console.error(`  Local: ${localVideoHash}`);
      console.error(`  WSL:   ${wslVideoHash}`);
      totalErrors++;
      continue;
    }
    if (localShotHash !== wslShotHash) {
      console.error(`[ERRO] Jornada ${String(j.id).padStart(2, '0')}: Divergência de hash SHA-256 na screenshot!`);
      totalErrors++;
      continue;
    }
  }

  console.log(`✔ Jornada ${String(j.id).padStart(2, '0')}: [OK NOVO] ${j.name}.mp4 (${(vStat.size / 1024).toFixed(1)} KB) | SHA-256: ${localVideoHash.slice(0, 16)}...`);
}

console.log('');
if (totalErrors > 0) {
  console.error(`Falha na verificação de integridade E2E: ${totalErrors} erro(s) encontrado(s).`);
  process.exit(1);
} else {
  console.log(`✔ Todas as ${JOURNEYS.length} jornadas foram regeradas do zero, são recentes e estão 100% sincronizadas com SHA-256 idêntico!`);
  process.exit(0);
}
