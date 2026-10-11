/** English templates of the Bases index warnings; the presentation renders them in the response language. */
export const indexMessages = {
  ambiguousLink: 'The link {link} in the note {source} matches {candidates}; it resolves to the closest, {resolved}.',
  unparseableNote: '{path} cannot be parsed and is indexed without properties, links or tags: {problem}',
} as const satisfies Record<string, string>;

export type IndexMessage = keyof typeof indexMessages;
