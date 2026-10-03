import type { Hex } from "./types";

/**
 * A minimal ABI codec for the ERC-8211 struct shape.
 *
 * @dev Why not viem. `encodeAbiParameters` dispatches a nested tuple to its `bytes` encoder, and its
 *      `size()` helper returns `value.length` for anything that is not a hex string. For a
 *      `ComposableExecution` it therefore measures the three-element tuple array, reports a 3-byte
 *      width, and throws `AbiEncodingBytesSizeMismatchError`. This is independent of the declared
 *      width -- `bytes32` fails identically -- so it is a real limitation for this shape rather than
 *      a mistake in the ABI declaration. The shape cannot be avoided: every `InputParam` carries
 *      `bytes` plus `Constraint[]`, and `ComposableExecution` carries two arrays of those.
 *
 *      The codec is written out instead, and checked against an implementation that knows nothing
 *      about this file: `abiParity.test.ts` compares every encoding against `cast abi-encode`.
 *
 *      Only the subset the wire format uses is implemented: uint, fixed-width bytes, dynamic bytes,
 *      tuples, and arrays of tuples.
 */

export type SolValue =
  | { readonly t: "uint"; readonly v: bigint }
  | { readonly t: "address"; readonly v: Hex }
  | { readonly t: "bytesN"; readonly v: Hex; readonly n: number }
  | { readonly t: "bytes"; readonly v: Hex }
  | { readonly t: "tuple"; readonly fields: readonly SolValue[] }
  | { readonly t: "tupleArray"; readonly items: readonly (readonly SolValue[])[] };

export const WORD = 32;

const isDynamic = (v: SolValue): boolean => {
  switch (v.t) {
    case "bytes":
    case "tupleArray":
      return true;
    case "tuple":
      return v.fields.some(isDynamic);
    default:
      return false;
  }
};

const byteLength = (hex: Hex): number => (hex.length - 2) / 2;

const concat = (parts: readonly Hex[]): Hex =>
  `0x${parts.map((p) => p.slice(2)).join("")}` as Hex;

/** 32-byte big-endian word. Negative input is refused rather than silently truncated. */
export function word(n: bigint): Hex {
  if (n < 0n) throw new RangeError(`cannot encode ${n} as a uint256 word; use toTwosComplement`);
  if (n >= 1n << 256n) throw new RangeError(`${n} does not fit in 256 bits`);
  return `0x${n.toString(16).padStart(64, "0")}` as Hex;
}

/** Reinterpret a signed integer as the 256-bit word the chain compares against. */
export function toTwosComplement(n: bigint): bigint {
  return n < 0n ? (1n << 256n) + n : n;
}

/** Right-pad to a whole number of words, as dynamic `bytes` requires. */
function padRight(hex: Hex): Hex {
  const padded = Math.ceil(byteLength(hex) / WORD) * WORD;
  return `0x${hex.slice(2).padEnd(padded * 2, "0")}` as Hex;
}

