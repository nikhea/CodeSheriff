import { createSkill } from "@mastra/core/skills";

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
