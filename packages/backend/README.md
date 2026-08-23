# Backend ownership map

`src/core` owns universal Lambda transport and observability infrastructure. Future business
capabilities belong in cohesive slices under `src/modules`, grouped by the approved bounded
contexts: identity/control, project authentication, File Management, and usage/pricing.

Functions under `src/functions` are thin deployment entry points. Shared public schemas come from
`@utility-services/contracts`; the backend must not import infrastructure composition from `infra`.