/** The `head`/`tail` split that every dynamic type follows. */
function split(v: SolValue): { head: Hex; tail: Hex } {
  switch (v.t) {
    case "uint":
      return { head: word(v.v), tail: "0x" };

    case "address": {
      if (byteLength(v.v) !== 20) {
        throw new RangeError(`expected a 20-byte address, got ${byteLength(v.v)}: ${v.v}`);
      }
      // An address occupies the *low-order* 20 bytes of the word, so the 12 leading bytes are zero.
      // Note the opposite of `bytesN`, whose data occupies the leading bytes and is padded on the
      // right. Both are called left-aligned; the padding side differs, and getting it backwards
      // produces a word that is still 32-byte aligned and still decodes, just to the wrong address.
      return { head: `0x${v.v.slice(2).padStart(64, "0")}` as Hex, tail: "0x" };
    }

    case "bytesN": {
      const len = byteLength(v.v);
      if (len !== v.n) {
        throw new RangeError(`expected bytes${v.n}, got ${len} bytes: ${v.v}`);
      }
      // Fixed-width bytes are left-aligned in their word, so the value is followed by padding to the
      // declared width. Padding on the left would move the significant bytes to the end of the word.
      return { head: `0x${v.v.slice(2).padEnd(v.n * 2, "0")}` as Hex, tail: "0x" };
    }

    case "bytes":
      return { head: word(BigInt(byteLength(v.v))), tail: padRight(v.v) };

    case "tuple": {
      const tails: Hex[] = [];
      let tailOffset = v.fields.length * WORD;

      const heads = v.fields.map((field) => {
        if (!isDynamic(field)) return encode(field);
        const offset = word(BigInt(tailOffset));
        const encoded = encode(field);
        tails.push(encoded);
        tailOffset += byteLength(encoded);
        return offset;
      });

      return { head: concat(heads), tail: concat(tails) };
    }

    case "tupleArray": {
      // An empty array has no element to inspect, and there is nothing to place an offset for.
      if (v.items.length === 0) {
        return { head: word(0n), tail: "0x" };
      }

      const element = tupleOf(v.items[0]!);
      const encoded = v.items.map((fields) => encode({ t: "tuple", fields }));

      // A static element is encoded inline, right after the length. A *dynamic* element gets its own
      // offset word instead, and all the offsets precede all the elements.
      //
      //      [len][off_0]...[off_n][elem_0]...[elem_n]
      //
      //      This is the part that is easy to get wrong, because the inline form looks plausible and
      //      every field in it is individually correct. A batch encoded the inline way is accepted by
      //      the builder, fails to decode on-chain, and shifts every subsequent offset.
      if (!isDynamic(element)) {
        return { head: concat([word(BigInt(encoded.length)), ...encoded]), tail: "0x" };
      }

      // Offsets are measured from the length word, and the first element sits immediately after the
      // offset table. So the base is exactly the table's size -- with no extra word for the length.
      let cursor = encoded.length * WORD;
      const offs = encoded.map((e) => {
        const o = word(BigInt(cursor));
        cursor += byteLength(e);
        return o;
      });

      return { head: concat([word(BigInt(encoded.length)), ...offs, ...encoded]), tail: "0x" };
    }
  }
}

/** Build a `tuple` value from its fields. Saves every call site from restating the discriminant. */
export const tupleOf = (fields: readonly SolValue[]): SolValue => ({ t: "tuple", fields });

export function encode(v: SolValue): Hex {
  const { head, tail } = split(v);
  return concat([head, tail]);
}

// ---------------------------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------------------------

export class Reader {
  readonly data: Hex;
  cursor: number;

  constructor(data: Hex) {
    this.data = data;
    this.cursor = 0;
  }

  private require(n: number): void {
    const left = byteLength(this.data) - this.cursor;
    if (n > left) {
      throw new RangeError(`ABI data exhausted: wanted ${n} bytes at offset ${this.cursor}, have ${left}`);
    }
  }

  word(): Hex {
    this.require(WORD);
    const out = `0x${this.data.slice(2 + this.cursor * 2, 2 + (this.cursor + WORD) * 2)}` as Hex;
    this.cursor += WORD;
    return out;
  }

  uint(): bigint {
    return BigInt(this.word());
  }

  /** Read `len` bytes, then step over the right-padding to the next word boundary. */
  bytes(): Hex {
    const len = Number(this.uint());
    const words = Math.ceil(len / WORD);
    this.require(words * WORD);
    const out = `0x${this.data.slice(2 + this.cursor * 2, 2 + (this.cursor + len) * 2)}` as Hex;
    this.cursor += words * WORD;
    return out;
  }
}

/**
 * Decode one value at the reader's cursor.
 *
 * `base` is the byte offset that this value's dynamic pointers are relative to, which for a tuple is
 * the offset its own encoding starts at. Offsets inside a tuple are relative to that tuple, not to
 * the enclosing buffer, and getting that wrong is the classic ABI bug.
 */
