import { Injectable, Logger } from '@nestjs/common';
import { execSync, spawn } from 'child_process';
import { DeveloperAgentService } from './developer-agent.service';

const WORKSPACE = '/workspace';

@Injectable()
export class PrReviewService {
  private readonly logger = new Logger(PrReviewService.name);

  constructor(private readonly developerAgent: DeveloperAgentService) {}

  hasPendingState(remoteJid: string): boolean {
    return (
      this.developerAgent.hasPendingQuestion(remoteJid) ||
      this.developerAgent.hasPendingPr(remoteJid)
    );
  }

  async handleMessage(remoteJid: string, text: string): Promise<string> {
    // Pending question takes priority — resolve it and let dev agent continue
    if (this.developerAgent.hasPendingQuestion(remoteJid)) {
      this.developerAgent.resolveQuestion(remoteJid, text);
      return '';
    }

    const pr = this.developerAgent.getPendingPr(remoteJid);
    if (!pr) return '';

    const normalized = text.toLowerCase().trim();

    if (normalized === 'aprovado' || normalized.startsWith('aprovado')) {
      await this.developerAgent.mergePr(remoteJid);
      // Trigger deploy in background — no external webhook needed
      this.runDeploy(remoteJid).catch((e) =>
        this.logger.error('Deploy error', e instanceof Error ? e.message : String(e)),
      );
      return '';
    }

    if (normalized.startsWith('recusado')) {
      const reason = text.replace(/^recusado:?\s*/i, '').trim();
      await this.developerAgent.sendWhatsApp(
        remoteJid,
        `🔄 Entendido! Vou corrigir com base no seu feedback: "${reason}"`,
      );
      this.developerAgent.rerunWithFeedback(pr, reason).catch(console.error);
      return '';
    }

    return 'Responda *aprovado* para fazer merge ou *recusado: [motivo]* para solicitar correções.';
  }

  private async runDeploy(remoteJid: string): Promise<void> {
    // Wait for GitHub to finish propagating the merge before pulling
    await new Promise((r) => setTimeout(r, 5000));

    // git pull
    try {
      execSync(`git -C ${WORKSPACE} pull origin main`, { timeout: 30_000 });
      this.logger.log('git pull completed');
    } catch (e) {
      this.logger.error('git pull failed', e instanceof Error ? e.message : String(e));
    }

    await this.developerAgent.sendWhatsApp(remoteJid, 'Código atualizado');

    // Build new image synchronously (container still alive here)
    try {
      execSync(`docker compose -f ${WORKSPACE}/docker-compose.yml build agent`, {
        cwd: WORKSPACE,
        timeout: 300_000,
      });
    } catch (e) {
      this.logger.error('docker build failed', e instanceof Error ? e.message : String(e));
    }

    await this.developerAgent.sendWhatsApp(remoteJid, 'Reiniciando agente');

    // Recreate container from already-built image — daemon handles the rest
    const child = spawn(
      'docker',
      ['compose', '-f', `${WORKSPACE}/docker-compose.yml`, 'up', '-d', 'agent'],
      { detached: true, stdio: 'ignore', cwd: WORKSPACE },
    );
    child.unref();
  }
}
