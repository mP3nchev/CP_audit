# Privacy Policy Auditor Prompt

## Required File

**File:** `privacy-policy-auditor-full.txt`

**Source:** AI INSTRUCTION SET — PRIVACY POLICY AUDITOR.md (from GitHub)

**Content:** The complete 47-page privacy policy auditor prompt with all 37 GDPR criteria.

## How to Add the Prompt

1. Locate "AI INSTRUCTION SET — PRIVACY POLICY AUDITOR.md" in your GitHub repository
2. Copy the full content
3. Save it as `privacy-policy-auditor-full.txt` in this directory
4. The system will automatically load and cache this prompt

## Prompt Structure Expected

The prompt should include:
- Complete instructions for privacy policy analysis
- All 37 GDPR criteria with scoring guidelines
- Tier-based weighting system (Tier 1-4)
- Output format specification (JSON)
- Examples and edge cases

## Verification

To verify the prompt is loaded correctly:
```bash
ls -lh privacy-policy-auditor-full.txt
# Should show file size around 150-200KB for 47 pages
```

## Prompt Caching

The system uses Claude's prompt caching feature:
- First request: ~$0.09 (full prompt processed)
- Subsequent requests: <$0.01 (90% cached)
- Cache TTL: 5 minutes

This saves significant costs when analyzing multiple policies.
