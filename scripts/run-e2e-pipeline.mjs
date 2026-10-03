#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { existsSync, readdirSync, rmSync } from 'node:fs';

const rootDir = resolve(import.meta.dirname, '..');

function purgeExistingMedia() {
  console.log('\n================================================================================');
  console.log('>>> [PURGE OBRIGATÓRIO] Removendo todos os vídeos e capturas de tela prévios...');
  console.log('================================================================================');
  const dirs = [
    join(rootDir, 'evaluation', 'videos'),
    join(rootDir, 'evaluation', 'screenshots'),
    '/mnt/c/Users/clayt/Downloads/bsh',
  ];

  let removedCount = 0;
  for (const dir of dirs) {
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter(f => f.endsWith('.mp4') || f.endsWith('.png'));
      for (const file of files) {
        rmSync(join(dir, file), { force: true });
        removedCount++;
      }
    }
  }
  console.log(`✔ [PURGE] ${removedCount} arquivo(s) anterior(es) (.mp4/.png) foram totalmente expurgados.`);
  console.log('');
}

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

// 1. Expulgo mandatório de arquivos antigos
purgeExistingMedia();

// 2. Executa as suítes de testes E2E ao vivo e isolamento de worktree
run(
  'node',
  ['--test', '--experimental-test-isolation=none', 'test/e2e-live/ux-ergonomics-adversarial.e2e.mjs', 'test/e2e-live/worktree-adversarial.e2e.mjs', 'test/e2e-live/worktree-isolation.e2e.mjs', 'test/e2e-live/tui-scrollbar-and-history.e2e.mjs', 'test/e2e-live/prompt-violation-confirmation.e2e.mjs', 'test/e2e-live/autonomous-coding-agent.e2e.mjs', 'test/e2e-live/mcp-server-user-journey.e2e.mjs', 'test/e2e-live/mcp-client-third-party.e2e.mjs', 'test/e2e-live/web-auth.e2e.mjs'],
  'Execução das suítes de teste de integração e isolamento E2E'
);

// 3. Gravação mandatória e incondicional de todas as jornadas (fora do CI)
const isCI = Boolean(process.env.CI);

if (!isCI) {
  run(
    'python3',
    ['scripts/run_all_e2e_journeys.py'],
    'Gravação Cinematográfica e Fidedigna das Jornadas E2E Master (Geração 100% Nova)'
  );

  run(
    'node',
    ['scripts/verify-e2e-sync.mjs'],
    'Verificação de Integridade dos Vídeos e Sincronização WSL'
  );
} else {
  console.log('\n[CI] Ambiente de CI detectado: gravação de vídeos e verificação WSL dispensadas.');
}

console.log('\n✔ [SUCESSO] Pipeline E2E completo finalizado com êxito!');