export function decodeAt(r: Reader, v: SolValue, base: number): SolValue {
  switch (v.t) {
    case "uint":
      return { t: "uint", v: r.uint() };

    case "address": {
      const w = r.word();
      return { t: "address", v: `0x${w.slice(2, 42)}` as Hex };
    }

    case "bytesN": {
      const w = r.word();
      return { t: "bytesN", v: `0x${w.slice(2, 2 + v.n * 2)}` as Hex, n: v.n };
    }

    case "bytes":
      return { t: "bytes", v: r.bytes() };

    case "tuple": {
      // Pass one walks the head. A dynamic field contributes an offset word; a static one is decoded
      // in place.
      const offsets: (number | null)[] = [];
      const statics: (SolValue | null)[] = [];

      for (const field of v.fields) {
        if (isDynamic(field)) {
          offsets.push(base + Number(r.uint()));
          statics.push(null);
        } else {
          offsets.push(null);
          statics.push(decodeAt(r, field, base));
        }
      }

      // Pass two visits each tail at its own offset.
      const afterHead = r.cursor;
      let end = afterHead;
      const fields: SolValue[] = [];

      v.fields.forEach((field, i) => {
        if (isDynamic(field)) {
          r.cursor = offsets[i]!;
          fields.push(decodeAt(r, field, base));
          // Tails are laid out in declaration order directly after the head, so the furthest one
          // reached is the end of the tuple's encoding.
          if (r.cursor > end) end = r.cursor;
        } else {
          fields.push(statics[i]!);
        }
      });

      // Leave the cursor at the end of the whole encoding, not at the end of the head. Array
      // elements are contiguous head-then-tails, so rewinding to `afterHead` would make the second
      // element start inside the first element's tails.
      r.cursor = end;

      return { t: "tuple", fields };
    }

    case "tupleArray":
      // The cursor is already positioned at the array, because the enclosing tuple resolved the
      // offset word for this field before calling in. Re-applying `base` here would add it twice and
      // land somewhere past the end of the buffer.
      return decodeArrayAt(r, v);
  }
}

/**
 * Read a `tupleArray` whose length word is at the reader's cursor.
 *
 * Dynamic elements each sit behind an offset word, and the offsets are measured from the word after
 * the length. Each element's own internal offsets are relative to that element's start.
 */
function decodeArrayAt(r: Reader, v: SolValue & { t: "tupleArray" }): SolValue {
  const n = Number(r.uint());

  // Element offsets are measured from the word *after* the length, not from the length itself. With
  // two elements the first offset is 0x40: 64 bytes for the two-entry offset table, from a base that
  // already sits past the length word. Measuring from the length would put element 0 one word early,
  // on top of the second offset.
  const offsetBase = r.cursor;

  const items: SolValue[][] = [];
  if (n === 0 || v.items.length === 0) return { t: "tupleArray", items };

  const element: SolValue = { t: "tuple", fields: v.items[0]! };

  if (!isDynamic(element)) {
    // Static elements sit inline, one after another.
    for (let i = 0; i < n; i++) {
      items.push((decodeAt(r, element, r.cursor) as unknown as { fields: SolValue[] }).fields);
    }
    return { t: "tupleArray", items };
  }

  // Dynamic elements each have an offset word, and all of those come before any element data.
  const offsets: number[] = [];
  for (let i = 0; i < n; i++) {
    offsets.push(offsetBase + Number(r.uint()));
  }

  for (const offset of offsets) {
    r.cursor = offset;
    items.push((decodeAt(r, element, offset) as unknown as { fields: SolValue[] }).fields);
  }

  // The cursor is left just past the last element, so an enclosing tuple resumes in the right place.
  return { t: "tupleArray", items };
}

/**
 * Decode `data` as a bare top-level value, with no leading offset word.
 *
 * This is the content of a single function argument, after the module's dispatcher has consumed the
 * offset that points at it. A top-level dynamic value therefore starts with its own payload, not
 * with a pointer to it.
 */
export function decodeBare(data: Hex, v: SolValue): SolValue {
  return decodeAt(new Reader(data), v, 0);
}