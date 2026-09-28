import type { AssistantChangeEntry } from "@unemployed/contracts";

/**
 * "Undo this change" for assistant edits (ADR 0037).
 *
 * An edit is recorded as the exact values it touched, with their values
 * before and after. Records in id-keyed lists are addressed by id
 * (`#id:<id>`), not by position, so undoing finds the same record after the
 * list grew or was reordered. Undo puts a value back only where the current
 * value is still what the edit produced; everything changed since, by the
 * person or by a later assistant edit, is kept and named.
 */

export type ChangeEntry = AssistantChangeEntry;

const ID_PREFIX = "#id:";
const ORDER_KEY = "#order";

type Json = unknown;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function deepEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function withoutIgnored(
  value: unknown,
  ignoreKeys: ReadonlySet<string>,
): unknown {
  if (ignoreKeys.size === 0) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => withoutIgnored(entry, ignoreKeys));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !ignoreKeys.has(key))
        .map(([key, entry]) => [key, withoutIgnored(entry, ignoreKeys)]),
    );
  }
  return value;
}

function recordId(value: unknown): string | null {
  return isPlainObject(value) && typeof value.id === "string" && value.id
    ? value.id
    : null;
}

function isIdKeyedList(values: readonly unknown[]): boolean {
  if (values.length === 0) return false;
  const ids = values.map(recordId);
  return ids.every((id) => id !== null) && new Set(ids).size === ids.length;
}

export interface DiffOptions {
  /** Keys never compared or undone, at any depth (timestamps, hashes). */
  ignoreKeys?: readonly string[];
  /** Words for a path in the person's terms; null falls back to the key. */
  labelFor?: (
    path: readonly string[],
    value: { before: Json; after: Json },
  ) => string | null;
}

function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function defaultLabel(path: readonly string[]): string {
  const keys = path.filter(
    (segment) => !segment.startsWith(ID_PREFIX) && segment !== ORDER_KEY,
  );
  return humanize(keys.at(-1) ?? path.at(-1) ?? "value");
}

/** Every value that differs between two snapshots of one record. */
export function diffValues(
  before: unknown,
  after: unknown,
  options: DiffOptions = {},
): ChangeEntry[] {
  const ignore = new Set(options.ignoreKeys ?? []);
  const entries: ChangeEntry[] = [];
  const label = (path: string[], value: { before: Json; after: Json }) =>
    options.labelFor?.(path, value) ?? defaultLabel(path);

  const visit = (path: string[], left: unknown, right: unknown): void => {
    if (
      deepEqual(withoutIgnored(left, ignore), withoutIgnored(right, ignore))
    ) {
      return;
    }
    if (isPlainObject(left) && isPlainObject(right)) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of [...keys].sort()) {
        if (ignore.has(key)) continue;
        visit([...path, key], left[key], right[key]);
      }
      return;
    }
    if (
      Array.isArray(left) &&
      Array.isArray(right) &&
      (isIdKeyedList(left) || isIdKeyedList(right)) &&
      (left.length === 0 || isIdKeyedList(left)) &&
      (right.length === 0 || isIdKeyedList(right))
    ) {
      const leftIds = left.map((entry) => recordId(entry)!);
      const rightIds = right.map((entry) => recordId(entry)!);
      const rightIdSet = new Set(rightIds);
      const leftIdSet = new Set(leftIds);
      left.forEach((entry, index) => {
        const id = leftIds[index]!;
        if (!rightIdSet.has(id)) {
          const entryPath = [...path, `${ID_PREFIX}${id}`];
          entries.push({
            path: entryPath,
            kind: "remove",
            before: entry,
            index,
            label: label(entryPath, { before: entry, after: undefined }),
          });
        }
      });
      right.forEach((entry, index) => {
        const id = rightIds[index]!;
        const entryPath = [...path, `${ID_PREFIX}${id}`];
        if (!leftIdSet.has(id)) {
          entries.push({
            path: entryPath,
            kind: "insert",
            after: entry,
            index,
            label: label(entryPath, { before: undefined, after: entry }),
          });
          return;
        }
        visit(entryPath, left[leftIds.indexOf(id)], entry);
      });
      const commonBefore = leftIds.filter((id) => rightIdSet.has(id));
      const commonAfter = rightIds.filter((id) => leftIdSet.has(id));
      if (!deepEqual(commonBefore, commonAfter)) {
        const orderPath = [...path, ORDER_KEY];
        entries.push({
          path: orderPath,
          kind: "set",
          before: commonBefore,
          after: commonAfter,
          index: null,
          label: `${label(path, { before: left, after: right })} order`,
        });
      }
      return;
    }
    entries.push({
      path: path.length > 0 ? path : ["(root)"],
      kind: "set",
      ...(left === undefined ? {} : { before: left }),
      ...(right === undefined ? {} : { after: right }),
      index: null,
      label: label(path, { before: left, after: right }),
    });
  };

  visit([], before, after);
  return entries;
}

