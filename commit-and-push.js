#!/usr/bin/env node

/**
 * Referral Dashboard - Git Commit & Push Script
 * This script automates the git operations to commit and push the referral dashboard
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const WORKSPACE_ROOT = __dirname;
const BRANCH_NAME = 'feature/referral-dashboard';
const COMMIT_MESSAGE = 'feat: implement player referral dashboard (closes #308)';

const FILES_TO_COMMIT = [
  'frontend/src/api/referralApi.ts',
  'frontend/src/pages/ReferralPage.tsx',
  'frontend/__tests__/ReferralPage.test.ts',
  'frontend/src/App.tsx',
  'frontend/src/components/WalletDropdown.tsx',
];

console.log('============================================================');
console.log('Referral Dashboard - Git Commit & Push');
console.log('============================================================\n');

function executeCommand(command, description) {
  try {
    console.log(`[*] ${description}...`);
    const output = execSync(command, {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log(`[✓] ${description} - SUCCESS\n`);
    return output;
  } catch (error) {
    console.error(`[✗] ${description} - FAILED`);
    console.error(`Error: ${error.message}\n`);
    throw error;
  }
}

function verifyFiles() {
  console.log('[*] Verifying all files exist...');
  let allExist = true;
  
  FILES_TO_COMMIT.forEach((file) => {
    const filePath = path.join(WORKSPACE_ROOT, file);
    if (fs.existsSync(filePath)) {
      console.log(`  ✓ ${file}`);
    } else {
      console.log(`  ✗ ${file} NOT FOUND`);
      allExist = false;
    }
  });
  
  if (!allExist) {
    throw new Error('Some files are missing!');
  }
  console.log('[✓] All files verified\n');
}

async function main() {
  try {
    // Step 1: Verify files
    verifyFiles();

    // Step 2: Check git version
    executeCommand('git --version', 'Checking Git installation');

    // Step 3: Check current branch
    const currentBranch = executeCommand('git rev-parse --abbrev-ref HEAD', 'Checking current branch').trim();
    console.log(`Current branch: ${currentBranch}\n`);

    // Step 4: Create and checkout feature branch
    try {
      executeCommand(`git checkout -b ${BRANCH_NAME}`, `Creating branch '${BRANCH_NAME}'`);
    } catch {
      console.log(`[*] Branch might exist, attempting to checkout...`);
      executeCommand(`git checkout ${BRANCH_NAME}`, `Switching to branch '${BRANCH_NAME}'`);
    }

    // Step 5: Stage files
    console.log('[*] Staging files...');
    FILES_TO_COMMIT.forEach((file) => {
      execSync(`git add "${file}"`, {
        cwd: WORKSPACE_ROOT,
        stdio: 'ignore',
      });
      console.log(`  ✓ Staged: ${file}`);
    });
    console.log('[✓] All files staged\n');

    // Step 6: Check git status
    executeCommand('git status', 'Verifying staged files');

    // Step 7: Create commit
    executeCommand(`git commit -m "${COMMIT_MESSAGE}"`, 'Creating commit');

    // Step 8: Push to remote
    executeCommand(`git push -u origin ${BRANCH_NAME}`, 'Pushing to remote');

    // Success message
    console.log('\n============================================================');
    console.log('✓ SUCCESS! Code committed and pushed to GitHub');
    console.log('============================================================\n');
    console.log('Next steps:');
    console.log('1. Go to: https://github.com/Kaycee276/Chesster');
    console.log('2. Click "Compare & pull request" button');
    console.log('3. Copy PR description from: REFERRAL_PR_TEMPLATE.md');
    console.log('4. Paste into PR description field');
    console.log('5. Click "Create pull request"\n');

    process.exit(0);
  } catch (error) {
    console.error('\n============================================================');
    console.error('✗ FAILED - Error occurred during git operations');
    console.error('============================================================\n');
    console.error(error.message);
    console.error('\nPlease check:');
    console.error('1. Git is installed and accessible');
    console.error('2. You have GitHub credentials configured');
    console.error('3. You have push access to the repository\n');
    process.exit(1);
  }
}

main();
