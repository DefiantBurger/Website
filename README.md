# Personal Website Documentation

This documentation set has been compacted into five canonical documents to reduce overlap and maintenance burden.

## Document Map

- [Architecture](./documentation/ARCHITECTURE.md)
- [Implementation](./documentation/IMPLEMENTATION.md)
- [Utilities](./documentation/UTILITIES.md)
- [Deployment](./documentation/DEPLOYMENT.md)
- [Runbook](./documentation/RUNBOOK.md)

## Scope

These docs describe the current repository state on `main`, including:

- system behavior and architecture,
- local development and implementation details,
- utility-specific behavior and data contracts,
- deployment and VM refresh workflow,
- operations procedures, incidents, and known issues.

## Reading Paths

### New Contributor

1. Read [Architecture](./documentation/ARCHITECTURE.md).
2. Read [Implementation](./documentation/IMPLEMENTATION.md#local-development).
3. Use [Utilities](./documentation/UTILITIES.md) for utility behavior and utility APIs.

### Deployment / Infra Changes

1. Read [Deployment](./documentation/DEPLOYMENT.md).
2. Use [VM Update Playbook](./documentation/DEPLOYMENT.md#vm-update-playbook).
3. Use [Runbook Service Health](./documentation/RUNBOOK.md#verify-service-health).

### Production Maintenance

1. Start with [Runbook](./documentation/RUNBOOK.md).
2. Use [Incident Playbook](./documentation/RUNBOOK.md#incident-playbook).
3. Use [Known Issues and Recommended Fixes](./documentation/RUNBOOK.md#known-issues-and-recommended-fixes).