type Container = Record<string, unknown> | unknown[];

function childOf(container: unknown, segment: string): unknown {
  if (segment.startsWith(ID_PREFIX) && Array.isArray(container)) {
    const id = segment.slice(ID_PREFIX.length);
    return container.find((entry) => recordId(entry) === id);
  }
  if (isPlainObject(container)) return container[segment];
  return undefined;
}

/** Reads the value at a change path; `found` is false when a record is gone. */
export function readPath(
  root: unknown,
  path: readonly string[],
): { found: boolean; value: unknown } {
  let current: unknown = root;
  for (const segment of path) {
    if (segment === "(root)") return { found: true, value: root };
    if (segment === ORDER_KEY) {
      return {
        found: Array.isArray(current),
        value: Array.isArray(current) ? current.map(recordId) : undefined,
      };
    }
    const next = childOf(current, segment);
    if (next === undefined && segment.startsWith(ID_PREFIX)) {
      return { found: false, value: undefined };
    }
    current = next;
  }
  return { found: true, value: current };
}

function cloneShallow(value: Container): Container {
  return Array.isArray(value) ? [...value] : { ...value };
}

/**
 * Returns a copy of `root` with `update` applied to the container that holds
 * the last segment. Copies only along the path.
 */
function updateAt(
  root: unknown,
  path: readonly string[],
  update: (container: Container, last: string) => void,
): unknown {
  if (path.length === 0) return root;
  const copy = cloneShallow(root as Container);
  let cursor: Container = copy;
  for (const segment of path.slice(0, -1)) {
    let index: number | string = segment;
    if (segment.startsWith(ID_PREFIX) && Array.isArray(cursor)) {
      const id = segment.slice(ID_PREFIX.length);
      index = cursor.findIndex((entry) => recordId(entry) === id);
      if (index < 0) throw new Error(`Missing record ${id}`);
    }
    const child = (cursor as Record<string | number, unknown>)[index];
    if (!Array.isArray(child) && !isPlainObject(child)) {
      throw new Error(`Cannot descend into ${segment}`);
    }
    const childCopy = cloneShallow(child);
    (cursor as Record<string | number, unknown>)[index] = childCopy;
    cursor = childCopy;
  }
  update(cursor, path.at(-1)!);
  return copy;
}

export interface UndoResult<T> {
  next: T;
  undone: ChangeEntry[];
  /** Entries left in place because the value changed again since. */
  conflicts: ChangeEntry[];
}

/**
 * Applies the inverse of `entries` to `current`, only where the current value
 * is still exactly what the change produced.
 */
