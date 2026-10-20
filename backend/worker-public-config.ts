// SHA-256 verifier only. The random bearer token lives in Supabase Vault, never in source.
// Rotate the Vault token and this verifier together when rotating scheduler authentication.
export const workerTokenHash='732c00edcc1841eb271a1e704c288463191564abb090a925160d664f06189e93';
