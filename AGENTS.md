# [FILE: AGENTS.md]

### AI Code Review Checklist

This checklist must be used by AI assistants whenever they are asked to review code. Ensure the code is evaluated against the following categories:

#### 1. Functional Quality
- Functional correctness and business logic validation
- Edge cases and boundary conditions
- Exception and null handling
- Input validation

#### 2. Security
- SQL Injection, XSS, and Authentication/Authorization flaws
- Sensitive data exposure and hardcoded secrets
- Insecure API usage and OWASP Top 10 vulnerabilities

#### 3. Performance
- Memory leaks and unnecessary object creation
- Performance bottlenecks and database optimization
- Inefficient loops, redundant API calls, caching opportunities

#### Output Format
Whenever you conduct a review, categorize the findings as:
- **Critical**
- **High**
- **Medium**
- **Low**

For every finding, you MUST provide:
- Issue description
- Impact
- Root cause
- Recommended fix
- Improved code example
