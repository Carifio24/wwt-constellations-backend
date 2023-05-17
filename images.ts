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
import { create } from "xmlbuilder2";
import { XMLBuilder } from "xmlbuilder2/lib/interfaces";

import { State } from "./globals";
import { isAllowed } from "./handles";
import { CleanHtml, SpdxExpression } from "./util";

export interface MongoImage {
  handle_id: ObjectId;
  creation_date: Date;
  wwt: ImageWwtT;
  storage: ImageStorageT;
  note: string;
  permissions: ImagePermissionsT;
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
  offset_x: t.number,
  offset_y: t.number,
  projection: t.string,
  quad_tree_map: t.string,
  rotation: t.number,
  thumbnail_url: t.string,
  tile_levels: t.number,
  width_factor: t.number,
});

type ImageWwtT = t.TypeOf<typeof ImageWwt>;

const ImageStorage = t.type({
  legacy_url_template: t.union([t.string, t.undefined]),
});

type ImageStorageT = t.TypeOf<typeof ImageStorage>;

const ImagePermissions = t.intersection([
  t.type({
    copyright: t.string,
    license: SpdxExpression,
  }),
  t.partial({
    credits: CleanHtml,
  })
]);

type ImagePermissionsT = t.TypeOf<typeof ImagePermissions>;

export async function imageToJson(image: WithId<MongoImage>, state: State): Promise<Record<string, any>> {
  const handle = await state.handles.findOne({ "_id": image.handle_id });

  if (handle === null) {
    throw new Error(`Database consistency failure, image ${image._id} missing handle ${image.handle_id}`);
  }

  const output: Record<string, any> = {
    id: image._id,
    handle_id: image.handle_id,
    handle: {
      handle: handle.handle,
      display_name: handle.display_name,
    },
    creation_date: image.creation_date,
    wwt: image.wwt,
    permissions: image.permissions,
    storage: image.storage,
    note: image.note,
  };

  return output;
}

export function imageToImageset(image: MongoImage, root: XMLBuilder): XMLBuilder {
  const iset = root.ele("ImageSet");

  // Bad hardcodings!!
  iset.att("BandPass", "Visible");
  iset.att("DataSetType", "Sky");

  // Hardcodings that are probably OK:
  iset.att("BaseTileLevel", "0");
  iset.att("ElevationModel", "False");
  iset.att("Generic", "False");
  iset.att("Sparse", "True");
  iset.att("StockSet", "False");

  iset.att("BaseDegreesPerTile", String(image.wwt.base_degrees_per_tile));
  iset.att("BottomsUp", image.wwt.bottoms_up ? "True" : "False");
  iset.att("CenterX", String(image.wwt.center_x));
  iset.att("CenterY", String(image.wwt.center_y));
  iset.att("FileType", image.wwt.file_type);
  iset.att("Name", image.note);
  iset.att("OffsetX", String(image.wwt.offset_x));
  iset.att("OffsetY", String(image.wwt.offset_y));
  iset.att("Projection", image.wwt.projection);
  iset.att("QuadTreeMap", image.wwt.quad_tree_map);
  iset.att("Rotation", String(image.wwt.rotation));
  iset.att("TileLevels", String(image.wwt.tile_levels));
  iset.att("WidthFactor", String(image.wwt.width_factor));

  if (image.storage.legacy_url_template) {
    iset.att("Url", image.storage.legacy_url_template);
  } else {
    throw new Error("no derivable URL for imageset WTML");
  }

  // TODO: credits etc!!!

  iset.ele("Description").txt(image.note);
  iset.ele("ThumbnailUrl").txt(image.wwt.thumbnail_url);

  return iset;
}

