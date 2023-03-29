// Copyright 2023 the .NET Foundation

// An image corresponds to a WWT imageset. It is owned by a handle. One or more
// images are combined into "scenes", which are the things that we show to
// users.
//
// See `SCHEMA.md` for more information about the schema used here.

import { Response } from "express";
import { Request as JwtRequest } from "express-jwt";
import { isLeft } from "fp-ts/Either";
import * as t from "io-ts";
import { PathReporter } from "io-ts/PathReporter";
import { ObjectId, WithId } from "mongodb";

import { State } from "./globals";
import { canAddImages } from "./handles";

export interface MongoImage {
  handle_id: ObjectId;
  creation_date: Date;
  wwt: ImageWwtT;
  storage: ImageStorageT;
  note: string;
}

export interface MongoImageStorage {
  legacy_url_template: string | undefined;
}

const ImageWwt = t.type({
  base_degrees_per_tile: t.number,
  bottoms_up: t.boolean,
  center_x: t.number,
  center_y: t.number,
  file_type: t.string,
  projection: t.string,
  quad_tree_map: t.string,
  rotation: t.number,
  tile_levels: t.number,
  width_factor: t.number,
  thumbnail_url: t.string,
});

type ImageWwtT = t.TypeOf<typeof ImageWwt>;

const ImageStorage = t.type({
  legacy_url_template: t.union([t.string, t.undefined]),
});

type ImageStorageT = t.TypeOf<typeof ImageStorage>;

export function initializeImageEndpoints(state: State) {
  // POST /handle/:handle/image: post a new image record (data have already
  // been processed and uploaded)

  const ImageCreation = t.type({
    wwt: ImageWwt,
    storage: ImageStorage,
    note: t.string,
  });

  type ImageCreationT = t.TypeOf<typeof ImageCreation>;

  state.app.post(
    "/handle/:handle/image",
    async (req: JwtRequest, res: Response) => {
      const handle_name = req.params.handle;

      // Are we authorized?

      const handle = await state.handles.findOne({ "handle": handle_name });

      if (handle === null) {
        res.statusCode = 404;
        res.json({ error: true, message: "Handle not found" });
        return;
      }

      if (!canAddImages(req, handle)) {
        res.statusCode = 401;
        res.json({ error: true, message: "Not authorized" });
        return;
      }

      // Does the input look valid?

      const maybe = ImageCreation.decode(req.body);

      if (isLeft(maybe)) {
        res.statusCode = 400;
        res.json({ error: true, message: `Submission did not match schema: ${PathReporter.report(maybe).join("\n")}` });
        return;
      }

      const input: ImageCreationT = maybe.right;

      // OK, looks good.

      const new_rec = {
        handle_id: handle._id,
        creation_date: new Date(),
        wwt: input.wwt,
        storage: input.storage,
        note: input.note,
      };

      try {
        const result = await state.images.insertOne(new_rec);

        res.json({
          error: false,
          id: "" + result.insertedId,
          rel_url: "/image/" + encodeURIComponent("" + result.insertedId),
        });
      } catch (err) {
        console.error("POST /handle/:handle/image exception:", err);
        res.statusCode = 500;
        res.json({ error: true, message: "Database error in POST /handle/:handle/image" });
      }
    }
  );

}