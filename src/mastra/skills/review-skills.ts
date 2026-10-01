import { createSkill } from "@mastra/core/skills";

/**
 * Review skills as INLINE skills (no filesystem dependency).
 *
 * Filesystem skill paths resolve against the runtime working directory,
 * which differs between `bun src/...` and the `mastra dev` bundle
 * (.mastra/output) — skills silently failed to load in Studio.
 * Inline skills travel inside the bundle, so they load in every runtime.
 *
 * Content mirrors the on-disk SKILL.md files plus references (kept under
 * src/mastra/skills as the editable source of truth; sync here when they change).
 */

export const codeStandardsSkill = createSkill({
  name: "code-standards",
  description: "Code quality standards and style guide for reviewing pull requests",
  instructions: `# Code Standards Review

When reviewing code, follow this structured process:

## Step 1: Critical Issues

Check for issues that MUST be fixed before merging:

- Logic bugs and incorrect behavior
- Missing error handling for failure cases
- Race conditions or concurrency issues
- Unhandled edge cases (null, undefined, empty arrays, boundary values)
- Breaking API changes without migration path

## Step 2: Code Quality

Evaluate overall code quality:

- Functions should do one thing and be reasonably sized (< 50 lines preferred)
- Avoid code duplication — look for repeated patterns that should be abstracted
- Use descriptive, meaningful names for variables, functions, and types
- Prefer explicit types over \`any\` in TypeScript
- Ensure proper use of async/await (no floating promises, proper error propagation)

## Step 3: Style Guide Conformance

Check against the style guide in \`references/style-guide.md\`:

- Naming conventions
- Code organization and import ordering
- Comment quality (explain "why", not "what")

## Step 4: Linting Flags

Flag these patterns:

- \`var\` usage (should be \`const\` or \`let\`)
- Leftover \`console.log\` or \`debugger\` statements
- Commented-out code blocks
- Magic numbers without named constants
- \`TODO\` or \`FIXME\` comments without issue references

## Output Format

Structure your feedback as:

1. **Summary**: 1-2 sentence overview of the changes and overall quality
2. **Critical Issues**: Must-fix problems with file path and line numbers
3. **Suggestions**: Improvements that would make the code better
4. **Positive Notes**: Good patterns and decisions worth acknowledging`,
  references: {
    "style-guide.md": `# Style Guide

## Naming Conventions

| Element               | Convention           | Example                                   |
| --------------------- | -------------------- | ----------------------------------------- |
| Variables & Functions | camelCase            | \`getUserName\`, \`isActive\`                 |
| Constants             | UPPER_SNAKE_CASE     | \`MAX_RETRIES\`, \`API_BASE_URL\`             |
| Classes & Types       | PascalCase           | \`UserService\`, \`PullRequestData\`          |
| Files                 | kebab-case           | \`user-service.ts\`, \`pr-review.ts\`         |
| Booleans              | is/has/should prefix | \`isValid\`, \`hasPermission\`, \`shouldRetry\` |
| Event handlers        | handle/on prefix     | \`handleClick\`, \`onSubmit\`                 |

## Code Organization

Order sections within a file:

1. Imports (external → internal → relative)
2. Constants and configuration
3. Type definitions
4. Helper/utility functions
5. Main functions or class definition
6. Exports

## Error Handling

- Use explicit error handling — don't silently swallow errors
- Prefer specific error types over generic \`Error\`
- Always handle promise rejections
- Log errors with enough context for debugging

## Comments

- Write "why" comments, not "what" comments
- Use JSDoc for public API functions
- Remove commented-out code — use version control instead`,
  },
});

