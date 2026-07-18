/**
 * Schema-based error definitions using Effect Schema TaggedError.
 *
 * Provides validated error types with rich metadata and custom messages.
 *
 * @module schemas/errors
 */

import { Schema } from "effect";

import {
	DependencyUpdateResult,
	FileSystemOperation,
	GitOperation,
	LockfileOperation,
	NonEmptyString,
} from "../schemas/domain.js";

// ══════════════════════════════════════════════════════════════════════════════
// Error Schemas
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Input validation error.
 */
export class InvalidInputError extends Schema.TaggedErrorClass<InvalidInputError>()("InvalidInputError", {
	field: NonEmptyString.annotate({
		description: "The input field that failed validation",
	}),
	value: Schema.Unknown.annotate({
		description: "The invalid value that was provided",
	}),
	reason: NonEmptyString.annotate({
		description: "Human-readable explanation of why validation failed",
	}),
}) {
	get message() {
		return `Invalid input for "${this.field}": ${this.reason}`;
	}
}

/**
 * GitHub API error.
 */
export class GitHubApiError extends Schema.TaggedErrorClass<GitHubApiError>()("GitHubApiError", {
	operation: NonEmptyString.annotate({
		description: "The GitHub API operation that failed",
	}),
	statusCode: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 100, maximum: 599 }))).annotate({
		description: "HTTP status code returned by the API",
	}),
	message: NonEmptyString.annotate({
		description: "Error message from GitHub API",
	}),
}) {
	get isRateLimited(): boolean {
		return this.statusCode === 429;
	}

	get isServerError(): boolean {
		return this.statusCode !== undefined && this.statusCode >= 500;
	}

	get isRetryable(): boolean {
		return this.isRateLimited || this.isServerError;
	}
}

/**
 * Git command execution error.
 */
export class GitError extends Schema.TaggedErrorClass<GitError>()("GitError", {
	operation: GitOperation.annotate({
		description: "The git operation that failed",
	}),
	exitCode: Schema.Number.check(Schema.isInt()).annotate({
		description: "Exit code from the git command",
	}),
	stderr: Schema.String.annotate({
		description: "Standard error output from git",
	}),
}) {
	get message() {
		return `Git ${this.operation} failed (exit ${this.exitCode}): ${this.stderr}`;
	}

	get isRetryable(): boolean {
		return this.operation === "fetch" || this.operation === "push";
	}
}

/**
 * pnpm command execution error.
 */
export class PnpmError extends Schema.TaggedErrorClass<PnpmError>()("PnpmError", {
	command: NonEmptyString.annotate({
		description: "The pnpm command that failed",
	}),
	dependency: Schema.optional(Schema.String).annotate({
		description: "The dependency being operated on",
	}),
	exitCode: Schema.Number.check(Schema.isInt()).annotate({
		description: "Exit code from the pnpm command",
	}),
	stderr: Schema.String.annotate({
		description: "Standard error output from pnpm",
	}),
}) {
	get message() {
		const depInfo = this.dependency ? ` for "${this.dependency}"` : "";
		return `pnpm ${this.command}${depInfo} failed (exit ${this.exitCode}): ${this.stderr}`;
	}

	get isRetryable(): boolean {
		return this.command === "install";
	}
}

/**
 * Changeset creation error.
 */
export class ChangesetError extends Schema.TaggedErrorClass<ChangesetError>()("ChangesetError", {
	reason: NonEmptyString.annotate({
		description: "Why changeset creation failed",
	}),
	packages: Schema.optional(Schema.Array(Schema.String)).annotate({
		description: "Packages that were affected",
	}),
}) {
	get message() {
		const pkgInfo = this.packages?.length ? ` (packages: ${this.packages.join(", ")})` : "";
		return `Changeset error${pkgInfo}: ${this.reason}`;
	}
}

/**
 * File system operation error.
 */
export class FileSystemError extends Schema.TaggedErrorClass<FileSystemError>()("FileSystemError", {
	operation: FileSystemOperation.annotate({
		description: "The file operation that failed",
	}),
	path: NonEmptyString.annotate({
		description: "The file path that was being operated on",
	}),
	reason: NonEmptyString.annotate({
		description: "Why the operation failed",
	}),
}) {
	get message() {
		return `File ${this.operation} failed for "${this.path}": ${this.reason}`;
	}
}

/**
 * Lockfile parsing/comparison error.
 */
export class LockfileError extends Schema.TaggedErrorClass<LockfileError>()("LockfileError", {
	operation: LockfileOperation.annotate({
		description: "The lockfile operation that failed",
	}),
	reason: NonEmptyString.annotate({
		description: "Why the operation failed",
	}),
}) {
	get message() {
		return `Lockfile ${this.operation} failed: ${this.reason}`;
	}
}

/**
 * Failure entry for a single dependency update.
 */
export const DependencyFailure = Schema.Struct({
	dependency: NonEmptyString,
	error: Schema.instanceOf(PnpmError),
});

export type DependencyFailure = typeof DependencyFailure.Type;

/**
 * Aggregate error for collecting multiple dependency update failures.
 * Used when some updates succeed and others fail.
 */
export class DependencyUpdateFailures extends Schema.TaggedErrorClass<DependencyUpdateFailures>()(
	"DependencyUpdateFailures",
	{
		failures: Schema.Array(
			Schema.Struct({
				dependency: NonEmptyString,
				// Use a simpler schema for the nested error to avoid circular issues
				error: Schema.Struct({
					command: Schema.String,
					dependency: Schema.optional(Schema.String),
					exitCode: Schema.Number,
					stderr: Schema.String,
				}),
			}),
		).annotate({
			description: "List of dependencies that failed to update",
		}),
		successful: Schema.Array(DependencyUpdateResult).annotate({
			description: "Dependencies that were successfully updated",
		}),
	},
) {
	get message() {
		const failedDeps = this.failures.map((f) => f.dependency).join(", ");
		return `Failed to update ${this.failures.length} dependencies: ${failedDeps}. ${this.successful.length} succeeded.`;
	}

	get partialSuccess(): boolean {
		return this.successful.length > 0;
	}
}

// ══════════════════════════════════════════════════════════════════════════════
// Union Types
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Union type of all expected errors in the action.
 */
export type ActionError =
	| InvalidInputError
	| GitHubApiError
	| GitError
	| PnpmError
	| ChangesetError
	| FileSystemError
	| LockfileError
	| DependencyUpdateFailures;

// ══════════════════════════════════════════════════════════════════════════════
// Error Utilities
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Check if an error is retryable (transient failure).
 */
export const isRetryableError = (error: ActionError): boolean => {
	switch (error._tag) {
		case "GitHubApiError":
			return error.isRetryable;
		case "GitError":
			return error.isRetryable;
		case "PnpmError":
			return error.isRetryable;
		default:
			return false;
	}
};

/**
 * Get a human-readable error message for any action error.
 */
export const getErrorMessage = (error: ActionError): string => {
	return error.message;
};
