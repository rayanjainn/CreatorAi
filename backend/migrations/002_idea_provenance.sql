-- Generated idea suggestions keep the provenance of the model that wrote them (NULL for rows
-- written without a model, e.g. by hand).
alter table idea_suggestions add column provenance text check (provenance is null or json_valid(provenance));
