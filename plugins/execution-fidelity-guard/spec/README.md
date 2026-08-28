# Protocol authority and retention

These versioned schemas ship with the plugin and define its public interchange contracts.

These schemas prevent the plugin from becoming a second source of intent truth.

- task-contract-lite.schema.json defines the seven-field fallback used only without a user-intent provider.
- contract-envelope.schema.json stores either a versioned external contract reference or the fallback contract.
- provider-contract.schema.json pairs the provider envelope with the bounded projection and requires its canonical SHA-256.
- continuity-snapshot.schema.json limits context continuity to recovery metadata.
- evidence-reference.schema.json describes verifiable evidence without copying raw secrets or full transcripts.
- normalized-event.schema.json describes the minimal observable event retained by the guard.
- decision-receipt.schema.json records why an intervention happened and what evidence supported it.

All persisted records are local-first. Full transcripts, hidden reasoning, credentials, and secret-bearing tool payloads are prohibited.

Evidence records identify their authority as `hook_observed` or
`caller_attested`. A caller-attested digest is a claim, not independent
artifact verification.

The Continuity schema is an interchange boundary only in 0.1.0; the runtime
does not load it. See the repository integration contract for state ownership
and unverified capabilities.
