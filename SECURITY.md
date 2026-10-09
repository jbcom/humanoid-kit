# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through
[GitHub Security Advisories](https://github.com/jbcom/humanoid-kit/security/advisories/new),
which lets us discuss and fix the issue before it is disclosed.

You can expect an acknowledgement within a few days. If a fix is warranted, we
will prepare it privately, publish a patched release, and credit you in the
advisory unless you would rather remain anonymous.

## Supported versions

The package is pre-release. The latest `0.x` release receives security fixes.
Older pre-1.0 releases are not patched unless a coordinated disclosure requires
an exceptional backport.

## In scope

Examples include malformed or malicious binary asset or recipe input that causes
out-of-bounds reads, unbounded memory use or code execution in the loaders,
unsafe handling of data passed to the subdivision worker, package supply-chain
issues, and unexpected code execution during install or build. Application
authorization, moderation of user-created figures, and content policy for
applications built on top of humanoid-kit are outside this repository's security
boundary.
