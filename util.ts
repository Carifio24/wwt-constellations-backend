// Copyright 2023 the .NET Foundation

// Miscellaneous utilities for the WWT Constellations backend server.

import * as t from "io-ts";
import { ObjectId } from "mongodb";

const object_id_regex = /^[0-9A-Fa-f]{24}$/;

export const IoObjectId = new t.Type<ObjectId, string, unknown>(
  // Unique name for this type
  "ObjectId",

  // Custom type guard
  (input: unknown): input is ObjectId => {
    if (typeof input !== "string") {
      return false;
    }

    return object_id_regex.test(input);
  },

  // "validate": parse an input if possible
  (input, context) => {
    if (typeof input === "string") {
      try {
        return t.success(new ObjectId(input));
      } catch { }
    }

    return t.failure(input, context);
  },

  // "encode": encode a value into the output type
  (value) => value.toHexString(),
);

export interface UnitIntervalBrand {
  readonly UnitInterval: unique symbol
}

export const UnitInterval = t.brand(
  t.number,
  (n): n is t.Branded<number, UnitIntervalBrand> => (n >= 0) && (n <= 1),
  'UnitInterval'
)