export function undoChangeEntries<T>(
  current: T,
  entries: readonly ChangeEntry[],
  options: { ignoreKeys?: readonly string[] } = {},
): UndoResult<T> {
  const ignore = new Set(options.ignoreKeys ?? []);
  const same = (left: unknown, right: unknown) =>
    deepEqual(withoutIgnored(left, ignore), withoutIgnored(right, ignore));
  let next: unknown = current;
  const undone: ChangeEntry[] = [];
  const conflicts: ChangeEntry[] = [];

  for (const entry of [...entries].reverse()) {
    const last = entry.path.at(-1)!;
    try {
      if (entry.kind === "set" && last === ORDER_KEY) {
        const listPath = entry.path.slice(0, -1);
        const list = readPath(next, listPath);
        if (!list.found || !Array.isArray(list.value)) {
          conflicts.push(entry);
          continue;
        }
        const listValue = list.value as unknown[];
        const afterOrder = (entry.after as string[]) ?? [];
        const beforeOrder = (entry.before as string[]) ?? [];
        const currentOrder = listValue
          .map(recordId)
          .filter((id): id is string => id !== null && afterOrder.includes(id));
        if (!deepEqual(currentOrder, afterOrder)) {
          conflicts.push(entry);
          continue;
        }
        // Put the records the change reordered back in their old relative
        // order, in the slots they occupy now; other records stay put.
        const slots = listValue
          .map((item, index) => ({ id: recordId(item), index }))
          .filter((slot) => slot.id !== null && beforeOrder.includes(slot.id));
        const byId = new Map(listValue.map((item) => [recordId(item), item]));
        const reordered = [...listValue];
        slots.forEach((slot, position) => {
          reordered[slot.index] = byId.get(beforeOrder[position]!);
        });
        next =
          listPath.length === 0
            ? reordered
            : updateAt(next, listPath, (container, key) => {
                if (key.startsWith(ID_PREFIX) && Array.isArray(container)) {
                  const id = key.slice(ID_PREFIX.length);
                  const index = container.findIndex(
                    (item) => recordId(item) === id,
                  );
                  container[index] = reordered;
                } else {
                  (container as Record<string, unknown>)[key] = reordered;
                }
              });
        undone.push(entry);
        continue;
      }
      if (entry.kind === "set") {
        const at = readPath(next, entry.path);
        if (!at.found || !same(at.value, entry.after)) {
          conflicts.push(entry);
          continue;
        }
        if (entry.path[0] === "(root)") {
          next = entry.before;
          undone.push(entry);
          continue;
        }
        next = updateAt(next, entry.path, (container, key) => {
          if (isPlainObject(container)) {
            if (entry.before === undefined) delete container[key];
            else container[key] = entry.before;
          }
        });
        undone.push(entry);
        continue;
      }
      if (entry.kind === "insert") {
        const at = readPath(next, entry.path);
        if (!at.found) {
          // Already gone: nothing to take out.
          undone.push(entry);
          continue;
        }
        if (!same(at.value, entry.after)) {
          conflicts.push(entry);
          continue;
        }
        const listPath = entry.path.slice(0, -1);
        const id = last.slice(ID_PREFIX.length);
        next = replaceList(next, listPath, (list) =>
          list.filter((item) => recordId(item) !== id),
        );
        undone.push(entry);
        continue;
      }
      // remove: put the record back where it was, unless it is back already.
      const at = readPath(next, entry.path);
      if (at.found) {
        if (same(at.value, entry.before)) undone.push(entry);
        else conflicts.push(entry);
        continue;
      }
      const listPath = entry.path.slice(0, -1);
      const list = readPath(next, listPath);
      if (!list.found || !Array.isArray(list.value)) {
        conflicts.push(entry);
        continue;
      }
      next = replaceList(next, listPath, (items) => {
        const copy = [...items];
        const index = Math.min(entry.index ?? copy.length, copy.length);
        copy.splice(index, 0, entry.before);
        return copy;
      });
      undone.push(entry);
    } catch {
      conflicts.push(entry);
    }
  }
  return { next: next as T, undone, conflicts };
}

function replaceList(
  root: unknown,
  listPath: readonly string[],
  replace: (list: unknown[]) => unknown[],
): unknown {
  if (listPath.length === 0) {
    return replace(Array.isArray(root) ? root : []);
  }
  return updateAt(root, listPath, (container, key) => {
    if (key.startsWith(ID_PREFIX) && Array.isArray(container)) {
      const id = key.slice(ID_PREFIX.length);
      const index = container.findIndex((item) => recordId(item) === id);
      const list = container[index];
      container[index] = replace(Array.isArray(list) ? list : []);
      return;
    }
    const record = container as Record<string, unknown>;
    const list = record[key];
    record[key] = replace(Array.isArray(list) ? list : []);
  });
}

/** Short text for a before/after preview line. */
export function previewValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.slice(0, 600);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const strings = value.filter((entry) => typeof entry === "string");
    if (strings.length === value.length)
      return strings.join(", ").slice(0, 600);
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  if (isPlainObject(value)) {
    const name =
      value.title ??
      value.name ??
      value.companyName ??
      value.label ??
      value.text;
    return typeof name === "string" ? name.slice(0, 600) : "a record";
  }
  return null;
}
