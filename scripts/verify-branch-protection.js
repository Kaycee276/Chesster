#!/usr/bin/env node

/**
 * Branch Protection Verification Script
 *
 * Audits GitHub branch protection rules for specified branches.
 * Verifies required PR reviews, status checks, and branch enforcement.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx node scripts/verify-branch-protection.js
 *   GITHUB_TOKEN=ghp_xxx node scripts/verify-branch-protection.js --branch master,main
 *   GITHUB_TOKEN=ghp_xxx node scripts/verify-branch-protection.js --repo user/repo
 *
 * Options:
 *   --branch <branches>  Comma-separated list of branches to check (default: master,dev)
 *   --repo <owner/repo>  Override repository (default: auto-detect from git remote)
 *
 * Environment:
 *   GITHUB_TOKEN  - GitHub personal access token with 'repo' scope
 */

const { Octokit } = require("@octokit/rest");
const { execSync } = require("child_process");

const DEFAULT_BRANCHES = ["master", "dev"];

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { branches: DEFAULT_BRANCHES, owner: null, repo: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--branch" && args[i + 1]) {
      opts.branches = args[i + 1].split(",").map((b) => b.trim());
      i++;
    } else if (args[i] === "--repo" && args[i + 1]) {
      const parts = args[i + 1].split("/");
      opts.owner = parts[0];
      opts.repo = parts.slice(1).join("/");
      i++;
    }
  }

  return opts;
}

function detectRepoInfo() {
  try {
    const remoteUrl = execSync("git remote get-url origin", {
      encoding: "utf8",
    }).trim();
    const match = remoteUrl.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch {
    // ignore
  }
  return null;
}

function formatCheck(name, passed, detail) {
  const icon = passed ? `${COLORS.green}✓` : `${COLORS.red}✗`;
  const suffix = detail ? ` — ${detail}` : "";
  return `  ${icon}${COLORS.reset} ${name}${suffix}`;
}

async function main() {
  const opts = parseArgs();

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error(
      `${COLORS.red}Error: GITHUB_TOKEN environment variable is required.${COLORS.reset}`
    );
    console.error("  export GITHUB_TOKEN=ghp_xxxxxxxxxxxx");
    process.exit(1);
  }

  const detected = detectRepoInfo();
  const owner = opts.owner || process.env.GITHUB_OWNER || (detected && detected.owner);
  const repo = opts.repo || process.env.GITHUB_REPO || (detected && detected.repo);

  if (!owner || !repo) {
    console.error(
      `${COLORS.red}Error: Could not detect repository. Use --repo owner/repo, set GITHUB_OWNER and GITHUB_REPO, or run from a git repository.${COLORS.reset}`
    );
    process.exit(1);
  }

  const octokit = new Octokit({
    auth: token,
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });

  console.log(`\n${COLORS.bold}Branch Protection Report${COLORS.reset}`);
  console.log(`${"=".repeat(50)}`);
  console.log(
    `  Repository: ${COLORS.cyan}${owner}/${repo}${COLORS.reset}`
  );
  console.log(
    `  Branches:  ${opts.branches.map((b) => COLORS.cyan + b + COLORS.reset).join(", ")}`
  );
  console.log("");

  let totalChecked = 0;
  let totalPassed = 0;
  let totalViolations = 0;

  for (const branch of opts.branches) {
    totalChecked++;

    try {
      // Check if branch exists
      await octokit.repos.getBranch({ owner, repo, branch });

      // Fetch protection rules
      let protection;
      try {
        const { data } = await octokit.repos.getBranchProtection({
          owner,
          repo,
          branch,
        });
        protection = data;
      } catch (err) {
        if (err.status === 404) {
          console.log(
            `${COLORS.yellow}⚠ ${branch}${COLORS.reset} — No branch protection rules configured`
          );
          totalViolations++;
          console.log("");
          continue;
        }
        throw err;
      }

      // Evaluate checks
      const checks = [];
      let branchPassed = true;

      // Check: PR reviews required
      const prReviews = protection.required_pull_request_reviews;
      const hasPrReviews = prReviews && prReviews.required_approving_review_count >= 1;
      checks.push(
        formatCheck(
          "PR reviews required",
          hasPrReviews,
          hasPrReviews
            ? `min ${prReviews.required_approving_review_count} approval(s)`
            : "NOT CONFIGURED"
        )
      );
      if (!hasPrReviews) branchPassed = false;

      // Check: Status checks required
      const statusChecks = protection.required_status_checks;
      const hasStatusChecks = statusChecks && statusChecks.checks && statusChecks.checks.length > 0;
      checks.push(
        formatCheck(
          "Status checks required",
          hasStatusChecks,
          hasStatusChecks
            ? `${statusChecks.checks.length} check(s): ${statusChecks.checks.map((c) => c.context).join(", ")}`
            : "NOT CONFIGURED"
        )
      );
      if (!hasStatusChecks) branchPassed = false;

      // Check: Branch must be up to date
      const strictUpdate = hasStatusChecks && statusChecks.strict === true;
      checks.push(
        formatCheck(
          "Branch must be up to date before merging",
          strictUpdate,
          strictUpdate ? "enabled" : "disabled"
        )
      );
      if (!strictUpdate) branchPassed = false;

      // Check: Admin enforcement
      const enforceAdmins = protection.enforce_admins && protection.enforce_admins.enabled;
      checks.push(
        formatCheck(
          "Enforce for admins",
          enforceAdmins,
          enforceAdmins ? "enabled" : "disabled"
        )
      );
      // Admin enforcement is a recommendation, not a failure

      // Output results for this branch
      if (branchPassed) {
        console.log(
          `${COLORS.green}✓ ${branch} — All checks passed${COLORS.reset}`
        );
        totalPassed++;
      } else {
        const violations = checks.filter((c) => c.includes("✗")).length;
        console.log(
          `${COLORS.red}✗ ${branch} — ${violations} violation(s) found${COLORS.reset}`
        );
        totalViolations++;
      }

      checks.forEach((c) => console.log(c));
      console.log("");
    } catch (err) {
      if (err.status === 404) {
        console.log(
          `${COLORS.yellow}⚠ ${branch}${COLORS.reset} — Branch does not exist on remote — skipping`
        );
        console.log("");
        totalChecked--; // Don't count skipped branches
        continue;
      }

      console.error(
        `${COLORS.red}✗ ${branch} — Error: ${err.message}${COLORS.reset}`
      );
      console.log("");
      totalViolations++;
    }
  }

  // Summary
  console.log(`${"=".repeat(50)}`);
  if (totalViolations === 0) {
    console.log(
      `${COLORS.green}${COLORS.bold}Result: ${totalChecked}/${totalChecked} branch(es) compliant ✓${COLORS.reset}`
    );
    process.exit(0);
  } else {
    console.log(
      `${COLORS.red}${COLORS.bold}Result: ${totalPassed}/${totalChecked} branch(es) compliant ✗${COLORS.reset}`
    );
    process.exit(1);
  }
}

main();
