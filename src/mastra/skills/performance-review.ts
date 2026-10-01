import { createSkill } from "@mastra/core/skills";

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
