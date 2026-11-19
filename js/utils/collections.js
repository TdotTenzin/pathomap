/*
  collections.js - Shared collection helpers.
*/

export function indexById(items) {
  return new Map((items || []).map((item) => [item.id, item]));
}
