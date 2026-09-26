#!/bin/bash

# Referral Dashboard - Git Commit & Push Script
# This script automates the git operations

set -e  # Exit on error

cd "$(dirname "$0")"

echo "============================================================"
echo "Referral Dashboard - Git Commit & Push"
echo "============================================================"
echo ""

# Verify files exist
echo "[*] Verifying files..."
FILES=(
  "frontend/src/api/referralApi.ts"
  "frontend/src/pages/ReferralPage.tsx"
  "frontend/__tests__/ReferralPage.test.ts"
  "frontend/src/App.tsx"
  "frontend/src/components/WalletDropdown.tsx"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "  ✓ $file"
  else
    echo "  ✗ $file NOT FOUND"
    exit 1
  fi
done
echo "[✓] All files verified"
echo ""

# Check git version
echo "[*] Checking Git installation..."
git --version
echo ""

# Create and checkout feature branch
echo "[*] Creating feature branch..."
if git show-ref --verify --quiet refs/heads/feature/referral-dashboard; then
  echo "  Branch exists, checking out..."
  git checkout feature/referral-dashboard
else
  git checkout -b feature/referral-dashboard
fi
echo "[✓] Branch ready"
echo ""

# Stage files
echo "[*] Staging files..."
for file in "${FILES[@]}"; do
  git add "$file"
  echo "  ✓ Staged: $file"
done
echo "[✓] All files staged"
echo ""

# Check status
echo "[*] Git status:"
git status
echo ""

# Create commit
echo "[*] Creating commit..."
git commit -m "feat: implement player referral dashboard (closes #308)"
echo "[✓] Commit created"
echo ""

# Push to remote
echo "[*] Pushing to remote..."
git push -u origin feature/referral-dashboard
echo "[✓] Pushed successfully"
echo ""

echo "============================================================"
echo "✓ SUCCESS! Code committed and pushed to GitHub"
echo "============================================================"
echo ""
echo "Next steps:"
echo "1. Go to: https://github.com/Kaycee276/Chesster"
echo "2. Click 'Compare & pull request' button"
echo "3. Copy PR description from: REFERRAL_PR_TEMPLATE.md"
echo "4. Paste into PR description field"
echo "5. Click 'Create pull request'"
echo ""
