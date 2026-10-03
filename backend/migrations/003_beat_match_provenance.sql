-- Matches are algorithmic: the row records how it was produced ({source, provider, model, ...}:
-- `heuristic` for the hashing embedder, `ai` for a neural embedder, `user` once the user chose it).
alter table beat_matches add column provenance text check (provenance is null or json_valid(provenance));
