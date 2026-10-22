// OPFS in memory, for the tests: a tree of folders (objects) and files (strings or blobs), behind
// the same `Folder` interface the app reads OPFS through.

import type { Folder } from "../../src/media/opfs.ts";

export interface Tree {
  [name: string]: Tree | Blob | string;
}

function isTree(value: Tree[string] | undefined): value is Tree {
  return typeof value === "object" && !(value instanceof Blob);
}

export function memoryFolder(tree: Tree): Folder {
  return {
    folders: () => Promise.resolve(Object.keys(tree).filter((name) => isTree(tree[name]))),
    folder: (name) => {
      const value = tree[name];
      return Promise.resolve(isTree(value) ? memoryFolder(value) : null);
    },
    file: (name) => {
      const value = tree[name];
      if (typeof value === "string") return Promise.resolve(new Blob([value]));
      return Promise.resolve(value instanceof Blob ? value : null);
    },
    remove: (name) => {
      Reflect.deleteProperty(tree, name);
      return Promise.resolve();
    },
  };
}
