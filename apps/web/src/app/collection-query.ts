import { organizationSearch } from "@pr0/api-contract/organization";

export const collectionMatches = (name: string, query: string) => {
  const normalized = organizationSearch(name);
  return (
    organizationSearch(query)
      .split(" ")
      // oxlint-disable-next-line react-doctor/js-set-map-lookups -- This is substring matching on a string, not array membership.
      .every((term) => normalized.includes(term))
  );
};
