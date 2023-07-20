// Copyright 2023 the .NET Foundation

// An image corresponds to a WWT imageset. It is owned by a handle. One or more
// images are combined into "scenes", which are the things that we show to
// users.
//
// See `SCHEMA.md` for more information about the schema used here.

import { Response } from "express";
import { Request as JwtRequest } from "express-jwt";
import { isLeft } from "fp-ts/lib/Either.js";
import * as t from "io-ts";
import { PathReporter } from "io-ts/lib/PathReporter.js";
import { ObjectId, UpdateFilter, WithId } from "mongodb";
import { create } from "xmlbuilder2";
import { XMLBuilder } from "xmlbuilder2/lib/interfaces";

import { State } from "./globals.js";
import { isAllowed as handleIsAllowed } from "./handles.js";
import { CleanHtml, SpdxExpression } from "./util.js";

export interface MongoImage {
  handle_id: ObjectId;
  creation_date: Date;
  wwt: ImageWwtT;
  storage: ImageStorageT;
  note: string;
  alt_text?: string;
  permissions: ImagePermissionsT;
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

// Authorization tools

export type ImageCapability =
  "edit"
  ;

export async function isAllowed(state: State, req: JwtRequest, image: MongoImage, cap: ImageCapability): Promise<boolean> {
  // One day we might have finer-grained permissions, but not yet. We might also
  // have some kind of caching that allows us to not always look up the owning
  // handle info.

  const owner_handle = await state.handles.findOne({ "_id": image.handle_id });

  if (owner_handle === null) {
    throw new Error(`Internal database inconsistency: image missing owner ${image.handle_id}`);
  }

  switch (cap) {
    case "edit": {
      return handleIsAllowed(req, owner_handle, "editImages");
    }

    default: {
      return false; // this is a can't-happen but might as well be safe
    }
  }
}

// Various data exports

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

  if (image.alt_text !== undefined) {
    output.alt_text = image.alt_text;
  }

  return output;
}

export function imageToDisplayJson(image: WithId<MongoImage>): Record<string, any> {
  const output: Record<string, any> = {
    id: image._id,
    wwt: image.wwt,
    permissions: image.permissions,
    storage: image.storage,
  };

  if (image.alt_text !== undefined) {
    output.alt_text = image.alt_text;
  }

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

  iset.ele("Description").txt(image.note);

  if (image.permissions.credits) {
    iset.ele("Credits").txt(image.permissions.credits);
  }

  // TODO? CreditsUrl pointing to somewhere in Constellations frontend?
  iset.ele("ThumbnailUrl").txt(image.wwt.thumbnail_url);

  return iset;
}

