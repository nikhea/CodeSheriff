import { createSkill } from "@mastra/core/skills";

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
