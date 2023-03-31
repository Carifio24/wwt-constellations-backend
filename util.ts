import axios from "axios";
import * as t from "io-ts";
import { JSDOM } from "jsdom";
import { ObjectId } from "mongodb";

export async function parseXmlFromUrl(url: string): Promise<Document> {
  return axios.get(url)
    .then(response => response.data)
    .then(text => {
      return new JSDOM(text, { contentType: "text/xml" }).window.document;
    })
    .catch(err => {
      console.log(err);
      return new JSDOM().window.document;
    });
}

export function snakeToPascal(str: string) {
  return str.split("/")
    .map(snake => snake.split("_")
      .map(substr => substr.charAt(0)
        .toUpperCase() +
        substr.slice(1))
      .join(""))
    .join("/");
};

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