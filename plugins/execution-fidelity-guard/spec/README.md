# Protocol authority and retention

These versioned schemas ship with the plugin and define its public interchange contracts.

These schemas prevent the plugin from becoming a second source of intent truth.

- task-contract-lite.schema.json defines the seven-field fallback used only without a user-intent provider.
- contract-envelope.schema.json defines provider identity and Guard's internal
  fallback envelope. A standalone fallback envelope is not accepted as input;
  callers provide the bare seven-field TaskContractLite so Guard derives its
  content-addressed identity.
- provider-contract.schema.json pairs the provider envelope with the bounded projection and requires its canonical SHA-256.
- continuity-snapshot.schema.json limits context continuity to recovery metadata.
- evidence-reference.schema.json describes verifiable evidence without copying raw secrets or full transcripts.
- normalized-event.schema.json describes the minimal observable event retained by the guard.
- decision-receipt.schema.json records why an intervention happened and what evidence supported it.

All persisted records are local-first. Full transcripts, hidden reasoning, credentials, and secret-bearing tool payloads are prohibited.

Evidence records identify their authority as `hook_observed`,
`artifact_observed`, or `caller_attested`. Artifact observation
means Guard read and hashed the named file bytes; it does not verify the
caller-supplied status or semantic sufficiency. A caller-attested digest is a
claim, not independent artifact verification.

Input provider, fallback-contract, Continuity, and decision-receipt schemas use
wire version `1.0`. Normalized event and evidence-record outputs use `2.0` in
runtime 0.2.0 because subagent event values, pseudonymous Host identifiers, and
artifact attestation are incompatible with strict 1.0 consumers. Consumers
must select a schema by each record's `schema_version`, not the npm package
version.

The Continuity schema is an interchange boundary only in 0.2.x; the runtime
does not load it. See the repository integration contract for state ownership
and unverified capabilities.
