import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';

export interface FileChange {
  path: string;
  content: string;
}

export interface PrResult {
  number: number;
  url: string;
}

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;

  constructor(private readonly config: ConfigService) {
    this.octokit = new Octokit({ auth: config.get('GITHUB_TOKEN') });
    this.owner = config.get('GITHUB_OWNER') ?? 'Heinrick-Senna';
    this.repo = config.get('GITHUB_REPO') ?? 'interaction-agent';
  }

  async createBranchAndPR(
    branchName: string,
    files: FileChange[],
    prTitle: string,
    prBody: string,
  ): Promise<PrResult> {
    // Get SHA of main branch
    const { data: ref } = await this.octokit.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: 'heads/main',
    });
    const baseSha = ref.object.sha;

    // Get base tree SHA from the commit
    const { data: baseCommit } = await this.octokit.git.getCommit({
      owner: this.owner,
      repo: this.repo,
      commit_sha: baseSha,
    });
    const baseTreeSha = baseCommit.tree.sha;

    // Create blobs for each file
    const treeItems = await Promise.all(
      files.map(async (f) => {
        const { data: blob } = await this.octokit.git.createBlob({
          owner: this.owner,
          repo: this.repo,
          content: Buffer.from(f.content).toString('base64'),
          encoding: 'base64',
        });
        return {
          path: f.path,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: blob.sha,
        };
      }),
    );

    // Create tree
    const { data: tree } = await this.octokit.git.createTree({
      owner: this.owner,
      repo: this.repo,
      base_tree: baseTreeSha,
      tree: treeItems,
    });

    // Create commit
    const { data: commit } = await this.octokit.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message: prTitle,
      tree: tree.sha,
      parents: [baseSha],
    });

    // Create branch ref
    await this.octokit.git.createRef({
      owner: this.owner,
      repo: this.repo,
      ref: `refs/heads/${branchName}`,
      sha: commit.sha,
    });

    // Create PR
    const { data: pr } = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title: prTitle,
      body: prBody,
      head: branchName,
      base: 'main',
    });

    this.logger.log(`PR created: ${pr.html_url}`);
    return { number: pr.number, url: pr.html_url };
  }

  async mergePR(prNumber: number): Promise<void> {
    await this.octokit.pulls.merge({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      merge_method: 'squash',
    });
    this.logger.log(`PR #${prNumber} merged`);
  }
}
