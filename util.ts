// Copyright 2023 the .NET Foundation

// Miscellaneous utilities for the WWT Constellations backend server.

import createDOMPurify from "dompurify";
import * as e from "fp-ts/Either";
import { pipe } from "fp-ts/function";
import * as t from "io-ts";
import { JSDOM } from "jsdom";
import { ObjectId } from "mongodb";
import spdxParse from "spdx-expression-parse";

const DOMPurify = createDOMPurify(new JSDOM('').window);

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
);

export interface SpdxBrand {
  readonly SpdxExpression: unique symbol;
}

export function isValidSpdx(expression: string): boolean {
  try {
    spdxParse(expression);
    return true;
  } catch (error) {
    return false;
  }
}

export const SpdxExpression = t.brand(
  t.string,
  (ex): ex is t.Branded<string, SpdxBrand> => isValidSpdx(ex),
  'SpdxExpression'
);

export const CleanHtml = new t.Type<string, string, unknown>(
  "CleanHtml",

  // Type guard - HTML should be a string
  (input: unknown): input is string => typeof input === "string",

  // Sanitize the HTML string as part of the parsing process
  (input: unknown, context: t.Context) => pipe(
    t.string.validate(input, context),
    e.chain((str) => t.success(DOMPurify.sanitize(str, { ALLOWED_TAGS: ['b', 'strong', 'a', 'br'] })))
  ),

  // We don't need any custom encoding - just use the string encoder
  t.string.encode
);

