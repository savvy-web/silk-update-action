/**
 * Pure helpers for resolving branch inputs.
 *
 * @module utils/branch
 */

/**
 * Resolve the PR target branch.
 *
 * An empty (or whitespace-only) `target-branch` input is the sentinel for
 * "follow source-branch", because GitHub Actions input defaults cannot
 * reference another input. The fallback is resolved here in code instead.
 */
export const resolveTargetBranch = (rawTarget: string, source: string): string => rawTarget.trim() || source;
