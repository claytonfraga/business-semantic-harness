#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const rootDir = resolve(import.meta.dirname, '..');

function run(cmd, args, description) {
  console.log(`\n>>> [PIPELINE E2E] ${description} (${cmd} ${args.join(' ')})`);
  const res = spawnSync(cmd, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) {
    console.error(`\n✖ [FALHA] ${description} finalizou com código ${res.status}`);
    process.exit(res.status ?? 1);
  }
}

// 1. Executa as suítes de testes E2E ao vivo e isolamento de worktree
run(
  'node',
  ['--test', '--experimental-test-isolation=none', 'test/e2e-live/ux-ergonomics-adversarial.e2e.mjs', 'test/e2e-live/worktree-adversarial.e2e.mjs', 'test/e2e-live/worktree-isolation.e2e.mjs', 'test/e2e-live/tui-scrollbar-and-history.e2e.mjs', 'test/e2e-live/prompt-violation-confirmation.e2e.mjs', 'test/e2e-live/autonomous-coding-agent.e2e.mjs', 'test/e2e-live/mcp-server-user-journey.e2e.mjs', 'test/e2e-live/mcp-client-third-party.e2e.mjs', 'test/e2e-live/web-auth.e2e.mjs'],
  'Execução das suítes de teste de integração e isolamento E2E'
);

// 2. Se executando com flag --record ou se vídeos não estiverem gerados (em ambiente local)
const isCI = Boolean(process.env.CI);
const videosDir = join(rootDir, 'evaluation', 'videos');
const shouldRecord = !isCI && (process.argv.includes('--record') || !existsSync(join(videosDir, 'bsh-logistica-circular-extravio-alocacao-ilegal.mp4')));

if (shouldRecord) {
  run(
    'python3',
    ['scripts/run_all_e2e_journeys.py'],
    'Gravação Cinematográfica e Fidedigna das Jornadas E2E Master'
  );
}

// 3. Verificação de integridade dos vídeos e sincronização bit-a-bit com o WSL Downloads (apenas fora do CI)
if (!isCI) {
  run(
    'node',
    ['scripts/verify-e2e-sync.mjs'],
    'Verificação de Integridade dos Vídeos e Sincronização WSL'
  );
} else {
  console.log('\n[CI] Ambiente de CI detectado: verificação de montagem WSL do Windows dispensada.');
}

console.log('\n✔ [SUCESSO] Pipeline E2E completo finalizado com êxito!');