export const securityReviewSkill = createSkill({
  name: "security-review",
  description: "Security-focused code review checklist for identifying vulnerabilities",
  instructions: `# Security Review

When reviewing code for security issues, check each category below. Reference the detailed checklist in \`references/security-checklist.md\`.

## Injection Vulnerabilities

- SQL injection: Look for string concatenation in database queries
- Command injection: Check for unsanitized input passed to shell commands (\`exec\`, \`spawn\`)
- XSS: Look for unsanitized user input rendered in HTML/templates
- Path traversal: Check for user input in file paths without sanitization

## Authentication & Authorization

- Verify authentication checks on protected routes/endpoints
- Ensure authorization checks match the required access level
- Look for privilege escalation paths (e.g., user can modify other users' data)
- Check that password/token comparison uses constant-time comparison

## Secrets & Credentials

- Hardcoded API keys, passwords, tokens, or connection strings
- Secrets in configuration files that might be committed
- Sensitive data in logs or error messages
- Credentials passed via URL query parameters

## Input Validation

- Validate and sanitize all external input (user input, API responses, file contents)
- Check for missing or weak input validation on API endpoints
- Verify type coercion doesn't bypass validation
- Look for overly permissive CORS or CSP configurations

## Data Exposure

- Sensitive data returned in API responses unnecessarily
- PII or secrets in application logs
- Information leakage in error messages (stack traces, internal paths)
- Missing data encryption for sensitive fields

## Severity Levels

- 🔴 **CRITICAL**: Exploitable vulnerability (injection, auth bypass, exposed secrets)
- 🟠 **HIGH**: Potential vulnerability that needs investigation
- 🟡 **MEDIUM**: Security weakness or missing best practice
- 🔵 **LOW**: Minor security improvement suggestion`,
  references: {
    "security-checklist.md": `# Security Checklist

## Quick Reference

### Input Handling

- [ ] All user input is validated before use
- [ ] SQL queries use parameterized statements
- [ ] File paths are validated and sandboxed
- [ ] HTML output is escaped/sanitized
- [ ] Shell commands don't include user input directly

### Authentication

- [ ] All sensitive endpoints require authentication
- [ ] Tokens have appropriate expiry times
- [ ] Failed auth attempts are rate-limited
- [ ] Session tokens are invalidated on logout
- [ ] Password hashing uses bcrypt/scrypt/argon2

### Data Protection

- [ ] No secrets in source code
- [ ] Sensitive data is encrypted at rest
- [ ] PII is not logged
- [ ] API responses don't over-expose data
- [ ] Error messages don't leak internal details

### Dependencies

- [ ] No known vulnerable dependencies
- [ ] Dependencies are pinned to specific versions
- [ ] Minimal dependency surface area

### HTTP Security

- [ ] CORS is configured restrictively
- [ ] Security headers are set (CSP, HSTS, X-Frame-Options)
- [ ] Cookies have Secure, HttpOnly, SameSite flags
- [ ] Rate limiting on public endpoints`,
  },
});

export const performanceReviewSkill = createSkill({
  name: "performance-review",
  description: "Performance-focused code review for identifying bottlenecks and optimization opportunities",
  instructions: `# Performance Review

When reviewing code for performance issues, check each category below. Reference the detailed checklist in \`references/performance-checklist.md\`.

## Database & Queries

- N+1 query patterns (queries inside loops)
- Missing database indexes for frequently queried fields
- Unbounded queries without LIMIT/pagination
- SELECT * instead of selecting only needed columns
- Missing connection pooling

## Memory & Resources

- Memory leaks: event listeners not removed, intervals not cleared, growing caches without bounds
- Large objects held in memory unnecessarily
- Unbounded arrays or maps that grow with usage
- Missing cleanup in component unmount/destroy lifecycle

## Rendering (Frontend)

- Unnecessary re-renders (missing React.memo, useMemo, useCallback where appropriate)
- Large component trees re-rendering for small state changes
- Missing virtualization for long lists
- Synchronous heavy computation blocking the main thread
- Large bundle sizes from unnecessary imports

## API & Network

- Missing caching for frequently accessed, rarely changing data
- Sequential API calls that could be parallelized
- Missing pagination for large data sets
- Over-fetching data (requesting more than needed)
- Missing request deduplication

## Algorithmic Complexity

- O(n²) or worse operations on potentially large datasets
- Repeated computation that could be memoized
- String concatenation in loops (use array join or template literals)
- Unnecessary sorting or filtering passes

## Severity Levels

- 🔴 **CRITICAL**: Will cause performance degradation under normal load
- 🟠 **HIGH**: Will cause issues at scale
- 🟡 **MEDIUM**: Optimization opportunity with measurable impact
- 🔵 **LOW**: Minor optimization suggestion`,
  references: {
    "performance-checklist.md": `# Performance Checklist

## Quick Reference

### Database

- [ ] No queries inside loops (N+1)
- [ ] Indexes exist for WHERE/JOIN/ORDER BY columns
- [ ] Queries have LIMIT clauses where appropriate
- [ ] Connection pooling is configured
- [ ] Expensive queries are cached

### Memory

- [ ] Event listeners are cleaned up
- [ ] Timers/intervals are cleared
- [ ] Caches have size limits or TTL
- [ ] Large data sets are paginated, not loaded entirely
- [ ] Streams used for large file processing

### Frontend

- [ ] Components memoized where appropriate
- [ ] Lists are virtualized if > 100 items
- [ ] Images are lazy-loaded and properly sized
- [ ] Code splitting for routes/features
- [ ] Heavy computation offloaded to web workers

### Network

- [ ] API responses are cached appropriately
- [ ] Parallel requests where dependencies allow
- [ ] Pagination for list endpoints
- [ ] Compression enabled (gzip/brotli)
- [ ] CDN for static assets

### General

- [ ] No synchronous I/O in request handlers
- [ ] Logging doesn't impact performance in production
- [ ] Batch operations where possible
- [ ] Debounce/throttle rapid-fire events`,
  },
});