export function initializeImageEndpoints(state: State) {
  // POST /handle/:handle/image: post a new image record (data have already
  // been processed and uploaded)

  const ImageCreation = t.intersection([
    t.type({
      wwt: ImageWwt,
      storage: ImageStorage,
      note: t.string,
      permissions: ImagePermissions,
    }),
    t.partial({
      alt_text: t.string,
    })
  ]);

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

      if (!handleIsAllowed(req, handle, "addImages")) {
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

      const new_rec: MongoImage = {
        handle_id: handle._id,
        creation_date: new Date(),
        wwt: input.wwt,
        storage: input.storage,
        note: input.note,
        permissions: input.permissions,
      };

      if (input.alt_text !== undefined) {
        new_rec.alt_text = input.alt_text;
      }

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
          { "_id": 1, "handle_id": 1, "creation_date": 1, "note": 1, "storage": 1 }
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

  // GET /images/builtin-backgrounds - get the list of built-in backgrounds

  state.app.get(
    "/images/builtin-backgrounds",
    async (req: JwtRequest, res: Response) => {
      // No authentication required.

      // No inputs.

      try {
        const items = await state.images.find(
          { builtin_background_sort_key: { $gte: 0 } },
        ).sort(
          { builtin_background_sort_key: 1 }
        ).project(
          { "_id": 1, "handle_id": 1, "creation_date": 1, "note": 1, "storage": 1 }
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

  // GET /image/:id/permissions - get information about the logged-in user's
  // permissions with regards to this image.
  //
  // Note that this API regards website authorization, not the information about
  // copyright, credits, etc.
  //
  // This API is only informative -- of course, direct API calls are the final
  // arbiters of what is and isn't allowed. But the frontend can use this
  // information to decide what UI elements to expose to a user.
  state.app.get(
    "/image/:id/permissions",
    async (req: JwtRequest, res: Response) => {
      try {
        const image = await state.images.findOne({ "_id": new ObjectId(req.params.id) });

        if (image === null) {
          res.statusCode = 404;
          res.json({ error: true, message: "Not found" });
          return;
        }

        // TODO: if we end up reporting more categories, we should somehow batch
        // the checks to not look up the same handle over and over.

        const edit = await isAllowed(state, req, image, "edit");

        const output = {
          error: false,
          id: image._id,
          edit: edit,
        };

        res.json(output);
      } catch (err) {
        console.error(`${req.method} ${req.path} exception:`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );

  // PATCH /image/:id - update image properties

  const ImagePatch = t.partial({
    note: t.string,
    alt_text: t.string,
    permissions: ImagePermissions,
  });

  type ImagePatchT = t.TypeOf<typeof ImagePatch>;

  state.app.patch(
    "/image/:id",
    async (req: JwtRequest, res: Response) => {
      try {
        // Validate inputs

        const thisImage = { "_id": new ObjectId(req.params.id) };
        const image = await state.images.findOne(thisImage);

        if (image === null) {
          res.statusCode = 404;
          res.json({ error: true, message: "Not found" });
          return;
        }

        const maybe = ImagePatch.decode(req.body);

        if (isLeft(maybe)) {
          res.statusCode = 400;
          res.json({ error: true, message: `Submission did not match schema: ${PathReporter.report(maybe).join("\n")}` });
          return;
        }

        const input: ImagePatchT = maybe.right;

        // For this operation, we might require different permissions depending
        // on what changes are exactly being requested. Note that patch
        // operations should either fully succeed or fully fail -- no partial
        // applications. Here we cache the `canEdit` permission since everything
        // uses it.

        let allowed = true;
        const canEdit = await isAllowed(state, req, image, "edit");

        // For convenience, this value should be pre-filled with whatever
        // operations we might use below. We have to hack around the typing
        // below, though, because TypeScript takes some elements here to be
        // read-only.
        let operation: UpdateFilter<MongoImage> = { "$set": {} };

        if (input.note) {
          allowed = allowed && canEdit;

          // Validate this particular input. (TODO: I think io-ts could do this?)
          if (input.note.length > 500) {
            res.statusCode = 400;
            res.json({ error: true, message: "Invalid input `note`: too long" });
            return;
          }

          (operation as any)["$set"]["note"] = input.note;
        }

        if (input.alt_text) {
          allowed = allowed && canEdit;

          if (input.alt_text.length > 5000) {
            res.statusCode = 400;
            res.json({ error: true, message: "Invalid input `alt_text`: too long" });
            return;
          }

          (operation as any)["$set"]["alt_text"] = input.alt_text;
        }

        if (input.permissions) {
          // Validation is performed by io-ts, which checks that credits is
          // CleanHtml and that license is an SPDX license identifier.
          allowed = allowed && canEdit;
          (operation as any)["$set"]["permissions"] = input.permissions;
        }

        // How did we do?

        if (!allowed) {
          res.statusCode = 403;
          res.json({ error: true, message: "Forbidden" });
          return;
        }

        await state.images.findOneAndUpdate(
          thisImage,
          operation
        );

        res.json({
          error: false,
        });
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

        if (!handleIsAllowed(req, handle, "viewDashboard")) {
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