export function initializeImageEndpoints(state: State) {
  // POST /handle/:handle/image: post a new image record (data have already
  // been processed and uploaded)

  const ImageCreation = t.type({
    wwt: ImageWwt,
    storage: ImageStorage,
    note: t.string,
    permissions: ImagePermissions,
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

      if (!isAllowed(req, handle, "addImages")) {
        res.statusCode = 403;
        res.json({ error: true, message: "Forbidden" });
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
        permissions: input.permissions,
      };

      try {
        const result = await state.images.insertOne(new_rec);

        res.json({
          error: false,
          id: "" + result.insertedId,
          rel_url: "/image/" + encodeURIComponent("" + result.insertedId),
        });
      } catch (err) {
        console.error(`${req.method} ${req.path} exception:`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );

  // POST /images/find-by-legacy-url - locate image records based on their WWT
  // "legacy URL" field.
  //
  // This helps us bootstrap the collection by allowing us to associate existing
  // images with new scenes (~WWT places). It should probably eventually become
  // part of a more generic query interface.
  //
  // We don't (yet?) filter results by handle or anything.

  const FindByLegacy = t.type({
    wwt_legacy_url: t.string,
  });

  type FindByLegacyT = t.TypeOf<typeof FindByLegacy>;

  state.app.post(
    "/images/find-by-legacy-url",
    async (req: JwtRequest, res: Response) => {
      // No authentication required.

      // Does the input look valid?

      const maybe = FindByLegacy.decode(req.body);

      if (isLeft(maybe)) {
        res.statusCode = 400;
        res.json({ error: true, message: `Submission did not match schema: ${PathReporter.report(maybe).join("\n")}` });
        return;
      }

      const input: FindByLegacyT = maybe.right;

      // OK, looks good.

      try {
        // Don't include the WWT astrometric/data-format info, which is more
        // specific than callers will generally want.
        const items = await state.images.find(
          { "storage.legacy_url_template": { $eq: input.wwt_legacy_url } },
        ).project(
          { "wwt": false }
        ).toArray();

        res.json({
          error: false,
          results: items,
        });
      } catch (err) {
        console.error(`${req.method} ${req.path} exception:`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );

  // GET /image/:id - information about an image

  state.app.get(
    "/image/:id",
    async (req: JwtRequest, res: Response) => {
      try {
        const image = await state.images.findOne({ "_id": new ObjectId(req.params.id) });

        if (image === null) {
          res.statusCode = 404;
          res.json({ error: true, message: "Not found" });
          return;
        }

        const output = await imageToJson(image, state);
        output["error"] = false;
        res.json(output);
      } catch (err) {
        console.error(`${req.method} ${req.path} exception:`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );

  // GET /image/:id/img.wtml - get WTML with a single imageset

  state.app.get(
    "/image/:id/img.wtml",
    async (req: JwtRequest, res: Response) => {
      try {
        const image = await state.images.findOne({ "_id": new ObjectId(req.params.id) });

        if (image === null) {
          res.statusCode = 404;
          res.json({ error: true, message: "Not found" });
          return;
        }

        const root = create().ele("Folder");
        root.att("Browseable", "True");
        root.att("Group", "Explorer");
        root.att("Name", image.note);
        root.att("Searchable", "True");
        root.att("Type", "Sky");

        imageToImageset(image, root);

        root.end({ prettyPrint: true });
        res.type("application/xml")
        res.send(root.toString());
      } catch (err) {
        console.error(`${req.method} ${req.path} exception:`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );

  // GET /handle/:handle/imageinfo?page=$int&pagesize=$int - get admin
  // information about images
  //
  // This endpoint is for the handle dashboard showing summary information about
  // the handle's images.

  state.app.get(
    "/handle/:handle/imageinfo",
    async (req: JwtRequest, res: Response) => {
      try {
        // Validate input(s)

        const handle = await state.handles.findOne({ "handle": req.params.handle });

        if (handle === null) {
          res.statusCode = 404;
          res.json({ error: true, message: "Not found" });
          return;
        }

        var page_num = 0;

        try {
          const qpage = parseInt(req.query.page as string, 10);

          if (qpage >= 0) {
            page_num = qpage;
          }
        } catch {
          res.statusCode = 400;
          res.json({ error: true, message: `invalid page number` });
        }

        var page_size = 10;

        try {
          const qps = parseInt(req.query.pagesize as string, 10);

          if (qps > 0 && qps <= 100) {
            page_size = qps;
          }
        } catch {
          res.statusCode = 400;
          res.json({ error: true, message: `invalid page size` });
        }

        // Check authorization

        if (!isAllowed(req, handle, "viewDashboard")) {
          res.statusCode = 403;
          res.json({ error: true, message: "Forbidden" });
          return;
        }

        // OK to proceed

        const filter = { "handle_id": handle._id };
        const count = await state.images.countDocuments(filter);
        const infos = await state.images.find(filter)
          .sort({ creation_date: -1 })
          .skip(page_num * page_size)
          .limit(page_size)
          .project({ "_id": 1, "handle_id": 1, "creation_date": 1, "note": 1, "storage": 1 })
          .toArray();

        res.json({
          error: false,
          total_count: count,
          results: infos,
        });
      } catch (err) {
        console.error(`${req.method} ${req.path} exception:`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );
}
